// Copyright 2023-2026, by Julien Cegarra & Benoît Valéry. All rights reserved.
// Institut National Universitaire Champollion (Albi, France).
// License : CeCILL, version 2.1 (see the LICENSE file)

// Browser launcher: loads Pyodide + pyglet in the background while the start menu
// is displayed, then runs main.py once the user clicks "Start" (a user gesture is
// required to enable audio and fullscreen).

import { installPygletEmscripten } from "./pyglet_emscripten.js";
import {
    SessionOutput, checkDataPipe, downloadText, gunzipIfNeeded, loadJatos, readConfigValue, sessionOutputSettings,
    sessionRelativePath,
} from "./session_output.js";
import { connectScorm } from "./scorm.js";
import { Cmi5Session, cmi5LaunchParameters, preferredLanguage } from "./cmi5.js";
import { SerialTrigger, describePort } from "./serial_trigger.js";
import { LslBridge } from "./lsl_bridge.js";
import { KoreanTTS } from "./korean_tts.js";
import { MouseTracking } from "./mouse_tracking.js";

// Set by web/build.py: pyodide.mjs on the Pyodide CDN, or its copy shipped with the page (--pyodide local)
const PYODIDE_MODULE = new URL(document.querySelector('meta[name="pyodide-module"]').content, location.href).href;
const APP_DIR = "/app";
const SESSIONS_DIR = "/data/openmatb/sessions"; // pyglet.storage.get("openmatb").data / "sessions"
let storage = null; // pyglet's storage bridge (persists /data in IndexedDB), set by boot()
const FONT_FAMILY = "Noto Sans"; // core.platform.WEB_FONT_NAME, files downloaded by web/build.py
const FONT_WEIGHTS = [400, 700];

const $ = (id) => document.getElementById(id);

