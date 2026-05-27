// DougãoCast — Offscreen recorder
// MV3 service workers cannot call navigator.mediaDevices.getUserMedia or use
// MediaRecorder. We do all the actual recording here in an offscreen document.

let mediaRecorder = null;
let audioChunks = [];
let mediaStream = null;
let audioContext = null;

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
  mediaRecorder.start(5000); // flush every 5s
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
