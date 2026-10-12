// The tasks of the study, ported from OpenMATB 1.5.0 (plugins/*.py, core/widgets/*.py) with the Korean adaptation
// (plugins/guide.py, plugins/gate.py, mouse tracking, Korean voice, confirm flash, pump keys).
import { C, F, Container, Plugin, rgb } from "./engine.js";
import { Prompt, promptText } from "./tts.js";

const choice = (list) => list[Math.floor(Math.random() * list.length)];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round1 = (v) => Math.round(v * 10) / 10;

// ---------------------------------------------------------------- Tracking (plugins/track.py, widgets/reticle.py)
export class Track extends Plugin {
    constructor(engine, mouse) {
        super(engine, "track", "추적", "topmid", 20);
        this.mouse = mouse; // { take(): null | "lost" | [dx, dy], setWanted(bool) }
        Object.assign(this.params, {
            cursorcolor: C.BLACK, cursorcoloroutside: C.RED, automaticsolver: false, displayautomationstate: true,
            targetproportion: 0.25, joystickforce: 1, inverseaxis: false, mousemove: false, mousegain: 0.5,
        });
        this.automodePosition = [0.35, 0.1];
        this.xin = 0;
        this.yin = 0;
        this.xsin = 0;
        this.ysin = 0;
        this.moffx = 0;
        this.moffy = 0;
        this.cursor = [0, 0];
        this.inTarget = true;
        this.pointerLost = 0;
        this.wanted = false;
    }
    createWidgets() {
        super.createWidgets();
        const tc = this.taskContainer;
        const h = tc.h * 0.8;
        this.reticle = new Container("reticle", tc.l + tc.w / 2 - h / 2, tc.b + tc.h * 0.1, h, h);
        this.xgain = this.reticle.w * 0.8 / 2; // gain_ratio
        this.ygain = this.reticle.h * 0.8 / 2;
    }
    setWanted(w) {
        if (w !== this.wanted) {
            this.wanted = w;
            this.mouse.setWanted(w);
        }
    }
    pause() {
        super.pause();
        this.setWanted(false);
    }
    targetRadius() {
        return this.reticle.w / 2 * this.params.targetproportion;
    }
    step() {
        let moved = false;
        if (this.params.mousemove) {
            this.setWanted(true);
            const m = this.mouse.take();
            if (m === "lost") {
                this.pointerLost += 1;
                this.log.manual(this.t, "pointerlock_lost", String(this.pointerLost));
            } else if (m) {
                this.xin = m[0] * this.params.mousegain; // Browser y goes down: the cursor moves by (x_input, -y_input)
                this.yin = m[1] * this.params.mousegain;
                moved = true;
            }
        }
        this.nextCursor();
        if (moved) {
            this.xin = 0;
            this.yin = 0;
        }
        const r = this.targetRadius();
        const dev = Math.hypot(this.cursor[0], this.cursor[1]);
        this.inTarget = r > 0 ? dev <= r : true;
        this.log.perf(this.t, "track", "cursor_in_target", this.inTarget);
        this.log.perf(this.t, "track", "center_deviation", dev);
    }
    // Comstock et al. (1992), compute_next_cursor_position
    nextCursor() {
        this.xsin = this.xsin < 2 * Math.PI ? this.xsin + 0.005 : 0;
        this.ysin = this.ysin < 2 * Math.PI ? this.ysin + 0.006 : 0;
        let compx = this.params.inverseaxis ? -this.xin : this.xin;
        let compy = this.params.inverseaxis ? this.yin : -this.yin;
        compx *= this.params.joystickforce;
        compy *= this.params.joystickforce;
        this.moffx += compx;
        this.moffy += compy;
        let cx = Math.sin(this.xsin) * this.xgain + this.moffx;
        let cy = Math.sin(this.ysin) * this.ygain + this.moffy;
        const lx = clamp(cx, -this.reticle.w / 2, this.reticle.w / 2);
        const ly = clamp(cy, -this.reticle.h / 2, this.reticle.h / 2);
        if (lx !== cx) {
            const diff = cx - lx;
            cx -= diff;
            if (compx !== 0 && diff / compx > 0) {
                this.moffx -= diff + compx;
            }
        }
        if (ly !== cy) {
            const diff = cy - ly;
            cy -= diff;
            if (compy !== 0 && diff / compy > 0) {
                this.moffy -= diff + compy;
            }
        }
        this.cursor = [cx, cy];
    }
    draw(p) {
        const c = this.reticle;
        const rot = (pts, a) => pts.map(([x, y]) => [
            c.cx + (x - c.cx) * Math.cos(a) - (y - c.cy) * Math.sin(a),
            c.cy + (x - c.cx) * Math.sin(a) + (y - c.cy) * Math.cos(a),
        ]);
        const cw = 0.07 * c.w;
        const gw = 0.023 * c.w;
        const seg = [[c.cx, c.cy], [c.x2, c.cy], [c.x2, c.y2], [c.x2 - cw, c.y2], [c.x2, c.y2], [c.x2, c.y2 + cw]];
        for (let i = 0; i < 5; i++) {
            const x = c.cx + (c.x2 - c.cx) / 4 * i;
            const g = gw + gw * ((i + 1) % 2);
            seg.push([x, c.cy - g], [x, c.cy + g]);
        }
        const r = this.targetRadius();
        p.circle(c.cx, c.cy, r, C.WHITE);
        for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
            const v = rot(seg, a);
            for (let i = 0; i + 1 < v.length; i += 2) {
                p.line(v[i][0], v[i][1], v[i + 1][0], v[i + 1][1], C.BLACK);
            }
        }
        p.circle(c.cx, c.cy, r, null, C.BLACK);
        const color = this.inTarget ? this.params.cursorcolor : this.params.cursorcoloroutside;
        const [ax, ay] = [c.cx + this.cursor[0], c.cy + this.cursor[1]];
        const cr = c.w / 2 * 0.08;
        p.circle(ax, ay, cr, null, color, 1.5);
        p.line(ax - cr, ay, ax + cr, ay, color, 1.5);
        p.line(ax, ay - cr, ax, ay + cr, color, 1.5);
    }
}

