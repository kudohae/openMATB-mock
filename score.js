// Session log, summary scores and result code (core/korean_score.py).
// The result code keeps its format: "OM1-" + base64 of {"j": json, "c": fnv1a(json)}, read by decode.html.
// Changes from korean_score.py: the sessions run by this engine say so (eng "js1"); the split halves of the
// communications count prompts (odd and even own prompts answered right), not responses; the malfunctions missed
// by the automation are known from the engine instead of matched by time; tts_fail counts the prompts whose speech
// was ended by the watchdog.

export const ENGINE = "js1";

export class Log {
    constructor() {
        this.perfRows = []; // { t, m, a, v }
        this.events = []; // Scenario events executed: [t, plugin, command]
        this.manualRows = []; // [t, key, value]
        this.keys = []; // [t, key]
        this.freezes = []; // [t, ms]
        this.failures = []; // { id, t, name, auto }
        this.sysmon = []; // { t, failure, sdt, rt, by }
        this.prompts = []; // { id, t, destination, radio, freq, callsign, outcome, tOutcome }
        this.levels = []; // [t, tank, level]
        this.trackSeconds = new Map(); // second -> [n, nIn, sumSquares]
    }
    perf(t, m, a, v) {
        this.perfRows.push({ t, m, a, v });
        if (m === "track") {
            const s = Math.floor(t);
            const agg = this.trackSeconds.get(s) || [0, 0, 0];
            if (a === "cursor_in_target") {
                agg[0] += 1;
                agg[1] += v ? 1 : 0;
            } else if (a === "center_deviation") {
                agg[2] += v * v;
            }
            this.trackSeconds.set(s, agg);
        }
    }
    event(t, plugin, command) {
        this.events.push([round(t, 3), plugin, command]);
    }
    manual(t, key, value) {
        this.manualRows.push([round(t, 3), key, value]);
    }
    freeze(t, ms) {
        this.freezes.push([round(t, 3), ms]);
    }
    key(t, name) {
        this.keys.push([round(t, 3), name]);
    }
    failure(t, name, auto) {
        const f = { id: this.failures.length, t, name, auto };
        this.failures.push(f);
        return f;
    }
    sysmonOutcome(t, failure, sdt, rt, by) {
        this.sysmon.push({ t, failure, sdt, rt, by });
    }
    prompt(t, destination, radio, freq, callsign, text) {
        const id = this.prompts.length;
        this.prompts.push({ id, t, destination, radio, freq, callsign, text, outcome: null, tOutcome: null });
        return id;
    }
    promptOutcome(t, id, outcome) {
        const p = this.prompts[id];
        if (p && p.outcome === null) {
            p.outcome = outcome;
            p.tOutcome = t;
        }
    }
    level(t, tank, level) {
        this.levels.push([round(t, 1), tank, level]);
    }
    // Raw data for the researcher (DataPipe): everything but the 50 Hz tracking rows, kept per second instead
    compact(meta) {
        return {
            meta,
            events: this.events,
            manual: this.manualRows,
            keys: this.keys,
            freezes: this.freezes,
            failures: this.failures.map((f) => [round(f.t, 3), f.name, f.auto]),
            sysmon: this.sysmon.map((s) => [round(s.t, 3), s.failure ? s.failure.id : null, s.sdt, numOrNull(s.rt, 0), s.by]),
            comm: this.perfRows.filter((r) => r.m === "communications").map((r) => [round(r.t, 3), r.a, jsonValue(r.v)]),
            prompts: this.prompts.map((p) => [round(p.t, 3), p.destination, p.radio, p.freq, p.callsign, p.outcome,
                p.tOutcome === null ? null : round(p.tOutcome, 3)]),
            tank_levels: this.levels,
            track_per_second: [...this.trackSeconds].map(([s, [n, nIn, sq]]) => [s, n, nIn, round(sq, 1)]),
        };
    }
}

