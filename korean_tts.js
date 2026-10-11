// Copyright 2023-2026, by Julien Cegarra & Benoît Valéry. All rights reserved.
// Institut National Universitaire Champollion (Albi, France).
// License : CeCILL, version 2.1 (see the LICENSE file)
//
// Korean adaptation (2026): Korean voice of the communications task, read by the browser speech synthesis.
// Used by core/korean_tts.py (TTSPlayer) through window.KoreanTTS. Python polls isDone(id): the response time of a
// prompt starts when its message has been spoken, as with the recorded voices.
// Chrome's Google voices stop an utterance after about 15 s without its "end" event: an utterance still spoken after
// 13 s is paused and resumed at once, which keeps it going (shorter prompts are not touched).

const supported = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
const KEEP_ALIVE_MS = 13000;
let voice = null;
let lastId = 0;
const done = new Set();

function pickVoice() {
    if (!supported) {
        return null;
    }
    const voices = speechSynthesis.getVoices().filter((v) => /^ko/i.test(v.lang));
    // Prefer the natural voices (Google, Microsoft online), then any Korean voice
    voice = voices.find((v) => /Google/i.test(v.name))
        || voices.find((v) => /Natural|Online/i.test(v.name))
        || voices.find((v) => /Microsoft/i.test(v.name))
        || voices[0] || null;
    return voice;
}

if (supported) {
    pickVoice();
    speechSynthesis.addEventListener?.("voiceschanged", pickVoice);
}

export const KoreanTTS = {
    supported,
    hasKoreanVoice: () => Boolean(voice || pickVoice()),
    voiceName: () => (voice || pickVoice() || {}).name || "",
    speak(text, rate = 1) {
        const id = ++lastId;
        if (!supported) {
            done.add(id);
            return id;
        }
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = "ko-KR";
        if (voice || pickVoice()) {
            utterance.voice = voice;
        }
        utterance.rate = rate;
        utterance.onend = utterance.onerror = () => done.add(id);
        speechSynthesis.cancel();
        speechSynthesis.speak(utterance);
        const keepAlive = setInterval(() => {
            if (done.has(id) || id !== lastId) {
                clearInterval(keepAlive);
            } else if (speechSynthesis.speaking && !speechSynthesis.paused) {
                speechSynthesis.pause();
                speechSynthesis.resume();
            }
        }, KEEP_ALIVE_MS);
        // Safety: some voices never fire "end" (the prompt would never be over)
        setTimeout(() => done.add(id), 4000 + text.length * 250);
        return id;
    },
    isDone: (id) => done.has(id),
    cancel() {
        if (supported) {
            speechSynthesis.cancel();
        }
    },
};
window.KoreanTTS = KoreanTTS;
