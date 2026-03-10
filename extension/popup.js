// DougãoCast popup.js
const DASHBOARD_URL = "https://YOUR_VPS_DOMAIN"; // 🔧 Change this!

let timerInterval = null;
let durationSeconds = 0;

// ── Elements ─────────────────────────────────────────────────────────────────
const statusDot  = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");
const timerEl    = document.getElementById("timer");
const btnStart   = document.getElementById("btn-start");
const btnStop    = document.getElementById("btn-stop");
const preRec     = document.getElementById("pre-recording");
const duringRec  = document.getElementById("during-recording");
const msgArea    = document.getElementById("message-area");
const titleInput = document.getElementById("meeting-title");
const notInMeet  = document.getElementById("not-in-meet");
const mainUi     = document.getElementById("main-ui");
const dashLink   = document.getElementById("dashboard-link");

dashLink.href = DASHBOARD_URL;

// ── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  const tab = await getActiveMeetTab();

  if (!tab) {
    notInMeet.style.display = "block";
    mainUi.style.display = "none";
    return;
  }

  // Try to get meeting info from content script
  chrome.tabs.sendMessage(tab.id, { action: "GET_MEET_INFO" }, (info) => {
    if (info && info.title) {
      titleInput.placeholder = info.title;
    }
  });

  // Check if already recording
  chrome.runtime.sendMessage({ action: "GET_STATUS" }, (status) => {
    if (status.isRecording && status.tabId === tab.id) {
      setRecordingState(true, status.duration);
    }
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
async function getActiveMeetTab() {
  return new Promise(resolve => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (tab && tab.url && tab.url.includes("meet.google.com")) {
        resolve(tab);
      } else {
        resolve(null);
      }
    });
  });
}

function setRecordingState(isRecording, initialSeconds = 0) {
  durationSeconds = initialSeconds;

  if (isRecording) {
    statusDot.className = "dot recording";
    statusText.textContent = "Gravando...";
    timerEl.classList.add("visible");
    preRec.style.display = "none";
    duringRec.style.display = "block";

    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      durationSeconds++;
      const m = String(Math.floor(durationSeconds / 60)).padStart(2, "0");
      const s = String(durationSeconds % 60).padStart(2, "0");
      timerEl.textContent = `${m}:${s}`;
    }, 1000);
  } else {
    clearInterval(timerInterval);
    statusDot.className = "dot idle";
    statusText.textContent = "Pronto para gravar";
    timerEl.classList.remove("visible");
    preRec.style.display = "block";
    duringRec.style.display = "none";
  }
}

function showMessage(text, type = "info") {
  msgArea.innerHTML = `<div class="alert ${type}">${text}</div>`;
}

// ── Events ─────────────────────────────────────────────────────────────────
btnStart.addEventListener("click", async () => {
  const tab = await getActiveMeetTab();
  if (!tab) return showMessage("Nenhuma reunião ativa encontrada.", "error");

  // Get meeting info
  const info = await new Promise(resolve => {
    chrome.tabs.sendMessage(tab.id, { action: "GET_MEET_INFO" }, r => resolve(r || {}));
  });

  const title = titleInput.value.trim() || info.title || `Reunião ${new Date().toLocaleDateString("pt-BR")}`;

  btnStart.disabled = true;
  btnStart.textContent = "Iniciando...";

  chrome.runtime.sendMessage({ action: "START_RECORDING", tabId: tab.id, meetingTitle: title }, (res) => {
    if (res && res.ok) {
      setRecordingState(true);
      showMessage("✅ Gravação iniciada!");
    } else {
      showMessage(`Erro: ${res?.error || "Falha ao iniciar"}`, "error");
      btnStart.disabled = false;
      btnStart.textContent = "⏺ Iniciar Gravação";
    }
  });
});

btnStop.addEventListener("click", async () => {
  const tab = await getActiveMeetTab();
  const info = await new Promise(resolve => {
    chrome.tabs.sendMessage(tab?.id, { action: "GET_MEET_INFO" }, r => resolve(r || {}));
  });

  const title = titleInput.value.trim() || info?.title || `Reunião ${new Date().toLocaleDateString("pt-BR")}`;

  btnStop.disabled = true;
  btnStop.textContent = "Enviando...";
  setRecordingState(false);

  showMessage("⏳ Enviando áudio para processamento...");

  chrome.runtime.sendMessage(
    { action: "STOP_RECORDING", meetingTitle: title, speakerNames: {} },
    (res) => {
      if (res && res.ok) {
        showMessage(`✅ Enviado! Processando transcrição...<br><small>ID: ${res.meeting_id}</small>`, "success");
      } else {
        showMessage(`Erro: ${res?.error || "Falha ao enviar"}`, "error");
      }
      btnStop.disabled = false;
      btnStop.textContent = "⏹ Finalizar e Enviar";
    }
  );
});

init();