// ----------------------------------------------- System monitoring (plugins/sysmon.py, widgets/scale.py, light.py)
const ZONES = { 1: [0, 1, 2], 0: [3, 4, 5, 6, 7], "-1": [8, 9, 10] };

export class Sysmon extends Plugin {
    constructor(engine) {
        super(engine, "sysmon", "시스템 감시", "topleft", 200);
        this.keys = new Set(["F1", "F2", "F3", "F4", "F5", "F6"]);
        Object.assign(this.params, {
            alerttimeout: 10000, automaticsolver: false, automaticsolverdelay: 1000, displayautomationstate: true,
            allowanykey: false, feedbackduration: 1500,
            feedbacks: { positive: { active: true, color: C.GREEN }, negative: { active: true, color: C.RED } },
            lights: {
                1: { name: "F5", failure: false, default: "on", oncolor: C.GREEN, key: "F5", on: true },
                2: { name: "F6", failure: false, default: "off", oncolor: C.RED, key: "F6", on: false },
            },
            scales: Object.fromEntries([1, 2, 3, 4].map((n) => [n, { name: `F${n}`, failure: false, side: 0, key: `F${n}` }])),
        });
        for (const g of this.gauges()) {
            Object.assign(g, { _failuretimer: null, _onfailure: false, _response_start: null, _onset: null, _freezetimer: null });
        }
        for (const s of this.scales()) {
            Object.assign(s, { _pos: 5, _zone: 0, _feedbacktimer: null, _feedbacktype: null });
        }
        this.automodePosition = [0.5, 0.05];
    }
    scales() {
        return Object.values(this.params.scales);
    }
    lights() {
        return Object.values(this.params.lights);
    }
    gauges() {
        return [...this.scales(), ...this.lights()];
    }
    isScale(g) {
        return this.scales().includes(g);
    }
    createWidgets() {
        super.createWidgets();
        const tc = this.taskContainer;
        const sw = tc.w * 0.1;
        Object.entries(this.params.scales).forEach(([n, s]) => {
            s.box = new Container(`scale_${n}`, tc.l + tc.w / 4 * (n - 1) + tc.w / 8 - sw / 2, tc.b + tc.h * 0.15, sw, tc.h * 0.5);
        });
        const lw = tc.w * 0.4;
        Object.entries(this.params.lights).forEach(([n, l]) => {
            l.box = new Container(`light_${n}`, tc.l + tc.w / 2 * (n - 1) + tc.w / 4 - lw / 2, tc.b + tc.h * 0.75, lw, tc.h * 0.15);
        });
    }
    canExecute(emulate) {
        if (!emulate) {
            return this.canReceiveKeys();
        }
        return this.params.automaticsolver && !this.paused && this.visible;
    }
    step() {
        // Automatic solver (agents/default_agent.py): solves a failure automaticsolverdelay ms after its start
        if (this.params.automaticsolver) {
            for (const g of this.gauges().filter((x) => x._onfailure)) {
                if (g._response_start !== null && (this.t - g._response_start) * 1000 >= this.params.automaticsolverdelay) {
                    this.onKey(g.key, "press", { t: this.t, emulate: true });
                }
            }
        }
        const dt = this.params.taskupdatetime;
        for (const g of this.gauges().filter((x) => x._onfailure)) {
            g._failuretimer -= dt;
            if (g._failuretimer <= 0) {
                this.stopFailure(g, false, this.params.automaticsolver ? "auto" : "");
            }
        }
        for (const s of this.scales()) {
            if (s._feedbacktimer !== null) {
                s._feedbacktimer -= dt;
                if (s._feedbacktimer <= 0) {
                    s._feedbacktimer = null;
                    s._feedbacktype = null;
                }
            }
        }
        for (const s of this.scales()) {
            const zone = ZONES[s._zone];
            if (!zone.includes(s._pos)) {
                s._pos = choice(zone);
            } else {
                const d = choice([-1, 1]);
                s._pos += zone.includes(s._pos + d) ? d : -d;
            }
            if (s._freezetimer !== null) {
                s._freezetimer -= dt;
                if (s._freezetimer > 0) {
                    s._pos = 5;
                } else {
                    s._freezetimer = null;
                }
            }
        }
        for (const g of this.gauges().filter((x) => x.failure)) {
            this.startFailure(g);
        }
    }
    startFailure(g) {
        if (!g._onfailure) {
            g._onfailure = true;
            if ("default" in g) {
                g.on = g.default !== "on";
            } else {
                if (![-1, 1].includes(g.side)) {
                    g.side = choice([-1, 1]);
                }
                g._zone = g.side;
            }
        }
        g.failure = false;
        g._response_start = this.t;
        g._onset = null;
        this.engine.onNextFlip((t) => {
            if (g._response_start !== null && g._onset === null) {
                g._onset = t;
            }
        });
        g._failuretimer = this.params.alerttimeout;
        g._failure = this.log.failure(this.t, g.name, Boolean(this.params.automaticsolver));
    }
    responseTimeMs(g, human, inputT) {
        if (!human || g._response_start === null) {
            return (this.t - g._response_start) * 1000;
        }
        return (inputT - (g._onset ?? g._response_start)) * 1000;
    }
    stopFailure(g, success, resolvedBy, inputT = this.t) {
        g._onfailure = false;
        g._failuretimer = null;
        const ft = this.params.automaticsolver || success ? "positive" : "negative";
        if (this.params.feedbacks[ft].active && this.isScale(g)) {
            g._feedbacktype = ft;
            g._feedbacktimer = this.params.feedbackduration;
        }
        if (success) {
            g._freezetimer = this.params.feedbackduration;
        }
        const sdt = ft === "positive" ? "HIT" : "MISS";
        const rt = sdt === "HIT" ? this.responseTimeMs(g, resolvedBy === "human", inputT) : NaN;
        this.log.perf(this.t, "sysmon", "name", g.name);
        this.log.perf(this.t, "sysmon", "signal_detection", sdt);
        this.log.perf(this.t, "sysmon", "response_time", rt);
        this.log.perf(this.t, "sysmon", "resolved_by", resolvedBy);
        this.log.sysmonOutcome(this.t, g._failure, sdt, rt, resolvedBy);
        g._failure = null;
        if ("default" in g) {
            g.on = g.default === "on";
        } else {
            g._zone = 0;
        }
        g._response_start = null;
    }
    onKey(key, state, { t, emulate }) {
        if (state !== "press" || !this.canExecute(emulate)) {
            return;
        }
        const resolver = emulate ? "agent" : "human";
        const g = this.gauges().find((x) => x.key === key);
        if (!g) {
            return;
        }
        if (g._onfailure) {
            this.stopFailure(g, true, resolver, t);
            return;
        }
        this.log.perf(this.t, "sysmon", "name", g.name);
        this.log.perf(this.t, "sysmon", "signal_detection", "FA");
        this.log.perf(this.t, "sysmon", "response_time", NaN);
        this.log.perf(this.t, "sysmon", "resolved_by", resolver);
        this.log.sysmonOutcome(this.t, null, "FA", NaN, resolver);
        if (this.params.feedbacks.negative.active && this.isScale(g)) {
            g._feedbacktype = "negative";
            g._feedbacktimer = this.params.feedbackduration;
        }
    }
    draw(p) {
        for (const s of this.scales()) {
            const c = s.box;
            const pos = (i) => c.b + c.h / 11 * i + c.h / 22;
            p.rect(c.l, c.b, c.w, c.h, C.WHITE, C.BLACK);
            const tw = c.w * 0.25;
            for (let i = 0; i < 11; i++) {
                p.line(c.x2 - (i === 5 ? tw + 8 : tw), pos(i), c.x2, pos(i), C.BLACK);
            }
            if (s._feedbacktimer !== null) {
                p.rect(c.x1, c.y2, c.w, 0.12 * c.h, this.params.feedbacks[s._feedbacktype].color);
            }
            const aw = 0.15 * c.w;
            const xo = 0.22 * c.w;
            const y = pos(s._pos);
            p.poly([[c.x2 - tw - xo, y], [c.x2 - tw - (xo + aw), y - aw / 2], [c.x2 - tw - (xo + aw), y + aw / 2]], C.BLACK);
            p.text(String(s.name).toUpperCase(), c.cx, c.b - 20, { size: F.MEDIUM });
        }
        for (const l of this.lights()) {
            const c = l.box;
            p.rect(c.l, c.b, c.w, c.h, l.on ? l.oncolor : C.BACKGROUND, C.BLACK);
            p.text(String(l.name).toUpperCase(), c.cx, c.cy, { size: F.MEDIUM });
        }
    }
}

