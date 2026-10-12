// Korean voice of the communications task: browser speech synthesis (core/korean_tts.py, web/korean_tts.js).
// One utterance per prompt. Chrome's Google voices stop an utterance after about 15 s without its "end" event: an
// utterance still spoken after 13 s is paused and resumed at once, which keeps it going. A watchdog ends a prompt
// whose "end" never comes (counted as tts_fail): the communications task always goes on.

const LETTERS = Object.fromEntries([..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].map((c, i) => [c,
    "에이 비 씨 디 이 에프 지 에이치 아이 제이 케이 엘 엠 엔 오 피 큐 알 에스 티 유 브이 더블유 엑스 와이 제트".split(" ")[i]]));
const DIGITS = Object.fromEntries([..."0123456789"].map((c, i) => [c, "공 하나 둘 삼 넷 오 여섯 칠 팔 아홉".split(" ")[i]]));
const RADIOS = { NAV_1: "내브, 원", NAV_2: "내브, 투", COM_1: "컴, 원", COM_2: "컴, 투" };
export const LEAD_SILENCE_S = 2; // The recorded prompts start with 20 "empty" samples of 0.1 s
const KEEP_ALIVE_MS = 13000;

const supported = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
let voice = null;

function pickVoice() {
    if (!supported) {
        return null;
    }
    const voices = speechSynthesis.getVoices().filter((v) => /^ko/i.test(v.lang));
    voice = voices.find((v) => /Google/i.test(v.name)) || voices.find((v) => /Natural|Online/i.test(v.name))
        || voices.find((v) => /Microsoft/i.test(v.name)) || voices[0] || null;
    return voice;
}
if (supported) {
    pickVoice();
    speechSynthesis.addEventListener?.("voiceschanged", pickVoice);
}

export const TTS = {
    supported,
    voiceName: () => (voice || pickVoice() || {}).name || "",
    // Voices may load after the page: wait for them a few seconds
    async waitForKoreanVoice(timeoutMs = 3000) {
        const start = performance.now();
        while (performance.now() - start < timeoutMs) {
            if (voice || pickVoice()) {
                return true;
            }
            await new Promise((r) => setTimeout(r, 200));
        }
        return Boolean(voice || pickVoice());
    },
    fails: 0,
    // Speak text; onDone(ok) once, ok false when the watchdog ended it
    speak(text, onDone) {
        let finished = false;
        const done = (ok) => {
            if (!finished) {
                finished = true;
                clearInterval(keepAlive);
                clearTimeout(watchdog);
                onDone(ok);
            }
        };
        if (!supported) {
            done(true);
            return { cancel() {} };
        }
        const u = new SpeechSynthesisUtterance(text);
        u.lang = "ko-KR";
        if (voice || pickVoice()) {
            u.voice = voice;
        }
        u.rate = 1;
        u.onend = () => done(true);
        u.onerror = (e) => done(e?.error === "interrupted" || e?.error === "canceled");
        speechSynthesis.cancel();
        speechSynthesis.speak(u);
        const keepAlive = setInterval(() => {
            if (speechSynthesis.speaking && !speechSynthesis.paused) {
                speechSynthesis.pause();
                speechSynthesis.resume();
            }
        }, KEEP_ALIVE_MS);
        const watchdog = setTimeout(() => {
            TTS.fails += 1;
            speechSynthesis.cancel();
            done(false);
        }, 4000 + text.length * 250);
        return {
            cancel() {
                finished = true;
                clearInterval(keepAlive);
                clearTimeout(watchdog);
                speechSynthesis.cancel();
            },
        };
    },
};

const sayChars = (s) => [...s].filter((c) => c.trim()).map((c) => LETTERS[c.toUpperCase()] || DIGITS[c] || c);

// e.g. "에이치, 에스, 알, 둘, 오, 아홉, 에이치, 에스, 알, 둘, 오, 아홉, 무전기, 컴, 원, 주파수, 하나, 공, 아홉, 쩜, 삼."
export function promptText(callsign, radioName, freq) {
    const call = sayChars(callsign);
    const digits = [...freq.toFixed(1)].map((c) => (c === "." ? "쩜" : DIGITS[c] || c));
    return [...call, ...call, "무전기", RADIOS[radioName] || radioName, "주파수", ...digits].join(", ") + ".";
}

// A prompt: LEAD_SILENCE_S of silence then the speech. Paused, it is read again from its beginning (like the
// recorded prompts). done: the message is over (the response time starts then).
export class Prompt {
    constructor(text, onFail) {
        this.text = text;
        this.done = !supported;
        this.playing = false;
        this.timer = null;
        this.utterance = null;
        this.onFail = onFail;
        this.startedAt = null;
        this.endedAt = null;
    }
    play() {
        if (this.done || this.playing) {
            return;
        }
        this.playing = true;
        this.timer = setTimeout(() => {
            this.startedAt = performance.now();
            this.utterance = TTS.speak(this.text, (ok) => {
                this.done = true;
                this.playing = false;
                this.endedAt = performance.now();
                if (!ok) {
                    this.onFail?.();
                }
            });
        }, LEAD_SILENCE_S * 1000);
    }
    pause() {
        if (this.done) {
            return;
        }
        this.playing = false;
        clearTimeout(this.timer);
        this.utterance?.cancel();
        this.utterance = null;
    }
    delete() {
        this.pause();
        this.done = true;
    }
}
