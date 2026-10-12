// OpenMATB Korean study, pure JavaScript engine (eng "js1").
// Re-implementation of the parts of OpenMATB 1.5.0 (Cegarra & Valery, CeCILL 2.1) that the study uses: the scenario
// scheduler, the four tasks, the slides and the guide boxes. Geometry, parameters and rules follow the Python sources
// (core/scheduler.py, core/window.py, plugins/*.py, core/widgets/*.py); the comments name the original when useful.
//
// Coordinates are the ones of OpenMATB: pixels of a virtual window fixed at the start of the session, y upward.
// The canvas is scaled to the page (like core/window.py fit_to_page), so a resized window keeps the same layout.

export const C = {
    WHITE: [255, 255, 255], BLACK: [50, 50, 50], GREEN: [142, 219, 176], RED: [241, 100, 100],
    BACKGROUND: [240, 240, 240], GREY: [200, 200, 200], ORANGE: [230, 120, 0],
};
export const F = { SMALL: 12, MEDIUM: 16, LARGE: 20, XLARGE: 30 };
export const FONT = '"Noto Sans KR", "Malgun Gothic", "Apple SD Gothic Neo", "Nanum Gothic", sans-serif';
const TITLE_PROPORTION = 0.1; // PLUGIN_TITLE_HEIGHT_PROPORTION
const MAX_STEP_CATCH_UP = 0.25; // plugins/abstractplugin.py
const MAX_STEPS_PER_UPDATE = 50;
export const MAX_FRAME_S = 0.25; // A longer stall of the page is not caught up: logged as a freeze

export const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

export class Container {
    constructor(name, l, b, w, h) {
        Object.assign(this, { name, l, b, w, h });
        this.x1 = l;
        this.y1 = b + h;
        this.x2 = l + w;
        this.y2 = b;
        this.cx = l + w / 2;
        this.cy = b + h / 2;
    }
    reduced(wr, hr) {
        return new Container(this.name, this.l + this.w * (1 - wr) / 2, this.b + this.h * (1 - hr) / 2,
            this.w * wr, this.h * hr);
    }
    translated(x = 0, y = 0) {
        return new Container(this.name, this.l + x, this.b + y, this.w, this.h);
    }
    reduceAndTranslate(width = 1, height = 1, x = 0, y = 0) {
        const r = this.reduced(width, height);
        return new Container(this.name, this.l + x * (this.w - r.w), this.b + y * (this.h - r.h), r.w, r.h);
    }
}

// core/window.py get_container_list (no replay strips), config.ini top_bounds/bottom_bounds
export function layout(w, h) {
    const [x1, x2] = [0.35, 0.85].map((v) => Math.trunc(w * v));
    const [x3, x4] = [0.30, 0.85].map((v) => Math.trunc(w * v));
    const y1 = h / 2;
    return {
        fullscreen: new Container("fullscreen", 0, 0, w, h),
        topleft: new Container("topleft", 0, y1, x1, h / 2),
        topmid: new Container("topmid", x1, y1, x2 - x1, h / 2),
        topright: new Container("topright", x2, y1, w - x2, h / 2),
        bottomleft: new Container("bottomleft", 0, 0, x3, h / 2),
        bottommid: new Container("bottommid", x3, 0, x4 - x3, h / 2),
        bottomright: new Container("bottomright", x4, 0, w - x4, h / 2),
    };
}