// --------------------------------------------- Communications (plugins/communications.py, widgets/radio.py)
const CALLSIGN_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const CALLSIGN_DIGITS = "0123456789";

export class Communications extends Plugin {
    constructor(engine) {
        super(engine, "communications", "교신", "bottomleft", 80);
        this.keys = new Set(["UP", "DOWN", "RIGHT", "LEFT", "ENTER"]);
        Object.assign(this.params, {
            owncallsign: "", othercallsign: [], othercallsignnumber: 5, airbandminMhz: 108.0, airbandmaxMhz: 137.0,
            airbandminvariationMhz: 5, airbandmaxvariationMhz: 6, voicegender: "tts", voiceidiom: "korean",
            radioprompt: "", maxresponsedelay: 20000, promptlist: ["NAV_1", "NAV_2", "COM_1", "COM_2"],
            automaticsolver: false, displayautomationstate: true, feedbackduration: 1500, confirmflash: false,
            confirmflashduration: 500,
            feedbacks: { positive: { active: false, color: C.GREEN }, negative: { active: false, color: C.RED } },
            keys: { selectradioup: "UP", selectradiodown: "DOWN", tunefrequencyup: "RIGHT", tunefrequencydown: "LEFT",
                validateresponse: "ENTER" },
        });
        this.letters = CALLSIGN_LETTERS;
        this.digits = CALLSIGN_DIGITS;
        this.params.owncallsign = this.callsign();
        for (let i = 0; i < this.params.othercallsignnumber; i++) {
            this.params.othercallsign.push(this.callsign());
        }
        this.radios = this.params.promptlist.map((name, pos) => ({
            name, pos, currentfreq: this.randFreq(), targetfreq: null, _response_start: null, is_active: false,
            is_prompting: false, _feedbacktimer: null, _feedbacktype: null, _confirmtimer: null,
        }));
        this.player = null;
        this.automodePosition = [0.5, 0.2];
        this.hits = 0; // Correct responses by the participant (plugins/gate.py)
    }
    // [A-Z][A-Z][A-Z]\d\d\d without repeated characters; the characters of a callsign are not used by the next ones
    callsign() {
        if (this.letters.length < 3) {
            this.letters = CALLSIGN_LETTERS;
        }
        if (this.digits.length < 3) {
            this.digits = CALLSIGN_DIGITS;
        }
        const pick = (pool, n) => {
            const chars = [...pool];
            const out = [];
            for (let i = 0; i < n; i++) {
                out.push(chars.splice(Math.floor(Math.random() * chars.length), 1)[0]);
            }
            return out.join("");
        };
        const cs = pick(this.letters, 3) + pick(this.digits, 3);
        this.letters = [...this.letters].filter((c) => !cs.includes(c)).join("");
        this.digits = [...this.digits].filter((c) => !cs.includes(c)).join("");
        return cs;
    }
    randFreq() {
        return round1(this.params.airbandminMhz + Math.random() * (this.params.airbandmaxMhz - this.params.airbandminMhz));
    }
    createWidgets() {
        super.createWidgets();
        const active = Math.floor(Math.random() * this.radios.length);
        const tc = this.taskContainer;
        this.radios.forEach((r) => {
            r.is_active = r.pos === active;
            r.box = new Container(r.name, tc.l, tc.b + tc.h * (0.7 - 0.13 * r.pos), tc.w, tc.h * 0.1);
        });
    }
    pause() {
        super.pause();
        this.player?.pause();
    }
    resume() {
        super.resume();
        if (this.player && !this.player.done) {
            this.player.play();
        }
    }
    active() {
        return this.radios.find((r) => r.is_active);
    }
    targets() {
        return this.radios.filter((r) => r.targetfreq !== null);
    }
    waiting() {
        return this.radios.filter((r) => r.targetfreq !== null && !r.is_prompting);
    }
    elapsedMs(start) {
        return start === null ? 0 : (this.t - start) * 1000;
    }
    step() {
        const prompt = String(this.params.radioprompt).toLowerCase();
        if (prompt === "own" || prompt === "other") {
            let name = null;
            if (prompt === "own") {
                const free = this.radios.filter((r) => r.targetfreq === null);
                if (free.length) {
                    name = choice(free).name;
                }
            } else {
                name = choice(this.params.promptlist);
            }
            if (name !== null) {
                // A new prompt stops the one still spoken
                const prompting = this.radios.find((r) => r.is_prompting);
                if (prompting) {
                    this.player.delete();
                    prompting.is_prompting = false;
                }
                this.newPrompt(prompt, name);
            } else {
                this.params.radioprompt = "";
                this.log.manual(this.t, "communications", "Error. Could not trigger prompt");
            }
        }
        if (this.canReceiveKeys()) { // Frequency held down: one step of 0.1 per update
            if (this.engine.keysDown.has(this.params.keys.tunefrequencydown)) {
                this.active().currentfreq -= 0.1;
            } else if (this.engine.keysDown.has(this.params.keys.tunefrequencyup)) {
                this.active().currentfreq += 0.1;
            }
        }
        for (const r of this.targets()) {
            if (!r.is_prompting) {
                if (r._response_start === null) {
                    r._response_start = this.t; // The prompt has ended: the response time starts
                }
                if (this.elapsedMs(r._response_start) >= this.params.maxresponsedelay) {
                    this.recordMiss(r);
                }
            } else if (this.player.done) {
                r.is_prompting = false;
                this.log.manual(this.t, "communications", `Target ${r.name}:${r.targetfreq}`);
            }
        }
        const a = this.active();
        a.currentfreq = clamp(a.currentfreq, this.params.airbandminMhz, this.params.airbandmaxMhz);
        const dt = this.params.taskupdatetime;
        for (const r of this.radios) {
            if (r._feedbacktimer !== null && (r._feedbacktimer -= dt) <= 0) {
                r._feedbacktimer = null;
                r._feedbacktype = null;
            }
            if (r._confirmtimer !== null && (r._confirmtimer -= dt) <= 0) {
                r._confirmtimer = null;
            }
        }
    }
    newPrompt(destination, radioName) {
        this.params.radioprompt = "";
        const radio = this.radios.find((r) => r.name === radioName);
        const callsign = destination === "own" ? this.params.owncallsign : choice(this.params.othercallsign);
        let freq = this.randFreq();
        while (!(this.params.airbandminvariationMhz < Math.abs(freq - radio.currentfreq)
            && Math.abs(freq - radio.currentfreq) < this.params.airbandmaxvariationMhz)) {
            freq = this.randFreq();
        }
        const text = promptText(callsign, radioName, freq);
        const id = this.log.prompt(this.t, destination, radioName, freq, callsign, text);
        if (destination === "own") {
            radio.targetfreq = freq;
            radio.is_prompting = true;
            radio._promptId = id;
        }
        this.player = new Prompt(text, () => this.log.manual(this.t, "tts_fail", text));
        if (!this.paused) {
            this.player.play();
        }
    }
    recordMiss(r) {
        this.logResponse({ needed: true, target: r.name, responded: NaN, tfreq: r.targetfreq, rfreq: NaN, correct: false,
            deviation: NaN, rt: NaN, sdt: "MISS", by: "" });
        this.log.promptOutcome(this.t, r._promptId, "MISS");
        r._response_start = null;
        r.targetfreq = null;
        this.setFeedback(r, "negative");
    }
    logResponse(x) {
        const L = (n, v) => this.log.perf(this.t, "communications", n, v);
        L("response_was_needed", x.needed);
        L("target_radio", x.target);
        L("responded_radio", x.responded);
        L("target_frequency", x.tfreq);
        L("responded_frequency", x.rfreq);
        L("correct_radio", x.correct);
        L("response_deviation", x.deviation);
        L("response_time", x.rt);
        L("sdt_value", x.sdt);
        L("resolved_by", x.by);
    }
    setFeedback(r, ft) {
        if (this.params.feedbacks[ft].active) {
            r._feedbacktype = ft;
            r._feedbacktimer = this.params.feedbackduration;
        }
    }
    confirm(emulate, inputT) {
        const responded = this.active();
        const waiting = this.waiting();
        const needed = waiting.length > 0;
        const good = waiting.length ? waiting.includes(responded) : NaN;
        const measure = waiting.includes(responded) ? responded : waiting.length === 1 ? waiting[0] : null;
        let deviation = NaN;
        let rt = NaN;
        let tfreq = NaN;
        let target = NaN;
        if (measure) {
            tfreq = measure.targetfreq;
            target = measure.name;
            deviation = round1(responded.currentfreq - tfreq);
            rt = emulate ? this.elapsedMs(measure._response_start) : (inputT - measure._response_start) * 1000;
        }
        let sdt;
        if (!needed) {
            sdt = "FA";
        } else if (good && deviation === 0) {
            sdt = "HIT";
        } else if (good === false && deviation === 0) {
            sdt = "BAD_RADIO";
        } else if (deviation !== 0 && good) {
            sdt = "BAD_FREQ";
        } else {
            sdt = "BAD_RADIO_FREQ";
        }
        this.logResponse({ needed, target, responded: responded.name, tfreq, rfreq: responded.currentfreq, correct: good,
            deviation, rt, sdt, by: emulate ? "agent" : "human" });
        if (this.params.confirmflash && !emulate) {
            responded._confirmtimer = this.params.confirmflashduration;
        }
        if (sdt === "HIT" && !emulate) {
            this.hits += 1;
        }
        if (!needed) {
            this.setFeedback(responded, "negative");
        } else if (good && deviation === 0) {
            this.log.promptOutcome(this.t, responded._promptId, emulate ? "AGENT" : "HIT");
            responded._response_start = null;
            responded.targetfreq = null;
            this.setFeedback(responded, "positive");
        } else {
            this.setFeedback(responded, "negative");
        }
    }
    onKey(key, state, { t, emulate }) {
        if (state !== "press" || !(emulate || this.canReceiveKeys())) {
            return;
        }
        const k = this.params.keys;
        const a = this.active();
        if (key === k.selectradioup || key === k.selectradiodown) {
            const next = clamp(a.pos + (key === k.selectradioup ? -1 : 1), 0, this.radios.length - 1);
            a.is_active = false;
            this.radios.find((r) => r.pos === next).is_active = true;
        } else if (key === k.tunefrequencyup) {
            a.currentfreq += 0.1;
        } else if (key === k.tunefrequencydown) {
            a.currentfreq -= 0.1;
        } else if (key === k.validateresponse) {
            this.confirm(emulate, t);
        }
    }
    draw(p) {
        const tc = this.taskContainer;
        p.text(this.params.owncallsign, tc.cx, tc.b + tc.h * 0.9);
        for (const r of this.radios) {
            const c = r.box;
            const red = c.reduced(0.6, 0.9);
            if (r._confirmtimer !== null) {
                p.rect(red.l, red.b, red.w, red.h, [200, 238, 210]);
            }
            p.text(r.name.replace("_", " "), c.cx - 0.03 * c.w, c.cy, { align: "right" });
            p.text(r.currentfreq.toFixed(1), c.cx + 0.035 * c.w, c.cy, { align: "left" });
            if (r._feedbacktimer !== null) {
                p.rect(red.l, red.b, red.w, red.h, null, this.params.feedbacks[r._feedbacktype].color, 2);
            }
            if (r.is_active) {
                const s = 0.25 * c.h;
                const tri = (xr, dir) => {
                    const x = c.cx + xr * c.w;
                    const y = c.cy;
                    const pts = {
                        up: [[x - s / 2, y - s / 2], [x + s / 2, y - s / 2], [x, y + s / 2]],
                        down: [[x - s / 2, y + s / 2], [x + s / 2, y + s / 2], [x, y - s / 2]],
                        left: [[x + s / 2, y - s / 2], [x + s / 2, y + s / 2], [x - s / 2, y]],
                        right: [[x - s / 2, y - s / 2], [x - s / 2, y + s / 2], [x + s / 2, y]],
                    }[dir];
                    p.poly(pts, C.BLACK);
                };
                tri(-0.23, "up");
                tri(-0.2, "down");
                tri(0.2, "left");
                tri(0.23, "right");
            }
        }
    }
}

