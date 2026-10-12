// Korean study page: start page, task session (engine.js, tasks.js), result code, visit log, DataPipe.
import { Engine, parseScenario } from "./engine.js";
import { Communications, Gate, Guide, Instructions, Resman, Sysmon, Track } from "./tasks.js";
import { ENGINE, Log, resultCode, score } from "./score.js";
import { TTS } from "./tts.js";

// ---- Settings ----
const SURVEY_URL = "https://docs.google.com/forms/d/e/1FAIpQLSeHJadxow6QJEfFohzVg2eAZvxSjQc6Xk4_qGrP_Wxw7GW0Qw/viewform?usp=pp_url&entry.1248882849={code}";
const VISIT_LOG = "https://docs.google.com/forms/d/e/1FAIpQLScuKK6QTl_JDZYfGo29X3i2W8Tl49WMwYxZPXSYX2sqdWyybg/formResponse";
const DATAPIPE_URL = "https://pipe.jspsych.org/api/data/";
const DATAPIPE_EXPERIMENT = "0pFjuhJjyaVV"; // DataPipe experiment ID: the raw data of each session is sent there when set
const MIN_WINDOW = [800, 480]; // CSS pixels: a maximized window of a 1366x768 laptop at 125 % scaling is about 1093x490
const SAMPLE_PROMPT = "에이, 비, 씨, 하나, 둘, 삼, 에이, 비, 씨, 하나, 둘, 삼, 무전기, 컴, 원, 주파수, 하나, 둘, 여섯, 쩜, 오.";

const QUERY = new URLSearchParams(location.search);
const FAST = QUERY.get("fast") === "1";
const BOT = QUERY.get("bot") === "1";
const $ = (id) => document.getElementById(id);
const IS_MOBILE = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
    || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)); // iPadOS reports a Mac

function browserName() {
    const ua = navigator.userAgent;
    const name = /Edg\//.test(ua) ? "Edge" : /Whale\//.test(ua) ? "Whale" : /SamsungBrowser/.test(ua) ? "Samsung"
        : /KAKAOTALK/i.test(ua) ? "KakaoTalk" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome"
            : /Safari\//.test(ua) ? "Safari" : "other";
    const version = (ua.match(/(?:Edg|Whale|Firefox|Chrome|Version)\/([\d.]+)/) || [])[1] || "";
    return `${name} ${version}`.trim();
}

// ---- Visit log: one anonymous row (stage, device) per step, in a Google Form of the researcher ----
function logVisit(stage) {
    const body = new URLSearchParams({
        "entry.1949545432": FAST ? `${stage} (fast)` : stage,
        "entry.1369225893": `${IS_MOBILE ? "mobile" : "pc"} ${browserName().split(" ")[0]} ${ENGINE}`,
    });
    if (BOT) {
        return;
    }
    fetch(VISIT_LOG, { method: "POST", mode: "no-cors", body, keepalive: true }).catch(() => {});
}

// ---- Start page ----
const PRE_QUESTIONS = [ // Merritt et al. (2013), researcher's translation, t2 reverse-keyed
    ["t1", "나는 이유가 생기기 전까지는 대체로 기계를 믿는다."],
    ["t2", "대체로 나는 기계를 믿지 않는다."],
    ["t3", "일반적으로 나는 기계의 도움에 기댈 것이다."],
    ["t4", "기계를 믿는 내 성향은 강한 편이다."],
    ["t5", "기계가 제 할 일을 하리라고 믿는 것은 내게 쉬운 일이다."],
    ["t6", "잘 모르는 기계라도 나는 믿는 편이다."],
];
const preAnswers = {};
let soundChecked = false;
let content = null; // { scenario, files }

function buildPreQuestions(onChange) {
    const add = (key, text, options) => {
        const item = document.createElement("div");
        item.className = "pre-q";
        const p = document.createElement("p");
        p.textContent = text;
        const scale = document.createElement("div");
        scale.className = "scale";
        for (const [value, label] of options) {
            const l = document.createElement("label");
            const input = document.createElement("input");
            input.type = "radio";
            input.name = `pre-${key}`;
            input.value = value;
            input.addEventListener("change", () => {
                preAnswers[key] = Number(value);
                onChange();
            });
            l.append(input, label);
            scale.append(l);
        }
        item.append(p, scale);
        $("pre-questions").append(item);
    };
    PRE_QUESTIONS.forEach(([key, text], i) => add(key, `${i + 1}. ${text}`, [1, 2, 3, 4, 5].map((v) => [v, String(v)])));
    add("before", `${PRE_QUESTIONS.length + 1}. 이 테스트를 전에 해 본 적이 있나요?`, [[0, "아니요"], [1, "예"]]);
}
const preDone = () => PRE_QUESTIONS.every(([k]) => k in preAnswers) && "before" in preAnswers;
const bigEnough = () => innerWidth >= MIN_WINDOW[0] && innerHeight >= MIN_WINDOW[1];