// ---- Drawing on the canvas, in virtual coordinates ----
export class Painter {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d", { alpha: false });
        this.vw = 1;
        this.vh = 1;
        this.s = 1;
        this.ox = 0;
    }
    setVirtual(vw, vh) {
        this.vw = vw;
        this.vh = vh;
    }
    // Fit the virtual window to the canvas (centered horizontally, at the top)
    fit() {
        const dpr = window.devicePixelRatio || 1;
        const cw = this.canvas.clientWidth;
        const ch = this.canvas.clientHeight;
        if (this.canvas.width !== Math.round(cw * dpr) || this.canvas.height !== Math.round(ch * dpr)) {
            this.canvas.width = Math.round(cw * dpr);
            this.canvas.height = Math.round(ch * dpr);
        }
        this.s = Math.min(cw / this.vw, ch / this.vh);
        this.ox = (cw - this.vw * this.s) / 2;
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.cssW = cw;
        this.cssH = ch;
    }
    X(x) {
        return this.ox + x * this.s;
    }
    Y(y) {
        return (this.vh - y) * this.s;
    }
    // Page (CSS px) rectangle of a container, for DOM elements over the canvas
    cssRect(c) {
        return { left: this.X(c.l), top: this.Y(c.y1), width: c.w * this.s, height: c.h * this.s };
    }
    clear(color) {
        this.ctx.fillStyle = rgb(color);
        this.ctx.fillRect(0, 0, this.cssW, this.cssH);
    }
    rect(l, b, w, h, fill, stroke = null, lineWidth = 1) {
        const c = this.ctx;
        const x = this.X(l);
        const y = this.Y(b + h);
        if (fill) {
            c.fillStyle = typeof fill === "string" ? fill : rgb(fill);
            c.fillRect(x, y, w * this.s, h * this.s);
        }
        if (stroke) {
            c.strokeStyle = rgb(stroke);
            c.lineWidth = lineWidth;
            c.strokeRect(x + 0.5, y + 0.5, w * this.s, h * this.s);
        }
    }
    line(ax, ay, bx, by, color, width = 1) {
        const c = this.ctx;
        c.strokeStyle = rgb(color);
        c.lineWidth = width;
        c.beginPath();
        c.moveTo(this.X(ax), this.Y(ay));
        c.lineTo(this.X(bx), this.Y(by));
        c.stroke();
    }
    poly(points, fill, stroke = null) {
        const c = this.ctx;
        c.beginPath();
        points.forEach(([x, y], i) => (i ? c.lineTo(this.X(x), this.Y(y)) : c.moveTo(this.X(x), this.Y(y))));
        c.closePath();
        if (fill) {
            c.fillStyle = rgb(fill);
            c.fill();
        }
        if (stroke) {
            c.strokeStyle = rgb(stroke);
            c.lineWidth = 1;
            c.stroke();
        }
    }
    circle(x, y, r, fill, stroke = null, width = 1) {
        const c = this.ctx;
        c.beginPath();
        c.arc(this.X(x), this.Y(y), r * this.s, 0, Math.PI * 2);
        if (fill) {
            c.fillStyle = rgb(fill);
            c.fill();
        }
        if (stroke) {
            c.strokeStyle = rgb(stroke);
            c.lineWidth = width;
            c.stroke();
        }
    }
    text(str, x, y, { size = F.SMALL, color = C.BLACK, align = "center", baseline = "middle", bold = false } = {}) {
        const c = this.ctx;
        c.font = `${bold ? "700 " : ""}${Math.max(8, size * 4 / 3 * this.s)}px ${FONT}`; // pyglet sizes are points
        c.fillStyle = rgb(color);
        c.textAlign = align;
        c.textBaseline = baseline;
        c.fillText(str, this.X(x), this.Y(y));
    }
}

// ---- Scenario file (includes/scenarios/korean/study.txt, core/scenario.py) ----
export function parseScenario(text) {
    const events = [];
    let phases = null;
    text.split(/\r?\n/).forEach((raw, line) => {
        const s = raw.trim();
        if (s.startsWith("# PHASES ")) {
            phases = JSON.parse(s.slice("# PHASES ".length));
            return;
        }
        if (!s || s.startsWith("#")) {
            return;
        }
        const [time, plugin, ...command] = s.split(";");
        const [h, m, sec] = time.split(":").map(Number);
        const t = h * 3600 + m * 60 + sec;
        // Sysmon scales: "scales-N-failure;up|down" means failure True and side 1|-1 (core/scenario.py)
        if (command.length === 2 && command[0].includes("scales") && command[0].includes("failure")
            && ["up", "down"].includes(command[1])) {
            events.push({ t, line, plugin, command: [command[0], "True"] });
            events.push({ t, line, plugin, command: [command[0].replace("failure", "side"), command[1] === "up" ? "1" : "-1"] });
        } else {
            events.push({ t, line, plugin, command });
        }
    });
    events.sort((a, b) => a.t - b.t || a.line - b.line); // Stable: line order within a second
    return { events, phases };
}

