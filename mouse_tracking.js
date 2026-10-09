// Copyright 2023-2026, by Julien Cegarra & Benoît Valéry. All rights reserved.
// Institut National Universitaire Champollion (Albi, France).
// License : CeCILL, version 2.1 (see the LICENSE file)
//
// Korean adaptation (2026): tracking by moving the mouse, the mouse pointer being hidden (pointer lock). The green
// cursor of the tracking task is the participant's cursor: plugins/track.py (parameter mousemove) takes the mouse
// movements accumulated here at each step. The pointer is locked by the start button (lockNow) for the whole
// session. Browsers may refuse or drop that first lock (entering full screen uses up the click), so any later key
// (except Esc) or click locks it again. If the lock is lost while the tracking task runs (Esc), a message also asks
// for a click; the losses are counted (logged by the plugin).

const state = { dx: 0, dy: 0, wanted: false, locked: false, lostUnread: false, session: false };
let overlay = null;

function canvas() {
    return document.getElementById("pygletCanvas");
}

function makeOverlay() {
    overlay = document.createElement("div");
    overlay.id = "pointer-lock-overlay";
    overlay.textContent = "마우스가 고정되지 않았습니다. 여기를 클릭하면 고정되고 추적이 이어집니다";
    Object.assign(overlay.style, {
        position: "fixed", left: "50%", top: "28%", transform: "translate(-50%, -50%)", zIndex: "1000",
        padding: "18px 28px", borderRadius: "10px", background: "rgba(230, 120, 0, 0.95)", color: "#fff",
        font: "600 20px 'Noto Sans KR', sans-serif", cursor: "pointer", display: "none", textAlign: "center",
    });
    // Keep the keyboard focus on the task canvas (the keys of the tasks go there)
    overlay.addEventListener("mousedown", (event) => event.preventDefault());
    overlay.addEventListener("click", lock);
    document.body.append(overlay);
}

function refresh() {
    if (!overlay) {
        makeOverlay();
    }
    overlay.style.display = state.wanted && !state.locked ? "block" : "none";
}

function lock() {
    state.session = true;
    canvas()?.focus();
    // The page itself (not the canvas): it can be locked by the start button, before the canvas is shown
    if (!document.pointerLockElement) {
        const request = document.documentElement.requestPointerLock();
        // Chrome refuses a new lock right after an Esc: the message stays and the next click retries
        request?.catch?.(() => {});
    }
}

document.addEventListener("mousemove", (event) => {
    if (document.pointerLockElement) {
        state.dx += event.movementX;
        state.dy += event.movementY;
    }
});

// A key press or a click is a user gesture: use it to (re)lock the pointer. Esc is left alone: it unlocks the
// pointer and opens the exit dialog, which is answered with keys (Space continues and locks again).
document.addEventListener(
    "keydown",
    (event) => {
        if (state.session && !document.pointerLockElement && event.key !== "Escape") {
            lock();
        }
    },
    true,
);
document.addEventListener(
    "mousedown",
    () => {
        if (state.session && !document.pointerLockElement) {
            lock();
        }
    },
    true,
);
document.addEventListener("fullscreenchange", () => {
    if (state.session && !document.pointerLockElement) {
        lock();
    }
});

document.addEventListener("pointerlockchange", () => {
    const wasLocked = state.locked;
    state.locked = Boolean(document.pointerLockElement);
    if (wasLocked && !state.locked && state.wanted) {
        state.lostUnread = true;
    }
    state.dx = state.dy = 0;
    refresh();
});

export const MouseTracking = {
    // To call in the click handler of the start button (a user gesture is needed)
    lockNow: lock,
    // "dx,dy" (pixels, y downward) moved since the previous call, or "lost" once after a loss of the pointer lock
    take() {
        if (state.lostUnread) {
            state.lostUnread = false;
            return "lost";
        }
        const moved = `${state.dx},${state.dy}`;
        state.dx = state.dy = 0;
        return moved;
    },
    setWanted(wanted) {
        if (state.wanted !== Boolean(wanted)) {
            state.wanted = Boolean(wanted);
            refresh();
        }
    },
    release() {
        state.wanted = false;
        state.session = false;
        if (document.pointerLockElement) {
            document.exitPointerLock();
        }
        refresh();
    },
};
window.MouseTracking = MouseTracking;