// Start page texts (OpenMATB itself is translated with gettext, see locales/)
const TEXTS = {
    en_EN: {
        language: "Language",
        mode: "Mode",
        run_scenario: "Run a scenario",
        replay_session: "Replay a session",
        choose_next: "The scenario (or session) is chosen in the next screen.",
        import_session: "Import a session file (optional)",
        sessions_kept: "Sessions run in this browser are kept and listed automatically.",
        fullscreen: "Fullscreen",
        start: "Start",
        session_ended: "Session ended",
        log_file: "The log file",
        kept_in_browser: "It is also kept in this browser for replay.",
        sending: "Sending…",
        ending_study: "End of the study…",
        study_not_ended: "The study could not be ended in JATOS:",
        sent_download: "Downloaded on this computer",
        sent_fallback: "Downloaded on this computer, because it could not be sent",
        sent_webdav: "Sent to the server (WebDAV)",
        sent_jatos: "Sent to JATOS",
        sent_datapipe: "Sent to DataPipe",
        sent_scorm: "Activity completed in the learning platform (LMS)",
        sent_cmi5: "Activity completed in the learning platform (LMS)",
        sent_cmi5_not_recorded: "Not recorded as completed: the learning platform (LMS) opened the activity in "
            + "browse or review mode",
        back_to_course: "Back to the course…",
        sent_none: "Not sent anywhere (web_session_output=none)",
        demo_not_recorded: "This was a demo: the session was not recorded.",
        restart_demo: "Restart the demo",
        not_sent: "Not sent to {destination}:",
        config_error: "Configuration error (config.ini):",
        stored_sessions: "Sessions kept in this browser",
        no_session: "No session yet.",
        download: "Download",
        delete: "Delete",
        delete_all: "Delete all the sessions",
        confirm_delete: "Delete the session {name} from this browser?",
        confirm_delete_all: "Delete the {count} sessions kept in this browser?",
        back_to_menu: "Back to menu",
        joystick_hint: "Joystick: press one of its buttons to detect it.",
        joystick_detected: "Joystick detected:",
        loading_python: "Loading Python…",
        loading_pyglet: "Loading pyglet…",
        loading_openmatb: "Loading OpenMATB…",
        ready: "Ready",
        loading_failed: "Loading failed:",
        browser_warn: "The Firefox browser cannot guarantee the timing accuracy of the results, "
            + "prefer Chrome or Edge.",
        browser_block: "This experiment requires Chrome or Edge: Firefox pauses for 0.1 to 1 s every few seconds, "
            + "which makes timing unreliable.",
        wasm_mime: "Slow loading",
        wasm_mime_detail: "The server does not send the .wasm files as application/wasm "
            + "(Moodle: Site administration > Server > File types).",
        trigger_box: "Trigger box (parallelport plugin)",
        no_port: "No port chosen.",
        choose_port: "Choose the port",
        serial_unsupported: "web_serial_trigger: this browser cannot use serial ports (use Chrome or Edge)",
        choose_port_first: "Choose the port of the trigger box",
        port_not_opened: "The port of the trigger box cannot be opened:",
        sent_trigger: "Trigger box: {count} values written",
        failed_trigger: "Trigger box: {count} values not written:",
        sent_lsl: "LSL bridge: {count} markers sent",
        failed_lsl: "LSL bridge: {count} markers not sent (bridge disconnected)",
    },
    fr_FR: {
        language: "Langue",
        mode: "Mode",
        run_scenario: "Lancer un scénario",
        replay_session: "Rejouer une session",
        choose_next: "Le scénario (ou la session) est choisi à l'écran suivant.",
        import_session: "Importer un fichier de session (facultatif)",
        sessions_kept: "Les sessions lancées dans ce navigateur sont conservées et listées automatiquement.",
        fullscreen: "Plein écran",
        start: "Démarrer",
        session_ended: "Session terminée",
        log_file: "Le fichier de log",
        kept_in_browser: "Il est aussi conservé dans ce navigateur pour le rejouer.",
        sending: "Envoi en cours…",
        ending_study: "Fin de l'étude…",
        study_not_ended: "L'étude n'a pas pu être terminée dans JATOS :",
        sent_download: "Téléchargé sur cet ordinateur",
        sent_fallback: "Téléchargé sur cet ordinateur, car il n'a pas pu être envoyé",
        sent_webdav: "Envoyé au serveur (WebDAV)",
        sent_jatos: "Envoyé à JATOS",
        sent_datapipe: "Envoyé à DataPipe",
        sent_scorm: "Activité terminée dans la plateforme de formation (LMS)",
        sent_cmi5: "Activité terminée dans la plateforme de formation (LMS)",
        sent_cmi5_not_recorded: "Non enregistrée comme terminée : la plateforme de formation (LMS) a ouvert "
            + "l'activité en mode consultation ou révision",
        back_to_course: "Retour au cours…",
        sent_none: "Envoyé nulle part (web_session_output=none)",
        demo_not_recorded: "C'était une démonstration : la session n'a pas été enregistrée.",
        restart_demo: "Relancer la démo",
        not_sent: "Non envoyé à {destination} :",
        config_error: "Erreur de configuration (config.ini) :",
        stored_sessions: "Sessions conservées dans ce navigateur",
        no_session: "Aucune session pour le moment.",
        download: "Télécharger",
        delete: "Supprimer",
        delete_all: "Supprimer toutes les sessions",
        confirm_delete: "Supprimer la session {name} de ce navigateur ?",
        confirm_delete_all: "Supprimer les {count} sessions conservées dans ce navigateur ?",
        back_to_menu: "Retour au menu",
        joystick_hint: "Joystick : appuyez sur l'un de ses boutons pour le détecter.",
        joystick_detected: "Joystick détecté :",
        loading_python: "Chargement de Python…",
        loading_pyglet: "Chargement de pyglet…",
        loading_openmatb: "Chargement d'OpenMATB…",
        ready: "Prêt",
        loading_failed: "Échec du chargement :",
        browser_warn: "Le navigateur Firefox ne peut garantir la précision temporelle des résultats, "
            + "privilégiez Chrome ou Edge.",
        browser_block: "Cette expérience nécessite Chrome ou Edge : Firefox s'interrompt 0,1 à 1 s toutes les "
            + "quelques secondes, ce qui rend la mesure du temps peu fiable.",
        wasm_mime: "Chargement lent",
        wasm_mime_detail: "Le serveur n'envoie pas les fichiers .wasm en application/wasm "
            + "(Moodle : Administration du site > Serveur > Types de fichiers).",
        trigger_box: "Boîtier de triggers (plugin parallelport)",
        no_port: "Aucun port choisi.",
        choose_port: "Choisir le port",
        serial_unsupported: "web_serial_trigger : ce navigateur ne peut pas utiliser les ports série "
            + "(utilisez Chrome ou Edge)",
        choose_port_first: "Choisissez le port du boîtier de triggers",
        port_not_opened: "Le port du boîtier de triggers ne peut pas être ouvert :",
        sent_trigger: "Boîtier de triggers : {count} valeurs écrites",
        failed_trigger: "Boîtier de triggers : {count} valeurs non écrites :",
        sent_lsl: "Pont LSL : {count} marqueurs envoyés",
        failed_lsl: "Pont LSL : {count} marqueurs non envoyés (pont déconnecté)",
    },
};

// Korean adaptation (2026): participant-facing texts of the start and end pages
TEXTS.ko_KR = {
    ...TEXTS.en_EN,
    language: "언어",
    mode: "모드",
    run_scenario: "시나리오 실행",
    replay_session: "세션 다시 보기",
    choose_next: "시나리오(또는 세션)는 다음 화면에서 고릅니다.",
    fullscreen: "전체 화면",
    start: "시작",
    session_ended: "과제가 끝났습니다",
    log_file: "기록 파일",
    kept_in_browser: "이 브라우저에도 보관됩니다.",
    sending: "결과를 저장하는 중…",
    sent_download: "이 컴퓨터에 내려받았습니다",
    sent_fallback: "보내지 못해 이 컴퓨터에 내려받았습니다",
    sent_datapipe: "연구자에게 전송했습니다",
    sent_none: "결과 파일은 이 브라우저에만 보관됩니다",
    not_sent: "{destination}에 보내지 못했습니다:",
    back_to_menu: "처음 화면으로",
    loading_python: "불러오는 중… (1/3)",
    loading_pyglet: "불러오는 중… (2/3)",
    loading_openmatb: "불러오는 중… (3/3)",
    ready: "준비 완료",
    loading_failed: "불러오기 실패:",
    browser_warn: "Firefox는 시간 측정이 부정확합니다. Chrome이나 Edge로 열어 주세요.",
    browser_block: "이 과제는 Chrome이나 Edge에서만 할 수 있습니다.",
    config_error: "설정 오류:",
};