// ------------------------------- Resources management (plugins/resman.py, widgets/tank.py, pump.py, pumpflow.py)
const keyLabel = (key) => String(key).replace("NUM_", "").replace(/^_/, "") || key;

export class Resman extends Plugin {
    constructor(engine) {
        super(engine, "resman", "연료 관리", "bottommid", 2000);
        this.keys = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((n) => `NUM_${n}`));
        Object.assign(this.params, {
            automaticsolver: false, displayautomationstate: true, pumpcoloroff: C.WHITE, pumpcoloron: C.GREEN,
            pumpcolorfailure: C.RED, toleranceradius: 250, statuslocation: "bottomright", displaystatus: true,
            tank: {
                a: { level: 2500, max: 4000, target: 2500, depletable: true, lossperminute: 800, _infoside: "left" },
                b: { level: 2500, max: 4000, target: 2500, depletable: true, lossperminute: 800, _infoside: "right" },
                c: { level: 1000, max: 2000, target: null, depletable: true, lossperminute: 0, _infoside: "left" },
                d: { level: 1000, max: 2000, target: null, depletable: true, lossperminute: 0, _infoside: "left" },
                e: { level: 3000, max: 4000, target: null, depletable: false, lossperminute: 0, _infoside: "right" },
                f: { level: 3000, max: 4000, target: null, depletable: false, lossperminute: 0, _infoside: "right" },
            },
            pump: {
                1: { flow: 800, state: "off", key: "NUM_1", _from: "c", _to: "a" },
                2: { flow: 600, state: "off", key: "NUM_2", _from: "e", _to: "a" },
                3: { flow: 800, state: "off", key: "NUM_3", _from: "d", _to: "b" },
                4: { flow: 600, state: "off", key: "NUM_4", _from: "f", _to: "b" },
                5: { flow: 600, state: "off", key: "NUM_5", _from: "e", _to: "c" },
                6: { flow: 600, state: "off", key: "NUM_6", _from: "f", _to: "d" },
                7: { flow: 400, state: "off", key: "NUM_7", _from: "a", _to: "b" },
                8: { flow: 400, state: "off", key: "NUM_8", _from: "b", _to: "a" },
            },
        });
        this.automodePosition = [0.48, 0.55];
        this.waitBeforeLeak = 1;
        this.inTolerance = { a: true, b: true };
    }
    createWidgets() {
        super.createWidgets();
        const tc = this.taskContainer;
        const h = 0.35 * tc.h;
        const [small, medium, large] = [0.1, 0.12, 0.15].map((x) => x * tc.w);
        const lower = tc.b + 0.15 * tc.h;
        const upper = tc.b + 0.55 * tc.h;
        const lp = { a: 0.14, b: 0.64, c: 0.05, d: 0.55, e: 0.3, f: 0.8 };
        const L = (k) => tc.l + tc.w * lp[k];
        const boxes = {
            a: new Container("a", L("a"), upper, large, h), b: new Container("b", L("b"), upper, large, h),
            c: new Container("c", L("c"), lower, small, h), d: new Container("d", L("d"), lower, small, h),
            e: new Container("e", L("e"), lower, medium, h), f: new Container("f", L("f"), lower, medium, h),
        };
        for (const [k, t] of Object.entries(this.params.tank)) {
            t.box = boxes[k];
        }
        const width = 0.028 * tc.w;
        for (const [n, pump] of Object.entries(this.params.pump)) {
            const from = this.params.tank[pump._from].box;
            const to = this.params.tank[pump._to].box;
            let yo = n === "7" ? 0.055 * tc.h : 0;
            if (from.cx === to.cx || from.cy === to.cy) {
                pump.lines = [[from.cx, from.cy + yo, to.cx, to.cy + yo]];
                const x1 = Math.min(from.cx, to.cx);
                const x2 = Math.max(from.cx, to.cx);
                const s = from.cx > to.cx ? -1 : 1;
                const x = x1 + (x2 - x1) / 2 + s * width / 2;
                const y = from.cy + yo;
                const w = from.cx > to.cx ? width : -width;
                const hh = Math.abs(w);
                pump.tri = [[x, y], [x + w, y + hh / 2], [x + w, y - hh / 2]];
                pump.num = [x + w * 0.7, y + 2];
            } else {
                yo = -yo - 20;
                pump.lines = [[from.cx, from.cy, from.cx, to.cy + yo], [to.cx, to.cy + yo, from.cx, to.cy + yo]];
                const x = from.cx;
                const y = from.cy + from.h / 2 + width * 2;
                pump.tri = [[x, y], [x - width / 2, y - width], [x + width / 2, y - width]];
                pump.num = [x, y - width / 2 - 3];
            }
        }
        const sc = this.engine.containers[this.params.statuslocation];
        this.statusTitle = sc.reduceAndTranslate(1, 0.1, 0, 1);
        this.statusRows = Object.keys(this.params.pump).map((n) => new Container(`flow_${n}`, sc.l,
            sc.b + sc.h * (0.8 - 0.1 * (n - 1)), sc.w, sc.h * 0.1));
    }
    step() {
        const tanks = this.params.tank;
        const pumps = this.params.pump;
        const res = (this.params.taskupdatetime / 1000) / 60;
        if (this.waitBeforeLeak > 0) {
            this.waitBeforeLeak -= 1;
        } else {
            for (const t of Object.values(tanks)) {
                if (t.target !== null) {
                    t.level -= Math.min(Math.trunc(t.lossperminute * res), t.level);
                }
            }
            for (const p of Object.values(pumps)) {
                if (p.state === "on") {
                    const from = tanks[p._from];
                    const to = tanks[p._to];
                    const volume = Math.min(p.flow * res, from.level);
                    if (from.depletable) {
                        from.level -= Math.trunc(volume);
                    }
                    to.level += Math.min(Math.trunc(volume), to.max - to.level);
                }
            }
        }
        for (const [k, t] of Object.entries(tanks)) {
            let off = [];
            if (t.level >= t.max) {
                off = Object.values(pumps).filter((p) => p._to === k);
            } else if (t.level <= 0) {
                off = Object.values(pumps).filter((p) => p._from === k);
            }
            off.filter((p) => p.state !== "failure").forEach((p) => (p.state = "off"));
            if (t.target !== null) {
                const r = this.params.toleranceradius;
                const inTol = t.target - r <= t.level && t.level <= t.target + r;
                this.inTolerance[k] = inTol;
                this.log.perf(this.t, "resman", `${k}_in_tolerance`, inTol);
                this.log.perf(this.t, "resman", `${k}_deviation`, t.level - t.target);
                this.log.level(this.t, k, t.level);
            }
        }
    }
    onKey(key, state, { emulate }) {
        if (state !== "press" || !(emulate || this.canReceiveKeys())) {
            return;
        }
        const pump = Object.values(this.params.pump).find((p) => p.key === key);
        if (pump && pump.state !== "failure") {
            pump.state = pump.state === "off" ? "on" : "off";
        }
    }
    draw(p) {
        const tanks = this.params.tank;
        for (const pump of Object.values(this.params.pump)) {
            for (const l of pump.lines) {
                p.line(...l, C.BLACK);
            }
        }
        for (const [k, t] of Object.entries(tanks)) {
            const c = t.box;
            const yOf = (lv) => c.y2 + (c.y1 - c.y2) * (lv / t.max);
            p.rect(c.l, c.b, c.w, c.h, C.WHITE);
            if (t.target !== null) {
                const r = this.params.toleranceradius;
                const tl = t._infoside === "left" ? c.l - 15 : c.l + c.w;
                p.rect(tl, yOf(t.target - r), 15, yOf(r * 2) - yOf(0), C.BLACK);
            }
            p.rect(c.l, c.b, c.w, yOf(t.level) - c.y2, C.GREEN);
            p.rect(c.l, c.b, c.w, c.h, null, C.BLACK);
            if (t.depletable) {
                p.text(String(t.level), c.cx, c.y2 - 15);
            }
            p.text(k.toUpperCase(), t._infoside === "left" ? c.x1 - 15 : c.x2 + 15, c.y1 - 10);
        }
        for (const pump of Object.values(this.params.pump)) {
            p.poly(pump.tri, this.params[`pumpcolor${pump.state}`], C.BLACK);
            p.text(keyLabel(pump.key), pump.num[0], pump.num[1], { size: 10 });
        }
        if (this.params.displaystatus) {
            p.text("펌프 상태", this.statusTitle.cx, this.statusTitle.cy, { size: F.MEDIUM, color: C.WHITE });
            Object.values(this.params.pump).forEach((pump, i) => {
                const c = this.statusRows[i];
                p.text(keyLabel(pump.key), c.l + c.w * 0.3, c.cy, { align: "left" });
                p.text(String(pump.state === "on" ? pump.flow : 0), c.l + c.w * 0.7, c.cy, { align: "right" });
                const s = 0.25 * c.h;
                const x = c.cx - 0.05 * c.w;
                p.poly([[x - s / 2, c.cy - s / 2], [x - s / 2, c.cy + s / 2], [x + s / 2, c.cy]], C.BLACK);
            });
        }
    }
}

