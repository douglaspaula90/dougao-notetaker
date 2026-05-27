// DougãoCast — Background Service Worker
//
// MV3: chrome.tabCapture.capture() doesn't exist anymore.
// New flow:
//   1) Background asks chrome.tabCapture.getMediaStreamId() for a streamId
//   2) Background opens an offscreen document (offscreen.html)
//   3) Offscreen calls navigator.mediaDevices.getUserMedia() with that streamId
//      and records with MediaRecorder
//   4) On stop, offscreen uploads the blob directly to the backend

const DEFAULT_API_BASE = "http://187.77.56.193:3010/api";
const OFFSCREEN_PATH = "offscreen.html";

let recordingTabId = null;
let meetingStartTime = null;
let isRecording = false;

async function getApiBase() {
  return new Promise(resolve => {
    chrome.storage.local.get(["apiBase"], (res) => {
      resolve((res && res.apiBase) || DEFAULT_API_BASE);
    });
  });
}

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
    } catch (e) {
      // Race: offscreen may have closed itself.
    }
  }
}

// ── Messages from popup ─────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Messages addressed to the offscreen doc are not for us.
  if (msg && msg.target === "offscreen") return false;

  if (msg.action === "START_RECORDING") {
    startRecording(msg.tabId, msg.meetingTitle)
      .then(() => sendResponse({ ok: true }))
      .catch(async err => {
        await cleanup();
        sendResponse({ ok: false, error: err.message });
      });
    return true; // async
  }

  if (msg.action === "STOP_RECORDING") {
    stopRecording(msg.meetingTitle, msg.speakerNames)
      .then(result => sendResponse({ ok: true, ...result }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.action === "GET_STATUS") {
    sendResponse({
      isRecording,
      tabId: recordingTabId,
      duration: meetingStartTime
        ? Math.floor((Date.now() - meetingStartTime) / 1000)
        : 0
    });
    return false;
  }
});

// ── Recording ────────────────────────────────────────────────────────────────

async function startRecording(tabId, title) {
  if (isRecording) throw new Error("Already recording");

  // 1) Get a one-time media stream id bound to the target tab.
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

  // 2) Open the offscreen document if not already open.
  await ensureOffscreen();

  // 3) Hand the streamId to the offscreen recorder.
  const res = await chrome.runtime.sendMessage({
    target: "offscreen",
    action: "OFFSCREEN_START",
    streamId
  });
  if (!res || !res.ok) {
    throw new Error(res && res.error ? res.error : "Offscreen start failed");
  }

  recordingTabId = tabId;
  meetingStartTime = Date.now();
  isRecording = true;

  chrome.action.setBadgeText({ text: "REC", tabId });
  chrome.action.setBadgeBackgroundColor({ color: "#ef4444" });
  console.log("[bg] recording started, tab=", tabId);
}

async function stopRecording(meetingTitle, speakerNames = {}) {
  if (!isRecording) throw new Error("Not recording");

  const apiBase = await getApiBase();

  try {
    const res = await chrome.runtime.sendMessage({
      target: "offscreen",
      action: "OFFSCREEN_STOP_AND_UPLOAD",
      apiBase,
      title: meetingTitle,
      speakerNames
    });
    if (!res || !res.ok) {
      throw new Error(res && res.error ? res.error : "Offscreen stop failed");
    }
    return res; // { ok, meeting_id, ... }
  } finally {
    await cleanup();
  }
}

async function cleanup() {
  if (recordingTabId !== null) {
    try {
      chrome.action.setBadgeText({ text: "", tabId: recordingTabId });
    } catch (e) { /* ignore */ }
  }
  recordingTabId = null;
  meetingStartTime = null;
  isRecording = false;
  await closeOffscreen();
  console.log("[bg] cleaned up");
}

// ── Auto-detect meeting end ───────────────────────────────────────────────────

chrome.tabs.onRemoved.addListener(async (tabId) => {
  if (tabId === recordingTabId && isRecording) {
    console.log("[bg] Meet tab closed, finalizing recording...");
    try {
      await stopRecording("Reunião encerrada");
    } catch (e) {
      console.error("[bg] auto-stop failed:", e);
    }
  }
});