function showStart() {
    const ready = soundChecked && $("agree").checked && preDone() && content !== null;
    $("size-warning").hidden = !ready || bigEnough();
    $("start").hidden = !ready || !bigEnough();
}

function setupMobile() {
    $("study").hidden = true;
    $("mobile-warning").hidden = false;
    const url = location.origin + location.pathname;
    $("m-url").textContent = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
    if (navigator.share) {
        $("m-share").hidden = false;
        $("m-share").onclick = async () => {
            try {
                await navigator.share({ title: "다중과업 수행 연구 (PC에서 열기)", url });
                $("m-done").textContent = "보냈습니다. PC에서 열어 주세요.";
                logVisit("휴대폰 링크 공유");
            } catch {
                // Share sheet closed
            }
        };
    }
    $("m-copy").onclick = async () => {
        try {
            await navigator.clipboard.writeText(url);
        } catch {
            window.prompt("링크를 길게 눌러 복사해 주세요.", url);
        }
        $("m-done").textContent = "링크를 복사했습니다. 카톡 나와의 채팅이나 메모에 붙여 두고 PC에서 열어 주세요.";
        logVisit("휴대폰 링크 복사");
    };
}

async function loadContent() {
    const scenarioText = await (await fetch("content/study.txt")).text();
    const scenario = parseScenario(scenarioText);
    const names = [...new Set(scenario.events.filter((e) => e.command[0] === "filename").map((e) => e.command[1]))];
    const files = {};
    await Promise.all(names.map(async (name) => {
        const response = await fetch(`content/instructions/${name.replace(/^korean\//, "")}`);
        if (!response.ok) {
            throw new Error(`${name}: HTTP ${response.status}`);
        }
        files[name] = await response.text();
    }));
    return { scenario, files };
}

function setupStartPage() {
    logVisit(IS_MOBILE ? "열람(휴대폰, 차단됨)" : "열람");
    if (IS_MOBILE) {
        setupMobile();
        return;
    }
    buildPreQuestions(showStart);
    $("agree").addEventListener("change", showStart);
    window.addEventListener("resize", showStart);
    $("sound-play").addEventListener("click", async () => {
        const hasVoice = TTS.supported && await TTS.waitForKoreanVoice();
        if (!hasVoice) {
            // No Korean voice: the communications task cannot be done
            $("sound-voice").textContent = "이 브라우저에서 한국어 음성을 찾지 못해 참여할 수 없습니다. Chrome이나 Edge로 열어 주세요.";
            return;
        }
        $("sound-voice").textContent = `사용할 음성: ${TTS.voiceName()}`;
        TTS.speak(SAMPLE_PROMPT, () => {});
        $("sound-ok").disabled = false;
    });
    $("sound-ok").addEventListener("click", () => {
        soundChecked = true;
        $("sound-ok").textContent = "확인했습니다";
        $("sound-ok").disabled = true;
        showStart();
    });
    loadContent().then((c) => {
        content = c;
        showStart();
    }).catch((error) => {
        $("load-error").hidden = false;
        $("load-error").textContent = `불러오기 실패: ${error.message || error}. 새로고침해 주세요.`;
        logVisit(`오류: ${String(error.message || error).slice(0, 150)}`);
    });
    $("start").addEventListener("click", startSession);
}

