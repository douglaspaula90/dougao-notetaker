// DougãoCast — Background Service Worker
//
// MV3: chrome.tabCapture.capture() doesn't exist anymore.
// New flow:
//   1) Background asks chrome.tabCapture.getMediaStreamId() for a streamId
//   2) Background opens an offscreen document (offscreen.html)
//   3) Offscreen calls navigator.mediaDevices.getUserMedia() with that streamId
//      and records with MediaRecorder
//   4) On stop, offscreen uploads the blob directly to the backend
//
// State persistence: MV3 service workers are killed after ~30s of inactivity.
// We mirror recording state into chrome.storage.session so it survives that.

const DEFAULT_API_BASE = "http://187.77.56.193:3010/api";
const OFFSCREEN_PATH = "offscreen.html";
const STATE_KEY = "recordingState";

// In-memory cache (mirrored to chrome.storage.session)
let state = {
  isRecording: false,
  recordingTabId: null,
  meetingStartTime: null
};

// ── State persistence ───────────────────────────────────────────────────────
async function loadState() {
  return new Promise(resolve => {
    chrome.storage.session.get([STATE_KEY], (res) => {
      if (res && res[STATE_KEY]) state = res[STATE_KEY];
      resolve(state);
    });
  });
}

async function saveState() {
  return new Promise(resolve => {
    chrome.storage.session.set({ [STATE_KEY]: state }, resolve);
  });
}

// Hydrate state on startup (when the worker wakes up).
loadState();

// ── Config ──────────────────────────────────────────────────────────────────
async function getConfig() {
  return new Promise(resolve => {
    chrome.storage.local.get(["apiBase", "apiKey"], (res) => {
      resolve({
        apiBase: (res && res.apiBase) || DEFAULT_API_BASE,
        apiKey: (res && res.apiKey) || null
      });
    });
  });
}

// ── Offscreen lifecycle ────────────────────────────────────────────────────
async function hasOffscreen() {
  if (!chrome.runtime.getContexts) return false;
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"]
  });
  return contexts.length > 0;
}

async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: ["USER_MEDIA"],
    justification: "Recording Google Meet tab audio for transcription"
  });
}

async function closeOffscreen() {
  if (await hasOffscreen()) {
    try {
      await chrome.offscreen.closeDocument();
    } catch (e) { /* race */ }
  }
}

// ── Messages ────────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.target === "offscreen") return false;

  if (msg.action === "WHO_AM_I") {
    sendResponse({ tabId: sender.tab ? sender.tab.id : null });
    return false;
  }

  if (msg.action === "START_RECORDING") {
    startRecording(msg.tabId, msg.meetingTitle)
      .then(() => sendResponse({ ok: true }))
      .catch(async err => {
        await cleanup();
        sendResponse({ ok: false, error: err.message });
      });
    return true;
  }

  if (msg.action === "STOP_RECORDING") {
    stopRecording(msg.meetingTitle, msg.speakerNames)
      .then(result => sendResponse({ ok: true, ...result }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.action === "GET_STATUS") {
    // Re-hydrate from session storage in case worker was suspended.
    loadState().then(() => {
      sendResponse({
        isRecording: state.isRecording,
        tabId: state.recordingTabId,
        duration: state.meetingStartTime
          ? Math.floor((Date.now() - state.meetingStartTime) / 1000)
          : 0
      });
    });
    return true;
  }
});

// ── Recording ────────────────────────────────────────────────────────────────
async function startRecording(tabId, title) {
  await loadState();
  if (state.isRecording) throw new Error("Already recording");

  // 1) Stream id bound to the target tab
  const streamId = await new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (id) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (!id) {
        reject(new Error("Could not get media stream id (no tab audio?)"));
      } else {
        resolve(id);
      }
    });
  });

  // 2) Offscreen document
  await ensureOffscreen();

  // 3) Hand over the stream id
  const res = await chrome.runtime.sendMessage({
    target: "offscreen",
    action: "OFFSCREEN_START",
    streamId
  });
  if (!res || !res.ok) {
    throw new Error(res && res.error ? res.error : "Offscreen start failed");
  }

  state = {
    isRecording: true,
    recordingTabId: tabId,
    meetingStartTime: Date.now()
  };
  await saveState();

  chrome.action.setBadgeText({ text: "REC", tabId });
  chrome.action.setBadgeBackgroundColor({ color: "#ef4444" });
  console.log("[bg] recording started, tab=", tabId);
}

async function stopRecording(meetingTitle, speakerNames = {}) {
  await loadState();
  if (!state.isRecording) throw new Error("Not recording");

  const cfg = await getConfig();

  try {
    const res = await chrome.runtime.sendMessage({
      target: "offscreen",
      action: "OFFSCREEN_STOP_AND_UPLOAD",
      apiBase: cfg.apiBase,
      apiKey: cfg.apiKey,
      title: meetingTitle,
      speakerNames
    });
    if (!res || !res.ok) {
      throw new Error(res && res.error ? res.error : "Offscreen stop failed");
    }
    return res;
  } finally {
    await cleanup();
  }
}

async function cleanup() {
  const tabId = state.recordingTabId;
  if (tabId !== null) {
    try { chrome.action.setBadgeText({ text: "", tabId }); } catch (e) {}
  }
  state = { isRecording: false, recordingTabId: null, meetingStartTime: null };
  await saveState();
  await closeOffscreen();
  console.log("[bg] cleaned up");
}

// ── Auto-detect meeting end ───────────────────────────────────────────────────
chrome.tabs.onRemoved.addListener(async (tabId) => {
  await loadState();
  if (tabId === state.recordingTabId && state.isRecording) {
    console.log("[bg] Meet tab closed, finalizing recording...");
    try {
      await stopRecording("Reunião encerrada");
    } catch (e) {
      console.error("[bg] auto-stop failed:", e);
    }
  }
});
