// DougãoCast — Offscreen recorder
// MV3 service workers cannot call navigator.mediaDevices.getUserMedia or use
// MediaRecorder. We do all the actual recording here in an offscreen document.
//
// The offscreen document is the SOURCE OF TRUTH for "is a recording active":
// the service worker can be (and during long meetings WILL be) recycled,
// losing its in-memory flags. This document keeps recording regardless. To
// stop the SW from being killed mid-recording — which used to desync the UI
// and make "Finalizar" report "Not recording" — we hold a keepalive port to
// the SW for the entire recording.

let mediaRecorder = null;
let audioChunks = [];
let mediaStream = null;
let audioContext = null;
let keepAlivePort = null;
let keepAliveTimer = null;

// ── Keepalive: hold a port open so the SW isn't suspended while recording ──
function startKeepAlive() {
  const connect = () => {
    try {
      keepAlivePort = chrome.runtime.connect({ name: "keepalive" });
      keepAlivePort.onDisconnect.addListener(() => {
        keepAlivePort = null;
        // Reconnect only while still recording (Chrome may drop ports ~5min).
        if (mediaRecorder) connect();
      });
    } catch (e) {
      keepAlivePort = null;
    }
  };
  connect();
  // Belt-and-suspenders: ping every 20s to reset the SW idle timer even if
  // the port mechanism changes across Chrome versions.
  clearInterval(keepAliveTimer);
  keepAliveTimer = setInterval(() => {
    if (!mediaRecorder) return;
    try {
      chrome.runtime.sendMessage({ target: "sw", action: "KEEPALIVE_PING" }).catch(() => {});
    } catch (e) { /* ignore */ }
    if (!keepAlivePort) connect();
  }, 20000);
}

function stopKeepAlive() {
  clearInterval(keepAliveTimer);
  keepAliveTimer = null;
  try { if (keepAlivePort) keepAlivePort.disconnect(); } catch (e) {}
  keepAlivePort = null;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target !== "offscreen") return false;

  if (msg.action === "OFFSCREEN_START") {
    startCapture(msg.streamId)
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true; // async
  }

  if (msg.action === "OFFSCREEN_STOP_AND_UPLOAD") {
    stopAndUpload(msg.apiBase, msg.title, msg.speakerNames || {}, msg.apiKey)
      .then(result => sendResponse({ ok: true, ...result }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.action === "OFFSCREEN_PING") {
    sendResponse({ ok: true, recording: !!mediaRecorder });
    return false;
  }
});

async function startCapture(streamId) {
  if (mediaRecorder) throw new Error("Already recording");

  // Hand the streamId from chrome.tabCapture.getMediaStreamId to getUserMedia.
  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId
      }
    },
    video: false
  });

  // CRITICAL: tabCapture mutes the original tab. Re-route the captured audio
  // back to the speakers so the user keeps hearing the meeting.
  audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(mediaStream);
  source.connect(audioContext.destination);

  audioChunks = [];
  mediaRecorder = new MediaRecorder(mediaStream, {
    mimeType: "audio/webm;codecs=opus"
  });
  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) audioChunks.push(e.data);
  };
  // If the captured tab stream ends unexpectedly (tab closed/crashed), flush
  // what we have instead of silently losing it.
  mediaRecorder.onerror = (e) => console.error("[offscreen] MediaRecorder error:", e);
  mediaRecorder.start(5000); // flush a chunk into audioChunks every 5s
  startKeepAlive();
  console.log("[offscreen] recording started, streamId=", streamId);
}

async function stopAndUpload(apiBase, title, speakerNames, apiKey) {
  if (!mediaRecorder) throw new Error("Not recording");

  // Wait for the final dataavailable + stop event.
  const stopped = new Promise(resolve => {
    mediaRecorder.onstop = resolve;
  });
  mediaRecorder.stop();
  await stopped;

  const blob = new Blob(audioChunks, { type: "audio/webm" });
  console.log(`[offscreen] blob ready: ${(blob.size / 1024 / 1024).toFixed(2)} MB`);

  // Tear down audio plumbing.
  try {
    if (mediaStream) mediaStream.getTracks().forEach(t => t.stop());
  } catch (e) { /* ignore */ }
  try {
    if (audioContext) await audioContext.close();
  } catch (e) { /* ignore */ }

  mediaStream = null;
  mediaRecorder = null;
  audioContext = null;
  audioChunks = [];
  stopKeepAlive();

  // Upload directly from the offscreen doc (avoids shipping the Blob across
  // contexts).
  const formData = new FormData();
  formData.append("file", blob, "meeting.webm");
  formData.append(
    "title",
    title || `Reunião ${new Date().toLocaleDateString("pt-BR")}`
  );
  formData.append("speaker_names", JSON.stringify(speakerNames || {}));

  const headers = {};
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const response = await fetch(`${apiBase}/audio/upload`, {
    method: "POST",
    headers,
    body: formData
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Upload failed (${response.status}): ${errText}`);
  }

  return await response.json();
}