// ?lang= in the URL, otherwise the first browser language OpenMATB is translated in, otherwise English
function detectLanguage() {
    const requested = new URLSearchParams(location.search).get("lang");
    if (requested in TEXTS) {
        return requested;
    }
    for (const language of navigator.languages || [navigator.language]) {
        const code = String(language).toLowerCase().split("-")[0];
        const match = Object.keys(TEXTS).find((lang) => lang.toLowerCase().startsWith(code + "_"));
        if (match) {
            return match;
        }
    }
    return "en_EN";
}

const t = (key) => TEXTS[$("lang").value][key];

let statusKey = null;
const status = (key, detail = "") => {
    statusKey = key;
    $("pygletStatus").textContent = key ? `${t(key)} ${detail}`.trim() : detail;
};

function translatePage() {
    const lang = $("lang").value;
    document.documentElement.lang = lang.split("_")[0];
    for (const element of document.querySelectorAll("[data-i18n]")) {
        element.textContent = TEXTS[lang][element.dataset.i18n];
    }
    for (const element of document.querySelectorAll("[data-i18n-title]")) {
        element.title = TEXTS[lang][element.dataset.i18nTitle];
    }
    if (statusKey) {
        status(statusKey);
    }
}

// ---- Psychophysiology: USB trigger box (parallelport plugin) and LSL bridge (labstreaminglayer plugin) ----
// Opened when a scenario starts, then used from Python (core/platform.py): window.openmatbSerialTrigger and
// window.openmatbLsl

const serialTrigger = SerialTrigger.supported() ? new SerialTrigger() : null;

function deviceSettings(configText) {
    return {
        serialTrigger: /^true$/i.test(readConfigValue(configText, "web_serial_trigger") || ""),
        baudRate: Number(readConfigValue(configText, "web_serial_baudrate")) || 115200,
        lslBridge: readConfigValue(configText, "web_lsl_bridge") || "",
    };
}

function showTriggerPort() {
    const label = $("trigger-port");
    if (serialTrigger?.port) {
        delete label.dataset.i18n;
        label.textContent = describePort(serialTrigger.port);
    } else {
        label.dataset.i18n = "no_port";
        label.textContent = t("no_port");
    }
}

// Once config.ini is loaded: the port of the trigger box (allowed in a previous visit). Returns the errors.
async function showDevices(configText) {
    const devices = deviceSettings(configText);
    $("trigger-options").hidden = !devices.serialTrigger;
    if (!devices.serialTrigger) {
        return [];
    }
    if (!serialTrigger) {
        return [t("serial_unsupported")];
    }
    await serialTrigger.restore().catch(console.warn);
    showTriggerPort();
    return [];
}

$("trigger-choose").addEventListener("click", async () => {
    try {
        await serialTrigger.choose(); // Needs the click
    } catch (error) {
        console.warn("[OpenMATB] No serial port chosen:", error);
    }
    showTriggerPort();
});

// When a scenario starts: returns the errors (the session must not start without its devices)
async function openDevices(devices) {
    const errors = [];
    if (devices.serialTrigger) {
        if (!serialTrigger) {
            errors.push(t("serial_unsupported"));
        } else if (!serialTrigger.port) {
            errors.push(t("choose_port_first"));
        } else {
            try {
                await serialTrigger.open(devices.baudRate);
                window.openmatbSerialTrigger = serialTrigger;
            } catch (error) {
                errors.push(`${t("port_not_opened")} ${error.message || error}`);
            }
        }
    }
    if (devices.lslBridge && !window.openmatbLsl) {
        const bridge = new LslBridge(devices.lslBridge);
        try {
            await bridge.connect();
            window.openmatbLsl = bridge;
        } catch (error) {
            errors.push(String(error.message || error));
        }
    }
    return errors;
}

// End of the session: the last trigger values and markers, for the end page
async function closeDevices() {
    const results = [];
    const trigger = window.openmatbSerialTrigger;
    if (trigger) {
        await trigger.close();
        const failed = trigger.errors.length;
        results.push({
            destination: "trigger",
            ok: !failed,
            text: failed
                ? `${t("failed_trigger").replace("{count}", failed)} ${trigger.errors[0]}`
                : t("sent_trigger").replace("{count}", trigger.written),
        });
    }
    const bridge = window.openmatbLsl;
    if (bridge) {
        bridge.close();
        const lost = bridge.queue.length;
        results.push({
            destination: "lsl",
            ok: !lost,
            text: t(lost ? "failed_lsl" : "sent_lsl").replace("{count}", lost || bridge.sent),
        });
    }
    return results;
}