const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;
const numOrNull = (x, d = 2) => (x === null || x === undefined || Number.isNaN(x) ? null : round(x, d));
const jsonValue = (v) => (typeof v === "number" && Number.isNaN(v) ? null : v);
const mean = (xs) => {
    const v = xs.filter((x) => !Number.isNaN(x));
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const rms = (xs) => (xs.length ? Math.sqrt(xs.reduce((a, d) => a + d * d, 0) / xs.length) : null);

export function score(log, phases, env) {
    const out = { eng: ENGINE, browser: env.browser.slice(0, 40), voice: env.voice.slice(0, 40), win_h: env.winH };
    const inWindow = (name, t) => phases[name][0] <= t && t < phases[name][1];

    for (const [phase, prefix] of [["A_main", "A"], ["B_main", "B"]]) {
        const perf = log.perfRows.filter((r) => r.m === "track" && inWindow(phase, r.t));
        const inside = perf.filter((r) => r.a === "cursor_in_target").map((r) => r.v);
        const dev = perf.filter((r) => r.a === "center_deviation").map((r) => r.v);
        out[`${prefix}_trk_in`] = inside.length ? numOrNull(100 * inside.filter(Boolean).length / inside.length) : null;
        out[`${prefix}_trk_rms`] = numOrNull(rms(dev));
        const [start, end] = phases[phase];
        const middle = (start + end) / 2;
        const devRows = perf.filter((r) => r.a === "center_deviation");
        out[`${prefix}_trk_rms_h1`] = numOrNull(rms(devRows.filter((r) => r.t < middle).map((r) => r.v)));
        out[`${prefix}_trk_rms_h2`] = numOrNull(rms(devRows.filter((r) => r.t >= middle).map((r) => r.v)));
    }

    // System monitoring (B_main), outcomes logged in the window
    const sm = log.sysmon.filter((s) => inWindow("B_main", s.t));
    const humanHits = sm.filter((s) => s.sdt === "HIT" && s.by === "human");
    out.B_sm_hit = humanHits.length;
    out.B_sm_auto = sm.filter((s) => s.sdt === "HIT" && s.by !== "human").length;
    out.B_sm_miss = sm.filter((s) => s.sdt === "MISS").length;
    out.B_sm_fa = sm.filter((s) => s.sdt === "FA").length;
    out.B_sm_rt = numOrNull(mean(humanHits.map((s) => s.rt)), 0);

    // Main criterion: the malfunctions started with the automation off, handled by the participant
    const manual = log.failures.filter((f) => inWindow("B_main", f.t) && !f.auto);
    const manHits = log.sysmon.filter((s) => s.failure && manual.includes(s.failure) && s.sdt === "HIT" && s.by === "human");
    out.B_sm_man_n = manual.length;
    out.B_sm_man_hit = manHits.length;
    out.B_sm_man_hit_o = manHits.filter((s) => manual.indexOf(s.failure) % 2 === 0).length; // 1st, 3rd, 5th...
    out.B_sm_man_hit_e = manHits.filter((s) => manual.indexOf(s.failure) % 2 === 1).length;
    out.B_sm_man_rt = numOrNull(mean(manHits.map((s) => s.rt)), 0);

    // Communications (A_main and B_main): one sdt_value and one response_time per response or miss
    for (const [phase, prefix] of [["A_main", "A"], ["B_main", "B"]]) {
        const com = log.perfRows.filter((r) => r.m === "communications" && inWindow(phase, r.t));
        const sdt = com.filter((r) => r.a === "sdt_value").map((r) => r.v);
        const rts = com.filter((r) => r.a === "response_time").map((r) => r.v);
        for (const v of ["HIT", "MISS", "FA", "BAD_RADIO", "BAD_FREQ", "BAD_RADIO_FREQ"]) {
            out[`${prefix}_cm_${v.toLowerCase()}`] = sdt.filter((s) => s === v).length;
        }
        out[`${prefix}_cm_rt`] = numOrNull(mean(sdt.map((s, i) => (s === "HIT" ? rts[i] : NaN))), 0);
        // Split halves: own prompts of the window in order, answered right or not
        const own = log.prompts.filter((p) => p.destination === "own" && inWindow(phase, p.t));
        out[`${prefix}_cm_hit_o`] = own.filter((p, i) => i % 2 === 0 && p.outcome === "HIT").length;
        out[`${prefix}_cm_hit_e`] = own.filter((p, i) => i % 2 === 1 && p.outcome === "HIT").length;
    }

    // Resources management (B_main)
    const res = log.perfRows.filter((r) => r.m === "resman" && inWindow("B_main", r.t));
    for (const tank of ["a", "b"]) {
        const flags = res.filter((r) => r.a === `${tank}_in_tolerance`).map((r) => r.v);
        out[`B_rm_${tank}`] = flags.length ? numOrNull(100 * flags.filter(Boolean).length / flags.length) : null;
    }
    const both = [out.B_rm_a, out.B_rm_b].filter((x) => x !== null);
    out.B_rm = both.length ? numOrNull(both.reduce((a, b) => a + b, 0) / both.length) : null;

    // Quality
    out.hidden = log.manualRows.filter(([, k, v]) => k === "visibility" && v === "hidden").length;
    out.pointer_lost = log.manualRows.filter(([, k]) => k === "pointerlock_lost").length;
    out.freeze_ms = Math.round(env.freezeMs);
    out.tts_fail = env.ttsFail;
    out.file = env.file;
    return out;
}

export function fnv1a(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36);
}

// JSON with only ASCII characters (like Python json.dumps(ensure_ascii=True)), so that btoa and the checksum work
export function asciiJSON(value) {
    return JSON.stringify(value).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

export function resultCode(result) {
    const j = asciiJSON(result);
    return "OM1-" + btoa(asciiJSON({ j, c: fnv1a(j) }));
}
