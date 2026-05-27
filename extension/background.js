// DougãoCast — Background Service Worker
// Handles audio capture from Google Meet tabs

// Defaults — pode ser sobrescrito em chrome.storage.local pelo popup de Settings.
const DEFAULT_API_BASE = "http://187.77.56.193:8000/api";

async function getApiBase() {
  return new Promise(resolve => {
    chrome.storage.local.get(["apiBase"], (res) => {
      resolve((res && res.apiBase) || DEFAULT_API_BASE);
    });
  });
}

let mediaRecorder = null;
let audioChunks = [];
let recordingTabId = null;
let captureStream = null;
let meetingStartTime = null;

// ── Messages from popup ─────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "START_RECORDING") {
    startRecording(msg.tabId, msg.meetingTitle)
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
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
      isRecording: mediaRecorder !== null,
      tabId: recordingTabId,
      duration: meetingStartTime ? Math.floor((Date.now() - meetingStartTime) / 1000) : 0
    });
  }
});

// ── Recording ────────────────────────────────────────────────────────────────

async function startRecording(tabId, title) {
  if (mediaRecorder) throw new Error("Already recording");

  return new Promise((resolve, reject) => {
    chrome.tabCapture.capture(
      { audio: true, video: false },
      (stream) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!stream) {
          reject(new Error("Could not capture tab audio"));
          return;
        }

        captureStream = stream;
        recordingTabId = tabId;
        meetingStartTime = Date.now();
        audioChunks = [];

        mediaRecorder = new MediaRecorder(stream, {
          mimeType: "audio/webm;codecs=opus"
        });

        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) audioChunks.push(e.data);
        };

        mediaRecorder.start(5000); // collect chunks every 5s
        console.log("🎙️ DougãoCast: Recording started");

        // Update badge
        chrome.action.setBadgeText({ text: "REC", tabId });
        chrome.action.setBadgeBackgroundColor({ color: "#ef4444" });

        resolve({ started: true });
      }
    );
  });
}

async function stopRecording(meetingTitle, speakerNames = {}) {
  if (!mediaRecorder) throw new Error("Not recording");

  return new Promise((resolve, reject) => {
    mediaRecorder.onstop = async () => {
      try {
        const blob = new Blob(audioChunks, { type: "audio/webm" });
        console.log(`🎙️ DougãoCast: Recorded ${(blob.size / 1024 / 1024).toFixed(1)} MB`);

        // Upload to backend
        const result = await uploadAudio(blob, meetingTitle, speakerNames);

        // Clear state
        cleanup();
        resolve(result);
      } catch (err) {
        cleanup();
        reject(err);
      }
    };

    mediaRecorder.stop();
    if (captureStream) captureStream.getTracks().forEach(t => t.stop());
  });
}

async function uploadAudio(blob, title, speakerNames) {
  const apiBase = await getApiBase();
  const formData = new FormData();
  formData.append("file", blob, "meeting.webm");
  formData.append("title", title || `Reunião ${new Date().toLocaleDateString("pt-BR")}`);
  formData.append("speaker_names", JSON.stringify(speakerNames));

  const response = await fetch(`${apiBase}/audio/upload`, {
    method: "POST",
    body: formData
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Upload failed (${response.status}): ${err}`);
  }

  return await response.json();
}

function cleanup() {
  if (recordingTabId) {
    chrome.action.setBadgeText({ text: "", tabId: recordingTabId });
  }
  mediaRecorder = null;
  captureStream = null;
  audioChunks = [];
  recordingTabId = null;
  meetingStartTime = null;
  console.log("🎙️ DougãoCast: Stopped and cleaned up");
}

// ── Auto-detect meeting end ───────────────────────────────────────────────────

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === recordingTabId && mediaRecorder) {
    console.log("DougãoCast: Meet tab closed, stopping recording...");
    stopRecording("Reunião encerrada").catch(console.error);
  }
});