// Browsers reveal a joystick only after one of its buttons is pressed (core/joystick.py reads it)
function showJoystick() {
    const gamepad = [...(navigator.getGamepads ? navigator.getGamepads() : [])].find((g) => g && g.connected);
    $("joystick-status").dataset.i18n = gamepad ? "joystick_detected" : "joystick_hint";
    $("joystick-status").textContent = t($("joystick-status").dataset.i18n);
    $("joystick-name").textContent = gamepad ? gamepad.id : "";
}
window.addEventListener("gamepadconnected", showJoystick);
window.addEventListener("gamepaddisconnected", showJoystick);

$("lang").value = detectLanguage();
translatePage();
$("lang").addEventListener("change", translatePage);
showJoystick();

// Browsers with known timing issues. Firefox pauses the page for 0.1 to 1 s every few seconds (garbage
// collection when the user is considered inactive, and others): measured by tests/web, see the README.
const TIMING_ISSUE_BROWSERS = [/Firefox\/|FxiOS\//];
const BROWSER_CHECK_MODES = ["warn", "block", "off"];

// ?browsercheck= in the URL, otherwise web_browser_check in config.ini (once OpenMATB is loaded), otherwise "warn"
function browserCheckMode(pyodide = null) {
    const requested = new URLSearchParams(location.search).get("browsercheck");
    if (BROWSER_CHECK_MODES.includes(requested)) {
        return requested;
    }
    try {
        const config = pyodide?.FS.readFile(`${APP_DIR}/config.ini`, { encoding: "utf8" }) ?? "";
        const mode = (config.match(/^\s*web_browser_check\s*=\s*(\w+)/m) || [])[1]?.toLowerCase();
        if (BROWSER_CHECK_MODES.includes(mode)) {
            return mode;
        }
    } catch (error) {
        console.warn("config.ini not readable:", error);
    }
    return "warn";
}

// Show (or hide) the notice for browsers with timing issues. Returns false when starting is not allowed.
// Called when the page opens, then again once config.ini is available (it is in app.zip).
function checkBrowser(pyodide = null) {
    const mode = browserCheckMode(pyodide);
    const concerned = mode !== "off" && TIMING_ISSUE_BROWSERS.some((pattern) => pattern.test(navigator.userAgent));
    $("browser-warning").hidden = !concerned;
    if (!concerned) {
        return true;
    }
    $("browser-warning").dataset.i18n = `browser_${mode}`;
    $("browser-warning").textContent = t(`browser_${mode}`);
    return mode !== "block";
}
checkBrowser();

// ?demo=1 (Demo tab of the website): runs the demo scenario, and nothing is recorded
const DEMO = new URLSearchParams(location.search).get("demo") === "1";
const DEMO_SCENARIO = "demo.txt";

// Korean adaptation (2026): participants open the page without parameters and get the study directly (Korean,
// study scenario, sound check, result code at the end). ?admin=1 gives the original menu (other scenarios, replay).
const QUERY = new URLSearchParams(location.search);
const STUDY = !DEMO && QUERY.get("admin") !== "1" && !QUERY.get("cmi5") && !QUERY.get("endpoint");
const STUDY_SCENARIO = "korean/study.txt";
const SAMPLE_PROMPT = "에이, 비, 씨, 하나, 둘, 삼, 에이, 비, 씨, 하나, 둘, 삼, 무전기, 컴, 원, 주파수, 하나, 둘, 여섯, 쩜, 오.";
let soundChecked = false;

function setupStudyPage() {
    document.body.classList.add("study");
    $("lang").value = "ko_KR";
    translatePage();
    $("study").hidden = false;
    $("fullscreen").checked = true;
    $("sound-play").addEventListener("click", () => {
        const voice = KoreanTTS.voiceName();
        $("sound-voice").textContent = !KoreanTTS.supported
            ? "이 브라우저는 음성 기능이 없습니다. Chrome이나 Edge로 열어 주세요."
            : voice ? `사용할 음성: ${voice}` : "한국어 음성을 찾지 못했습니다. Chrome이나 Edge로 열어 주세요.";
        KoreanTTS.speak(SAMPLE_PROMPT);
        $("sound-ok").disabled = false;
    });
    const showStart = () => {
        $("start").hidden = !(soundChecked && $("agree").checked);
    };
    $("sound-ok").addEventListener("click", () => {
        soundChecked = true;
        $("sound-ok").textContent = "확인했습니다";
        $("sound-ok").disabled = true;
        showStart();
    });
    $("agree").addEventListener("change", showStart);
    $("start").hidden = true;
}
if (STUDY) {
    setupStudyPage();
}

// End of a study session: summary scores (core/korean_score.py) as a result code to paste in the survey.
// The survey address comes from ?form= in the page address or web_survey_url in config.ini.
async function showStudyResult(pyodide, sessionPath) {
    $("study-end").hidden = false;
    let code;
    try {
        pyodide.globals.set("_session_path", sessionPath);
        code = pyodide.runPython(`
from pathlib import Path
from core.korean_score import result_code, score_file
result_code(score_file(_session_path, Path("${APP_DIR}/includes/scenarios/korean/study.txt")))`);
    } catch (error) {
        console.error(error);
        code = "OM1-ERROR " + String(error.message || error).slice(-200);
    }
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
    const survey = QUERY.get("form") || readConfigValue(readAppConfig(pyodide), "web_survey_url") || "";
    const prefilled = survey.includes("{code}");
    $("survey-line").innerHTML = "";
    if (/^https:\/\//.test(survey)) {
        const link = document.createElement("a");
        link.href = survey.replace("{code}", encodeURIComponent(code));
        link.target = "_blank";
        link.rel = "noopener";
        link.textContent = prefilled ? "설문지 열기 (새 창, 결과 코드가 자동으로 들어갑니다)" : "설문지 열기 (새 창)";
        $("survey-line").append(link);
        if (prefilled) {
            $("study-lead").textContent =
                "아래 링크로 설문지를 열면 결과 코드가 자동으로 채워져 있습니다. 나머지 문항에 답하고 제출해야 참여가 완료됩니다. " +
                "코드 칸이 비어 있으면 아래 코드를 복사해 붙여 넣어 주세요.";
        }
    } else {
        $("survey-line").textContent = "안내받은 설문지 링크로 이동해 주세요.";
    }
}
// config.ini values of the demo: no session number to acknowledge, and the session is not sent anywhere
const DEMO_CONFIG = { display_session_number: "False", web_session_output: "none" };

function applyDemoConfig(pyodide) {
    let config = readAppConfig(pyodide);
    for (const [key, value] of Object.entries(DEMO_CONFIG)) {
        config = config.replace(new RegExp(`^(\\s*${key}\\s*=).*$`, "m"), `$1${value}`);
    }
    pyodide.FS.writeFile(`${APP_DIR}/config.ini`, config);
}
if (DEMO) {
    $("mode").value = "scenario";
    $("mode").hidden = true;
    document.querySelector('label[for="mode"]').hidden = true;
    $("back").dataset.i18n = "restart_demo";
    $("back").textContent = t("restart_demo");
}

// Run by an LMS (SCORM or cmi5 package): the LMS records the completion, participants only run the scenario
function runByLms() {
    $("mode").value = "scenario";
    $("mode").hidden = true;
    document.querySelector('label[for="mode"]').hidden = true;
    $("back").hidden = true; // The LMS takes over at the end
}

const scorm = connectScorm();
if (scorm) {
    runByLms();
    window.addEventListener("pagehide", () => scorm.terminate());
}

// Launched by a cmi5 LMS: xAPI statements sent to its LRS (initialized, completed, terminated). lmsErrors: the launch
// was refused (e.g. the page was reloaded: the LMS gives its token only once), the session must not start.
const cmi5Launch = cmi5LaunchParameters();
const cmi5 = cmi5Launch ? new Cmi5Session(cmi5Launch) : null;
const lmsErrors = [];
const cmi5Ready = (async () => {
    if (!cmi5) {
        return;
    }
    runByLms();
    try {
        await cmi5.initialize();
    } catch (error) {
        console.error(error);
        lmsErrors.push(String(error.message || error));
        return;
    }
    window.addEventListener("pagehide", () => cmi5.terminate({ keepalive: true }).catch(console.error));
    if (!new URLSearchParams(location.search).get("lang")) {
        const language = preferredLanguage(await cmi5.languagePreference(), Object.keys(TEXTS));
        if (language) {
            $("lang").value = language;
            translatePage();
        }
    }
})();

// cmi5: after the "terminated" statement, the LMS takes over (its return address, or it closes the window itself)
async function returnToCourse() {
    await cmi5.terminate().catch(console.error);
    if (cmi5.returnURL) {
        location.href = cmi5.returnURL;
    }
}

async function loadFonts() {
    // pyglet measures and renders text with the fonts known by the document.
    // Korean adaptation: the Latin face is limited to its range and Noto Sans KR subsets (fonts/korean.json, written
    // by web/build.py) cover the Hangul of the Korean texts, under the same family name.
    let korean = null;
    try {
        korean = await (await fetch("fonts/korean.json")).json();
    } catch (error) {
        console.warn("No Korean fonts:", error);
    }
    const faces = FONT_WEIGHTS.map((weight) => new FontFace(FONT_FAMILY, `url(fonts/noto-sans-${weight}.woff2)`,
        { weight: String(weight), ...(korean ? { unicodeRange: korean.latin } : {}) }));
    for (const face of korean?.faces || []) {
        faces.push(new FontFace(FONT_FAMILY, `url(fonts/${face.file})`,
            { weight: String(face.weight), unicodeRange: face.range }));
    }
    for (const face of await Promise.all(faces.map((f) => f.load()))) {
        document.fonts.add(face);
    }
}

// LMSs (Moodle...) serve the .wasm files with a generic MIME type, which the streaming compilation refuses
// ("Incorrect response MIME type. Expected 'application/wasm'"): compile them from their bytes instead
function allowWasmWithoutMimeType() {
    for (const [streamingName, bytesName] of [["compileStreaming", "compile"], ["instantiateStreaming", "instantiate"]]) {
        const streaming = WebAssembly[streamingName];
        if (!streaming) {
            continue;
        }
        WebAssembly[streamingName] = async (source, ...args) => {
            const response = await source;
            const mimeType = response.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase();
            if (mimeType === "application/wasm") {
                return streaming.call(WebAssembly, response, ...args);
            }
            $("wasm-mime").hidden = false;
            return WebAssembly[bytesName](await response.arrayBuffer(), ...args);
        };
    }
}

async function boot() {
    status("loading_python");
    allowWasmWithoutMimeType();
    await loadFonts();
    const { loadPyodide } = await import(PYODIDE_MODULE);
    const pyodide = await loadPyodide();
    // Mounts /data (IndexedDB, where sessions are kept). The /cache mount (OPFS) is optional: Safari refuses
    // OPFS in private browsing, which made the loading fail. OpenMATB does not use it: keep /cache in memory then.
    const bridge = await installPygletEmscripten(pyodide, { cachePath: null });
    try {
        await bridge.mount_opfs("/cache");
    } catch (error) {
        console.warn("OPFS unavailable, /cache kept in memory:", error);
        pyodide.FS.mkdirTree("/cache");
    }

    status("loading_pyglet");
    await pyodide.loadPackage("micropip");
    const micropip = pyodide.pyimport("micropip");
    const wheels = (await (await fetch("wheels.txt")).text()).trim().split("\n");
    for (const wheel of wheels) {
        await micropip.install(new URL(`wheels/${wheel}`, location.href).href);
    }

    status("loading_openmatb");
    const app = await (await fetch("app.zip")).arrayBuffer();
    pyodide.unpackArchive(app, "zip", { extractDir: APP_DIR });
    if (DEMO) {
        applyDemoConfig(pyodide);
    }
    pyodide.runPython(`import os, sys; os.chdir("${APP_DIR}"); sys.path.insert(0, "${APP_DIR}")`);

    window.openmatb = { pyodide }; // for debugging from the browser console
    storage = bridge;
    status("ready");
    await cmi5Ready;
    const outputErrors = sessionOutputSettings(readAppConfig(pyodide)).errors;
    const deviceErrors = DEMO ? [] : await showDevices(readAppConfig(pyodide));
    const errors = [...lmsErrors, ...outputErrors, ...deviceErrors];
    $("start").disabled = !checkBrowser(pyodide) || !showConfigErrors(errors);
    return pyodide;
}

function readAppConfig(pyodide) {
    try {
        return pyodide.FS.readFile(`${APP_DIR}/config.ini`, { encoding: "utf8" });
    } catch {
        return "";
    }
}

// Show the configuration errors (session destinations) on the start page. Returns false if there are some.
function showConfigErrors(errors) {
    $("config-error").hidden = errors.length === 0;
    $("config-error").textContent = errors.length ? `${t("config_error")} ${errors.join(" ; ")}` : "";
    return errors.length === 0;
}

// Session file destinations (web_session_output in config.ini), set when a scenario is started
let sessionOutput = null;
const DESTINATION_NAMES = {
    download: "download", webdav: "WebDAV", jatos: "JATOS", datapipe: "DataPipe", scorm: "LMS", cmi5: "LMS",
};

async function importSession(pyodide, file, bytes) {
    // Imported CSV files are stored with the browser sessions, so they appear in the replay selector.
    // Compressed files (.csv.gz, as sent to JATOS) are stored decompressed.
    const folder = `${SESSIONS_DIR}/imported`;
    pyodide.FS.mkdirTree(folder);
    const csv = await gunzipIfNeeded(bytes);
    pyodide.FS.writeFile(`${folder}/${file.name.replace(/\.gz$/i, "")}`, new Uint8Array(csv));
}

const ready = boot().catch((error) => {
    status("loading_failed", String(error));
    throw error;
});

// OpenMATB uses function keys (F1-F6 in sysmon...): don't let the browser reload the page,
// open its help or move the focus. preventDefault() still lets pyglet receive the key.
window.addEventListener("keydown", (event) => {
    if (!$("pygletCanvas").hidden && /^F([1-9]|1[0-2])$/.test(event.key) && event.key !== "F11") {
        event.preventDefault();
    }
}, { capture: true });

// ---- Sessions kept in this browser (replay mode): download them again or delete them ----

// Session files under SESSIONS_DIR (run in this browser, or imported), the most recent first
function storedSessions(pyodide) {
    const sessions = [];
    const walk = (folder) => {
        let names;
        try {
            names = pyodide.FS.readdir(folder);
        } catch {
            return; // No session yet
        }
        for (const name of names.filter((n) => n !== "." && n !== "..")) {
            const path = `${folder}/${name}`;
            const stat = pyodide.FS.stat(path);
            if (pyodide.FS.isDir(stat.mode)) {
                walk(path);
            } else if (name.endsWith(".csv")) {
                const time = new Date(stat.mtime).getTime();
                sessions.push({ path, name, folder: folder.slice(SESSIONS_DIR.length + 1), size: stat.size, time });
            }
        }
    };
    walk(SESSIONS_DIR);
    return sessions.sort((a, b) => b.time - a.time);
}

function sessionButton(label, icon, action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "icon";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.textContent = icon;
    button.addEventListener("click", action);
    return button;
}

async function deleteSessions(pyodide, sessions) {
    for (const session of sessions) {
        pyodide.FS.unlink(session.path);
    }
    await storage.sync_idbfs(); // Also delete them from the browser storage
    showStoredSessions();
}

async function showStoredSessions() {
    if ($("mode").value !== "replay") {
        return;
    }
    const pyodide = await ready;
    const sessions = storedSessions(pyodide);
    $("sessions-empty").hidden = sessions.length > 0;
    $("delete-all").hidden = sessions.length === 0;
    $("sessions-list").replaceChildren(...sessions.map((session) => {
        const row = document.createElement("li");
        const label = document.createElement("span");
        label.className = "session-name";
        label.textContent = session.name;
        const details = document.createElement("small");
        const size = `${Math.max(1, Math.round(session.size / 1024))} kB`;
        details.textContent = session.folder ? `${session.folder} · ${size}` : size;
        label.append(details);
        row.append(
            label,
            sessionButton(t("download"), "⬇️", () => {
                downloadText(session.name, pyodide.FS.readFile(session.path, { encoding: "utf8" }));
            }),
            sessionButton(t("delete"), "🗑️", () => {
                if (window.confirm(t("confirm_delete").replace("{name}", session.name))) {
                    deleteSessions(pyodide, [session]);
                }
            }),
        );
        return row;
    }));
    $("delete-all").onclick = () => {
        if (window.confirm(t("confirm_delete_all").replace("{count}", sessions.length))) {
            deleteSessions(pyodide, sessions);
        }
    };
}

$("mode").addEventListener("change", () => {
    $("replay-options").hidden = $("mode").value !== "replay";
    showStoredSessions();
});

$("start").addEventListener("click", async () => {
    // Everything that needs the user gesture must happen before the first await
    const wantsFullscreen = $("fullscreen").checked;
    if (STUDY) {
        // Tracking by mouse movements: the pointer is hidden for the whole session. Before the full screen request,
        // which may use up the click; mouse_tracking.js retries on the next key press if this lock fails
        MouseTracking.lockNow();
    }
    const fullscreen = wantsFullscreen ? document.documentElement.requestFullscreen().catch(() => {}) : null;

    const params = new URLSearchParams(location.search);
    params.set("lang", $("lang").value);
    params.set("mode", $("mode").value);
    if (DEMO && !params.has("scenario")) {
        params.set("scenario", DEMO_SCENARIO);
    }
    if (STUDY) {
        params.set("scenario", STUDY_SCENARIO);
    }
    history.replaceState(null, "", `?${params}`);

    const file = $("mode").value === "replay" ? $("session-file").files[0] : undefined;
    const bytes = file ? await file.arrayBuffer() : null;
    const pyodide = await ready;

    // Where the session file will go. config.ini is read again: it may have been changed since the loading
    if ($("mode").value !== "replay") {
        const settings = sessionOutputSettings(readAppConfig(pyodide));
        settings.errors.unshift(...lmsErrors);
        let jatos;
        try {
            if (settings.destinations.includes("jatos")) {
                jatos = await loadJatos();
            }
        } catch (error) {
            settings.errors.push(String(error.message || error));
        }
        // Better now than after the session: DataPipe must accept the files of the experiment (the demo sends nothing)
        if (settings.destinations.includes("datapipe") && !settings.errors.length && !DEMO) {
            try {
                await checkDataPipe(settings.datapipeExperiment);
            } catch (error) {
                settings.errors.push(String(error.message || error));
            }
        }
        // Last: the trigger box and the LSL bridge are opened only if the session can start
        if (!settings.errors.length && !DEMO) {
            await showDevices(readAppConfig(pyodide)); // The port may have to be chosen
            settings.errors.push(...await openDevices(deviceSettings(readAppConfig(pyodide))));
        }
        if (!showConfigErrors(settings.errors)) {
            if (document.fullscreenElement) {
                document.exitFullscreen();
            }
            return;
        }
        sessionOutput = new SessionOutput(settings, { jatos });
    }

    $("menu").hidden = true;
    $("pygletCanvas").hidden = false;
    await fullscreen;

    if (file) {
        await importSession(pyodide, file, bytes);
    }
    status(null);
    try {
        if (STUDY && QUERY.get("fast") === "1") {
            // Researcher check of the whole study (end page, result code): scenario time 10 times faster
            pyodide.runPython("import os; os.environ['OPENMATB_TIME_FACTOR'] = '10'"); // Read by core/study_gate.py
        }
        await pyodide.runPythonAsync(`import runpy; runpy.run_path("main.py", run_name="__main__")`);
        $("pygletCanvas").focus();
    } catch (error) {
        status(null, String(error));
        console.error(error);
    }
});

// Back to the menu, keeping the chosen language
const backToMenu = () => {
    location.href = `${location.pathname}?lang=${$("lang").value}${DEMO ? "&demo=1" : ""}`;
};
$("back").addEventListener("click", backToMenu);

// Dispatched when OpenMATB closes (end of scenario, replay closed or selection cancelled)
document.addEventListener("openmatb-exit", () => {
    if ($("end").hidden) {
        // cmi5: reloading the page would fail (the LMS gives its token only once)
        cmi5 ? returnToCourse() : backToMenu();
    }
});

const readSessionFile = (pyodide, path) => pyodide.FS.readFile(path, { encoding: "utf8" });

// Dispatched by core.logger.Logger.checkpoint() every 10 s: send the file written so far (if configured)
document.addEventListener("openmatb-checkpoint", async (event) => {
    if (sessionOutput) {
        const pyodide = await ready;
        sessionOutput.checkpoint(sessionRelativePath(event.detail), readSessionFile(pyodide, event.detail));
    }
});

function destinationItem(text, ok) {
    const item = document.createElement("li");
    item.className = ok === undefined ? "" : ok ? "ok" : "failed";
    item.textContent = text;
    return item;
}

// Dispatched by core.logger.Logger.end_session(), with the path of the session file: download it and/or send it
document.addEventListener("openmatb-end", async (event) => {
    MouseTracking.release();
    if (document.fullscreenElement) {
        document.exitFullscreen();
    }
    $("pygletCanvas").hidden = true;
    const relativePath = sessionRelativePath(event.detail);
    $("end-file").textContent = relativePath.split("/").pop();
    $("end-destinations").replaceChildren(destinationItem(t("sending")));
    // JATOS (like an LMS) takes over at the end: going back to the menu would reload the page and leave the study
    // run unfinished
    const inJatos = Boolean(sessionOutput?.settings.destinations.includes("jatos"));
    $("back").hidden = inJatos || Boolean(scorm || cmi5);
    $("end").hidden = false;

    const pyodide = await ready;
    if (DEMO) {
        // Not kept for replay either
        pyodide.FS.unlink(event.detail);
        await storage.sync_idbfs();
        $("end-destinations").replaceChildren(destinationItem(t("demo_not_recorded")));
        document.querySelector('#end [data-i18n="kept_in_browser"]').hidden = true;
        return;
    }
    if (STUDY) {
        await showStudyResult(pyodide, event.detail);
    }
    const output = sessionOutput || new SessionOutput(sessionOutputSettings(""));
    const results = await output.finish(relativePath, readSessionFile(pyodide, event.detail));
    results.push(...await closeDevices());
    if (scorm) {
        const ok = scorm.complete(relativePath);
        results.push(ok ? { destination: "scorm", ok } : { destination: "scorm", ok, error: "see the console" });
    }
    if (cmi5) {
        try {
            const recorded = await cmi5.complete(relativePath);
            results.push({ destination: recorded ? "cmi5" : "cmi5_not_recorded", ok: recorded || undefined });
        } catch (error) {
            console.error(error);
            results.push({ destination: "cmi5", ok: false, error: String(error.message || error) });
        }
    }
    const resultText = (result) => {
        if (result.text) {
            return result.text;
        }
        return result.ok !== false
            ? t(`sent_${result.destination}`)
            : `${t("not_sent").replace("{destination}", DESTINATION_NAMES[result.destination])} ${result.error}`;
    };
    $("end-destinations").replaceChildren(...results.map((result) => destinationItem(resultText(result), result.ok)));
    // JATOS: end the study run (JATOS end page, or the redirection set in JATOS, e.g. to Prolific)
    if (results.some((result) => result.destination === "jatos" && result.ok)) {
        $("end-destinations").append(destinationItem(t("ending_study")));
        await new Promise((resolve) => setTimeout(resolve, 1000)); // Time to read that the file was sent
        try {
            console.info("[OpenMATB] JATOS: ending the study run");
            await window.jatos.endStudy();
            return; // JATOS shows its end page
        } catch (error) {
            console.error("[OpenMATB] JATOS: the study run could not be ended:", error);
            $("end-destinations").lastChild.replaceWith(destinationItem(
                `${t("study_not_ended")} ${error?.message || error?.responseText || error}`, false,
            ));
        }
    }
    if (cmi5) {
        $("end-destinations").append(destinationItem(t("back_to_course")));
        await new Promise((resolve) => setTimeout(resolve, 1000)); // Time to read where the file went
        await returnToCourse();
        return;
    }
    $("back").hidden = Boolean(scorm); // JATOS did not take over
});