// ------------------------------------------------- Slides (plugins/instructions.py) and guides (plugins/guide.py)
const RESPONSE_TEXT = "스페이스 바를 누르면 계속합니다";

function slidesOf(text) {
    const slides = [""];
    for (const line of text.split(/\r?\n/)) {
        if (line.includes("#")) {
            continue;
        }
        if (line.includes("<newpage>")) {
            slides.push("");
        } else {
            slides[slides.length - 1] += line + "\n";
        }
    }
    return slides;
}

// Only the tags of the slide files: h1, p, strong, br, center
function slideHTML(slide) {
    const lines = slide.split("\n");
    const titleIndex = lines.map((l, i) => (l.includes("<h1>") ? i : -1)).filter((i) => i >= 0).pop();
    const title = titleIndex === undefined ? "" : lines.splice(titleIndex, 1)[0];
    return { title, body: lines.join("\n") };
}

export class Instructions extends Plugin {
    constructor(engine, files) {
        super(engine, "instructions", "", "fullscreen", 15);
        this.files = files; // name -> text
        this.blocking = true;
        this.keys = new Set(["SPACE"]);
        this.params.filename = null;
        this.slides = [];
        this.el = null;
    }
    start() {
        this.slides = slidesOf(this.files[this.params.filename] ?? "");
        super.start();
        this.next();
    }
    stop() {
        super.stop();
        this.el?.remove();
        this.el = null;
    }
    next() {
        if (!this.slides.length) {
            this.stop();
            return;
        }
        this.showSlide(this.slides.shift());
    }
    makeElement(className) {
        this.el?.remove();
        this.el = document.createElement("div");
        this.el.className = className;
        this.engine.overlay.append(this.el);
        return this.el;
    }
    showSlide(slide) {
        const { title, body } = slideHTML(slide);
        const el = this.makeElement("slide");
        el.innerHTML = `<div class="slide-title">${title}</div><div class="slide-body">${body}</div>`
            + `<div class="slide-next">${RESPONSE_TEXT}</div>`;
        this.place();
    }
    place() {
        if (this.el) {
            const r = this.engine.painter.cssRect(this.engine.containers.fullscreen);
            Object.assign(this.el.style, Object.fromEntries(Object.entries(r).map(([k, v]) => [k, `${v}px`])));
            this.el.style.fontSize = `${Math.max(11, 22 * this.engine.painter.s)}px`;
        }
    }
    onKey(key, state) {
        // Slides advance on the SPACE release
        if (key === "SPACE" && state === "release" && this.alive && !this.paused) {
            this.next();
        }
    }
    draw() {
        this.place();
    }
}