// Value of a scenario parameter, typed like the default value it replaces (core/validation.py)
export function typed(value, previous, name) {
    if (/color/.test(name) && /^#[0-9a-f]{6}$/i.test(value)) {
        return [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));
    }
    if (typeof previous === "boolean") {
        return value === "True";
    }
    if (typeof previous === "number") {
        return Number(value);
    }
    return value;
}

// ---- Tasks (plugins/abstractplugin.py) ----
export class Plugin {
    constructor(engine, alias, title, placement, updateMs) {
        this.engine = engine;
        this.alias = alias;
        this.title = title;
        this.alive = false;
        this.paused = true;
        this.visible = false;
        this.blocking = false;
        this.keys = new Set();
        this.nextRefresh = 0;
        this.t = 0;
        this.params = { taskplacement: placement, taskupdatetime: updateMs };
        this.automodePosition = null;
    }
    get log() {
        return this.engine.log;
    }
    createWidgets() {
        const pthp = TITLE_PROPORTION;
        this.container = this.engine.containers[this.params.taskplacement];
        this.titleContainer = this.container.reduceAndTranslate(1, pthp, 0, 1);
        this.taskContainer = this.container.reduceAndTranslate(1, 1 - pthp, 0, 0);
    }
    start() {
        this.alive = true;
        this.createWidgets();
        this.show();
        this.resume();
    }
    stop() {
        this.alive = false;
        this.pause();
        this.hide();
    }
    pause() {
        this.paused = true;
    }
    resume() {
        this.paused = false;
    }
    show() {
        this.visible = true;
    }
    hide() {
        this.visible = false;
    }
    canReceiveKeys() {
        if (this.paused || !this.visible) {
            return false;
        }
        return !this.params.automaticsolver;
    }
    setParameter(path, value) {
        const keys = path.split("-");
        let d = this.params;
        for (const k of keys.slice(0, -1)) {
            d = d[k] ?? (d[k] = {});
        }
        const last = keys[keys.length - 1];
        const old = d[last];
        d[last] = typed(value, old, path);
        if (path.includes("key")) {
            this.keys.add(d[last]);
            if (old !== undefined && old !== d[last]) {
                this.keys.delete(old);
            }
        }
    }
    update(t) {
        this.t = t;
        this.compute();
        if (this.params.taskupdatetime > 0) {
            for (let i = 0; i < MAX_STEPS_PER_UPDATE - 1; i++) {
                if (this.t < this.nextRefresh || this.paused) {
                    break;
                }
                this.compute();
            }
        }
    }
    // One step of the task, every taskupdatetime ms of scenario time (deadlines from the previous one)
    compute() {
        if (!(this.t >= this.nextRefresh) || this.paused) {
            return false;
        }
        const period = this.params.taskupdatetime / 1000;
        if (this.nextRefresh === 0) {
            this.nextRefresh = this.t;
        }
        this.nextRefresh += period;
        if (this.nextRefresh < this.t - MAX_STEP_CATCH_UP) {
            this.nextRefresh = this.t + period;
        }
        this.step();
        return true;
    }
    step() {}
    onKey() {}
    // Common drawing: title in the black band, automation state
    drawFrame(p) {
        if (!this.visible || this.params.taskplacement === "invisible") {
            return;
        }
        p.text(this.title.toUpperCase(), this.titleContainer.cx, this.titleContainer.cy, { size: F.MEDIUM, color: C.WHITE });
        if (this.automodePosition && this.params.displayautomationstate) {
            const a = this.container.reduceAndTranslate(0.15, 0.05, ...this.automodePosition);
            p.text(this.params.automaticsolver ? "자동" : "수동", a.cx, a.cy);
        }
    }
    draw() {}
}