// ---- Mouse: pointer lock (web/mouse_tracking.js). The tasks pause while the tracking task needs the pointer and it
// is not locked, or while the page is hidden; a click (or any key except Esc) locks it again and resumes. ----
const mouse = {
    dx: 0, dy: 0, wanted: false, locked: false, lostUnread: false, session: false, suspended: false, pending: false,
    lock() {
        mouse.session = true;
        if (!document.pointerLockElement) {
            mouse.pending = true;
            const settled = () => {
                mouse.pending = false;
                mouse.refresh();
            };
            const request = document.documentElement.requestPointerLock?.();
            request?.then?.(settled, settled);
            setTimeout(settled, 1500); // Also for the browsers whose requestPointerLock returns nothing
        }
    },
    refresh() {
        if (mouse.locked) {
            mouse.suspended = false;
        } else if (mouse.wanted && mouse.session && !mouse.pending) {
            mouse.suspended = true;
        }
        $("pause-notice").hidden = !mouse.suspended;
        document.body.classList.toggle("pointer-paused", mouse.suspended);
    },
    take() {
        if (mouse.lostUnread) {
            mouse.lostUnread = false;
            return "lost";
        }
        if (!mouse.dx && !mouse.dy) {
            return null;
        }
        const moved = [mouse.dx, mouse.dy];
        mouse.dx = mouse.dy = 0;
        return moved;
    },
    setWanted(w) {
        mouse.wanted = Boolean(w);
        mouse.refresh();
    },
    release() {
        mouse.session = false;
        mouse.wanted = false;
        mouse.suspended = false;
        if (document.pointerLockElement) {
            document.exitPointerLock();
        }
        mouse.refresh();
    },
};
document.addEventListener("mousemove", (e) => {
    if (document.pointerLockElement) {
        mouse.dx += e.movementX;
        mouse.dy += e.movementY;
    }
});
document.addEventListener("pointerlockchange", () => {
    const was = mouse.locked;
    mouse.locked = Boolean(document.pointerLockElement);
    if (was && !mouse.locked && mouse.wanted) {
        mouse.lostUnread = true;
    }
    mouse.dx = mouse.dy = 0;
    mouse.refresh();
});
document.addEventListener("mousedown", () => {
    if (mouse.session && !document.pointerLockElement) {
        mouse.lock();
    }
}, true);

// ---- Keyboard: physical keys (event.code), whatever the input method (Korean IME) ----
function keyName(code) {
    if (/^Key[A-Z]$/.test(code)) {
        return code[3];
    }
    if (/^(Digit|Numpad)[0-9]$/.test(code)) {
        return `_${code.slice(-1)}`;
    }
    return { Space: "SPACE", Enter: "ENTER", NumpadEnter: "ENTER", ArrowUp: "UP", ArrowDown: "DOWN", ArrowLeft: "LEFT",
        ArrowRight: "RIGHT", Escape: "ESCAPE" }[code] || null;
}

// ---- Session ----
let engine = null;
let log = null;
let sessionFile = "";
let abortReason = null;
let ended = false;

function newSessionFile() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    const rand = Math.floor(100000 + Math.random() * 900000);
    return `${rand}_${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.csv`;
}