export class Guide extends Instructions {
    constructor(engine, files) {
        super(engine, files);
        this.alias = "guide";
        this.keepTasksVisible = true;
        Object.assign(this.params, { area: "right", highlight: "none", highlightbox: "0,0,1,1" });
    }
    guideContainer() {
        const w = this.engine.vw;
        const h = this.engine.vh;
        const m = 0.015 * Math.min(w, h);
        switch (this.params.area) {
            case "right": return new Container("guide", 0.37 * w + m, m, 0.63 * w - 2 * m, h - 2 * m);
            case "top": return new Container("guide", m, h / 2 + m, w - 2 * m, h / 2 - 2 * m);
            case "bottom": return new Container("guide", m, m, w - 2 * m, h / 2 - 2 * m);
            default: return new Container("guide", 0.15 * w, 0.12 * h, 0.7 * w, 0.76 * h);
        }
    }
    highlightContainer() {
        if (this.params.highlight === "none") {
            return null;
        }
        const t = this.engine.containers[this.params.highlight];
        const [x, y, w, h] = String(this.params.highlightbox).split(",").map(Number);
        if (!t || [x, y, w, h].some(Number.isNaN)) {
            return t || null;
        }
        return new Container("highlight", t.l + x * t.w, t.b + y * t.h, w * t.w, h * t.h);
    }
    showSlide(slide) {
        const { title, body } = slideHTML(slide);
        const el = this.makeElement("guide");
        el.innerHTML = `<div class="slide-title">${title}</div><div class="slide-body">${body}</div>`
            + `<div class="slide-next">${RESPONSE_TEXT}</div>`;
        this.place();
    }
    place() {
        if (this.el) {
            const r = this.engine.painter.cssRect(this.guideContainer());
            Object.assign(this.el.style, Object.fromEntries(Object.entries(r).map(([k, v]) => [k, `${v}px`])));
            this.el.style.fontSize = `${Math.max(11, 22 * this.engine.painter.s)}px`;
        }
    }
    draw(p) {
        this.place();
        const hc = this.highlightContainer();
        if (hc) {
            const t = 0.03 * Math.min(hc.w, hc.h);
            p.rect(hc.l, hc.b, hc.w, hc.h, null, C.ORANGE, Math.max(2, t * p.s));
        }
    }
}

// --------------------------------------------------------------------------------------- Gate (plugins/gate.py)
export class Gate extends Plugin {
    constructor(engine, comm) {
        super(engine, "gate", "", "invisible", 50);
        this.comm = comm;
        this.params.skipto = 0;
        this.hitsAtStart = 0;
    }
    createWidgets() {}
    start() {
        super.start();
        this.hitsAtStart = this.comm.hits;
    }
    step() {
        if (this.t >= this.params.skipto) {
            this.stop();
        } else if (this.comm.hits > this.hitsAtStart) {
            if (this.params.skipto > this.t) {
                this.engine.skipTo = this.params.skipto;
                this.log.manual(this.t, "gate", `Gate passed at ${this.t.toFixed(2)}, skip to ${this.params.skipto}`);
            }
            this.stop();
        }
    }
}

export { rgb };