// Slides (plugins/instructions.py) and guide boxes (plugins/guide.py) are DOM elements over the canvas
export class Engine {
    constructor({ canvas, overlay, log, timeFactor = 1 }) {
        this.painter = new Painter(canvas);
        this.overlay = overlay; // DOM layer for the slides and guide boxes
        this.log = log;
        this.timeFactor = timeFactor;
        this.plugins = {};
        this.scenarioTime = 0;
        this.scenarioPaused = false;
        this.pausedPlugins = [];
        this.suspendedPlugins = null; // Paused by the pointer pause (see app.js)
        this.events = [];
        this.cursor = 0;
        this.queue = [];
        this.skipTo = null;
        this.freezeMs = 0;
        this.keysDown = new Set();
        this.ended = false;
        this.lastReal = null;
        this.tick = { real: 0, scenario: 0, previous: 0, running: false };
        this.onEnd = null;
        this.onEvent = null;
        this.isSuspended = () => false;
        this.flipCallbacks = [];
    }
    // Called with the scenario time of the next drawn frame (core/timing.py call_on_flip)
    onNextFlip(callback) {
        this.flipCallbacks.push(callback);
    }
    setVirtualSize(w, h) {
        this.vw = w;
        this.vh = h;
        this.painter.setVirtual(w, h);
        this.containers = layout(w, h);
    }
    add(plugin) {
        this.plugins[plugin.alias] = plugin;
    }
    load(scenario) {
        this.events = scenario.events;
        this.phases = scenario.phases;
    }
    activeBlocking() {
        return Object.values(this.plugins).find((p) => p.blocking && !p.paused) || null;
    }
    execute(e) {
        const plugin = this.plugins[e.plugin];
        if (!plugin) {
            throw new Error(`Unknown plugin ${e.plugin}`);
        }
        const [cmd, value] = e.command;
        if (e.command.length === 1) {
            if (cmd === "start" && !plugin.alive) {
                plugin.start();
            } else if (cmd === "stop") {
                plugin.stop();
            } else if (cmd === "pause") {
                plugin.pause();
            } else if (cmd === "resume") {
                plugin.resume();
            } else if (cmd === "show") {
                plugin.show();
            } else if (cmd === "hide") {
                plugin.hide();
            }
        } else {
            plugin.setParameter(cmd, value);
        }
        this.log.event(this.scenarioTime, e.plugin, e.command.join(";"));
        this.onEvent?.(e);
    }
    // Scenario time at a real time (performance.now() ms): a response time is measured from the input event, not
    // the frame that handles it (core/timing.py scenario_time_at)
    scenarioTimeAt(realMs) {
        if (!this.tick.running) {
            return this.tick.scenario;
        }
        return Math.max(this.tick.previous, this.tick.scenario + (realMs - this.tick.real) / 1000 * this.timeFactor);
    }
    // One frame (core/scheduler.py update)
    frame(nowMs) {
        if (this.ended) {
            return;
        }
        let dt = this.lastReal === null ? 0 : (nowMs - this.lastReal) / 1000;
        this.lastReal = nowMs;
        if (dt > MAX_FRAME_S) {
            this.freezeMs += (dt - MAX_FRAME_S) * 1000;
            this.log.freeze(this.scenarioTime, Math.round(dt * 1000));
            dt = MAX_FRAME_S;
        }

        // The pointer pause (pointer lock lost while tracking, another tab): like the dialogs of the original
        if (this.isSuspended()) {
            if (!this.suspendedPlugins) {
                this.suspendedPlugins = Object.values(this.plugins).filter((p) => p.alive && !p.paused);
                this.suspendedPlugins.forEach((p) => p.pause());
                this.log.manual(this.scenarioTime, "pause", "pointer or page");
            }
            this.setTick(false);
            return;
        }
        if (this.suspendedPlugins) {
            this.suspendedPlugins.filter((p) => p.alive).forEach((p) => p.resume());
            this.suspendedPlugins = null;
            this.log.manual(this.scenarioTime, "resume", "pointer or page");
        }

        if (this.skipTo !== null) { // plugins/gate.py
            this.scenarioTime = Math.max(this.scenarioTime, this.skipTo);
            this.skipTo = null;
        }
        if (!this.scenarioPaused) {
            this.scenarioTime += dt * this.timeFactor;
        }
        this.setTick(!this.scenarioPaused);

        for (const p of Object.values(this.plugins)) {
            if (p.alive) {
                p.update(this.scenarioTime);
            }
        }
        this.executeEvents();
        this.checkExit();
    }
    setTick(running) {
        this.tick.previous = this.tick.scenario;
        this.tick.real = performance.now();
        this.tick.scenario = this.scenarioTime;
        this.tick.running = running;
    }
    executeEvents() {
        let blocking = this.activeBlocking();
        if (!this.scenarioPaused) {
            if (!blocking) {
                while (this.cursor < this.events.length && this.events[this.cursor].t <= this.scenarioTime) {
                    this.queue.push(this.events[this.cursor++]);
                }
                // Execute the due events in order, until one starts a blocking plugin (the others wait for its end)
                while (this.queue.length) {
                    this.execute(this.queue.shift());
                    if (this.activeBlocking()) {
                        break;
                    }
                }
                blocking = this.activeBlocking();
            }
            if (blocking && blocking.alive) {
                this.scenarioPaused = true;
                this.pausedPlugins = Object.values(this.plugins).filter((p) => !p.blocking && !p.paused);
                this.pausedPlugins.forEach((p) => {
                    p.pause();
                    if (!blocking.keepTasksVisible) {
                        p.hide();
                    }
                });
            }
        } else if (!blocking) {
            this.pausedPlugins.forEach((p) => {
                p.show();
                p.resume();
            });
            this.pausedPlugins = [];
            this.scenarioPaused = false;
        }
    }
    checkExit() {
        const alive = Object.values(this.plugins).some((p) => p.alive);
        if (!alive && !this.queue.length && this.cursor >= this.events.length) {
            this.end();
        }
    }
    end(reason = null) {
        if (this.ended) {
            return;
        }
        this.ended = true;
        for (const p of Object.values(this.plugins)) {
            if (p.alive) {
                p.stop();
            }
        }
        this.log.manual(this.scenarioTime, "end", reason || "");
        this.onEnd?.(reason);
    }
    // Keys: name as in the scenario (core/pyglet_compat.py mapping by physical key)
    keyEvent(name, state, realMs) {
        if (state === "press") {
            if (this.keysDown.has(name)) {
                return; // Key repeat
            }
            this.keysDown.add(name);
        } else {
            this.keysDown.delete(name);
        }
        const t = this.scenarioTimeAt(realMs);
        if (state === "press") {
            this.log.key(t, name);
        }
        for (const p of Object.values(this.plugins)) {
            if (p.alive && p.keys.has(name)) {
                p.onKey(name, state, { t, emulate: false });
            }
        }
    }
    releaseAllKeys() {
        for (const name of [...this.keysDown]) {
            this.keyEvent(name, "release", performance.now());
        }
    }
    draw() {
        const p = this.painter;
        p.fit();
        p.clear(C.BACKGROUND);
        const blocking = this.activeBlocking();
        const fullscreenSlide = blocking && !blocking.keepTasksVisible && blocking.visible;
        p.rect(0, 0, this.vw, this.vh, C.BACKGROUND);
        if (!fullscreenSlide) {
            // Black title bands (core/window.py create_MATB_background)
            const band = this.vh * TITLE_PROPORTION / 2;
            p.rect(0, this.vh - band, this.vw, band, C.BLACK);
            p.rect(0, this.vh * (0.5 - TITLE_PROPORTION / 2), this.vw, band, C.BLACK);
            for (const plugin of Object.values(this.plugins)) {
                if (!plugin.blocking && plugin.visible) {
                    plugin.draw(p);
                    plugin.drawFrame(p);
                }
            }
        }
        for (const plugin of Object.values(this.plugins)) {
            if (plugin.blocking && plugin.visible) {
                plugin.draw(p);
            }
        }
        if (this.flipCallbacks.length) {
            const t = this.scenarioTimeAt(performance.now());
            this.flipCallbacks.splice(0).forEach((cb) => cb(t));
        }
    }
}