function startSession() {
    mouse.lock(); // Needs the click
    logVisit("시작");
    $("menu").hidden = true;
    $("task").hidden = false;
    sessionFile = newSessionFile();
    log = new Log();
    engine = new Engine({ canvas: $("canvas"), overlay: $("overlay"), log, timeFactor: FAST ? 10 : 1 });
    engine.setVirtualSize(innerWidth, innerHeight);
    const comm = new Communications(engine);
    [new Instructions(engine, content.files), new Guide(engine, content.files), new Track(engine, mouse), new Sysmon(engine),
        comm, new Resman(engine), new Gate(engine, comm)].forEach((p) => engine.add(p));
    engine.load(content.scenario);
    if (BOT) {
        window.__engineTime = () => engine.scenarioTime; // For the automated checks
    }
    engine.isSuspended = () => mouse.suspended;
    engine.onEnd = finishSession;
    log.manual(0, "voice", TTS.voiceName());
    log.manual(0, "window", `${innerWidth}x${innerHeight} dpr ${devicePixelRatio}`);
    const phases = content.scenario.phases;
    let stageA = false;
    let stageB = false;
    const loop = (now) => {
        if (ended) {
            return;
        }
        try {
            engine.frame(now);
            if (BOT) {
                bot.frame(now);
            }
            if (!stageA && engine.scenarioTime >= phases.A_main[1]) {
                stageA = true;
                logVisit("과제1 완료");
            }
            if (!stageB && engine.scenarioTime >= phases.B_main[0]) {
                stageB = true;
                logVisit("과제2 시작");
            }
            if (!ended) {
                engine.draw();
            }
        } catch (error) {
            crash("멈춤", error);
            return;
        }
        requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
}

window.addEventListener("keydown", (e) => {
    if (!engine || ended) {
        return;
    }
    const name = keyName(e.code);
    if (name) {
        e.preventDefault(); // No page scroll (Space, arrows)
        if (name !== "ESCAPE" && mouse.session && !document.pointerLockElement) {
            mouse.lock();
        }
        if (name !== "ESCAPE") {
            engine.keyEvent(name, "press", e.timeStamp);
        }
    } else if (/^F([1-9]|1[0-2])$/.test(e.key) && e.key !== "F11") {
        e.preventDefault(); // No reload (F5) or help (F1)
    }
}, true);
window.addEventListener("keyup", (e) => {
    const name = engine && !ended ? keyName(e.code) : null;
    if (name && name !== "ESCAPE") {
        e.preventDefault();
        engine.keyEvent(name, "release", e.timeStamp);
    }
}, true);
window.addEventListener("blur", () => engine?.releaseAllKeys());
document.addEventListener("visibilitychange", () => {
    if (!engine || ended) {
        return;
    }
    log.manual(engine.scenarioTime, "visibility", document.hidden ? "hidden" : "visible");
    if (document.hidden && mouse.session) {
        mouse.suspended = true; // Another tab or window: pause until a click
        mouse.refresh();
    }
});
$("pause-notice").addEventListener("mousedown", (e) => e.preventDefault());
$("pause-notice").addEventListener("click", () => mouse.lock());
window.addEventListener("beforeunload", (e) => {
    if (engine && !ended) {
        e.preventDefault();
        e.returnValue = "";
    }
});

// ---- Errors: the participant gets the result code so far instead of a frozen screen ----
function crash(kind, error) {
    console.error("[study] the session cannot go on:", error);
    if (ended || abortReason) {
        return;
    }
    abortReason = kind;
    logVisit(`오류: ${String(error?.message || error).slice(0, 150)}`);
    mouse.release();
    $("crash-text").textContent = "오류로 과제를 계속할 수 없습니다. 죄송합니다.";
    $("crash").hidden = false;
}
$("crash-end").addEventListener("click", () => {
    $("crash").hidden = true;
    if (!ended) {
        try {
            engine.end(abortReason);
        } catch (error) {
            console.error(error);
            finishSession(abortReason);
        }
    }
});
window.addEventListener("error", (e) => engine && crash("멈춤", e.error || e.message));
window.addEventListener("unhandledrejection", (e) => engine && !ended && crash("멈춤", e.reason));

// ---- End of the session ----
async function finishSession(reason) {
    if (ended) {
        return;
    }
    ended = true;
    mouse.release();
    $("task").hidden = true;
    $("end").hidden = false;
    let code;
    let result = null;
    try {
        result = score(log, content.scenario.phases, {
            browser: browserName(), voice: TTS.voiceName(), winH: Math.round(engine.vh), freezeMs: engine.freezeMs,
            ttsFail: TTS.fails, file: sessionFile,
        });
        for (const [k, v] of Object.entries(preAnswers)) {
            result[`pre_${k}`] = v;
        }
        if (reason) {
            result.aborted = reason;
        }
        code = resultCode(result);
    } catch (error) {
        console.error(error);
        code = "OM1-ERROR " + String(error.message || error).slice(-200);
    }
    window.studyResult = { code, result }; // For the automated checks
    logVisit(reason ? `완료(${reason} 오류 후)` : "완료");
    $("result-code").value = code;
    $("copy-code").onclick = async () => {
        try {
            await navigator.clipboard.writeText(code);
        } catch {
            $("result-code").select();
            document.execCommand("copy");
        }
        $("copied").textContent = "복사했습니다";
    };
    const survey = QUERY.get("form") || SURVEY_URL;
    if (/^https:\/\//.test(survey)) {
        const link = document.createElement("a");
        link.href = survey.replace("{code}", encodeURIComponent(code));
        link.target = "_blank";
        link.rel = "noopener";
        const prefilled = survey.includes("{code}");
        link.textContent = prefilled ? "설문지 열기 (새 창, 결과 코드가 자동으로 들어갑니다)" : "설문지 열기 (새 창)";
        $("survey-line").replaceChildren(link);
        if (prefilled) {
            $("study-lead").textContent = "수고 많으셨습니다. 아래 링크로 설문지를 열면 결과 코드가 자동으로 채워져 있습니다. "
                + "설문에 반드시 참여해주시기 바랍니다. 코드 칸이 비어 있으면 아래 코드를 복사해 붙여 넣어 주세요.";
        }
    }
    await upload(result);
}

// Raw data of the session to DataPipe (https://pipe.jspsych.org), JSON text
async function upload(result) {
    if (!DATAPIPE_EXPERIMENT || BOT) {
        window.studyRaw = log.compact({ file: sessionFile, result });
        return;
    }
    const data = JSON.stringify(log.compact({
        file: sessionFile, engine: ENGINE, result, browser: browserName(), userAgent: navigator.userAgent,
        window: [innerWidth, innerHeight, devicePixelRatio], fast: FAST, aborted: abortReason,
        date: new Date().toISOString(),
    }));
    $("upload-line").textContent = "기록을 저장하는 중…";
    try {
        const response = await fetch(DATAPIPE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "*/*" },
            body: JSON.stringify({ experimentID: DATAPIPE_EXPERIMENT, filename: sessionFile.replace(".csv", ".json"), data }),
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        $("upload-line").textContent = "기록을 저장했습니다.";
    } catch (error) {
        $("upload-line").textContent = "기록 저장에 실패했습니다. 결과 코드는 그대로 제출해 주세요.";
        logVisit(`오류: DataPipe ${String(error.message || error).slice(0, 100)}`);
    }
}

// ---- ?bot=1: automated participant for the checks (tests/), never in a real session ----
// Behaviour: Space on every slide; answers every own communications prompt right; handles the 1st, 2nd and 3rd
// malfunctions missed by the automation in the scored block of task 2 (not the others); one hidden page in task 2.
const bot = {
    slideSince: null, keyQueue: [], nextKeyAt: 0, hidden: false,
    press(name) {
        this.keyQueue.push(name);
    },
    frame(now) {
        const e = engine;
        if (this.keyQueue.length && now >= this.nextKeyAt) {
            const name = this.keyQueue.shift();
            e.keyEvent(name, "press", now);
            e.keyEvent(name, "release", now + 30);
            this.nextKeyAt = now + 60;
            return;
        }
        const blocking = e.activeBlocking();
        if (blocking && blocking.visible) {
            this.slideSince ??= now;
            if (now - this.slideSince > 400 && !this.keyQueue.length) {
                this.press("SPACE");
                this.slideSince = null;
            }
            return;
        }
        this.slideSince = null;
        if (this.keyQueue.length) {
            return;
        }
        const t = e.scenarioTime;
        const comm = e.plugins.communications;
        if (comm.alive && !comm.paused) {
            const target = comm.waiting().find((r) => r._response_start !== null && t - r._response_start > 1);
            if (target) {
                const a = comm.active();
                if (a !== target) {
                    this.press(target.pos < a.pos ? "UP" : "DOWN");
                } else {
                    const steps = Math.round((target.targetfreq - a.currentfreq) * 10);
                    if (steps !== 0) {
                        this.press(steps > 0 ? "RIGHT" : "LEFT");
                    } else {
                        this.press("ENTER");
                    }
                }
                return;
            }
        }
        const sysmon = e.plugins.sysmon;
        if (sysmon.alive && !sysmon.paused && !sysmon.params.automaticsolver) {
            const phases = content.scenario.phases;
            for (const g of sysmon.gauges().filter((x) => x._onfailure && t - x._response_start > 1.5)) {
                const inMain = phases.B_main[0] <= g._failure.t && g._failure.t < phases.B_main[1];
                const rank = log.failures.filter((f) => !f.auto && phases.B_main[0] <= f.t && f.t < phases.B_main[1])
                    .indexOf(g._failure);
                if (!inMain || rank < 3) {
                    this.press(g.key);
                    return;
                }
            }
        }
        if (!this.hidden && t > content.scenario.phases.B_main[0] + 20) {
            this.hidden = true;
            log.manual(t, "visibility", "hidden");
            mouse.suspended = true;
            mouse.refresh();
            setTimeout(() => {
                log.manual(e.scenarioTime, "visibility", "visible");
                mouse.lock();
            }, 1000);
        }
    },
};

setupStartPage();
