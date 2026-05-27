// DougãoCast — Side panel injected into Google Meet
// Runs inside an iframe (chrome-extension://) embedded by content.js.

const DEFAULT_DASHBOARD_URL = "http://187.77.56.193:3010";
const DEFAULT_API_BASE = "http://187.77.56.193:3010/api";

let timerInterval = null;
let durationSeconds = 0;
let parentTabId = null;
let meetTitleHint = null;

// ── DOM refs ────────────────────────────────────────────────────────────────
const statusDot   = document.getElementById("status-dot");
const statusText  = document.getElementById("status-text");
const timerEl     = document.getElementById("timer");
const btnStart    = document.getElementById("btn-start");
const btnStop     = document.getElementById("btn-stop");
const preRec      = document.getElementById("pre-recording");
const duringRec   = document.getElementById("during-recording");
const msgArea     = document.getElementById("message-area");
const titleInput  = document.getElementById("meeting-title");
const dashLink    = document.getElementById("dashboard-link");
const minLink     = document.getElementById("minimize-link");

// ── Config ──────────────────────────────────────────────────────────────────
async function loadConfig() {
  return new Promise(resolve => {
    chrome.storage.local.get(["dashboardUrl", "apiBase"], (res) => {
      resolve({
        dashboardUrl: (res && res.dashboardUrl) || DEFAULT_DASHBOARD_URL,
        apiBase: (res && res.apiBase) || DEFAULT_API_BASE,
      });
    });
  });
}

// ── Tabs ────────────────────────────────────────────────────────────────────
document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => {
    const target = btn.dataset.tab;
    document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t === btn));
    document.querySelectorAll(".panel").forEach(p => {
      p.classList.toggle("active", p.dataset.panel === target);
    });
  });
});

// ── Init ────────────────────────────────────────────────────────────────────
async function init() {
  const cfg = await loadConfig();
  dashLink.href = cfg.dashboardUrl;

  // Listen for the host content script to tell us our tab id + meet info
  window.addEventListener("message", (event) => {
    if (!event.data || event.data.source !== "dougao-host") return;
    if (event.data.action === "HOST_INFO") {
      parentTabId = event.data.tabId;
      meetTitleHint = event.data.title;
      if (meetTitleHint && !titleInput.value) {
        titleInput.placeholder = meetTitleHint;
      }
    }
  });

  // Ask the host (content.js in the Meet page) for info
  window.parent.postMessage({ source: "dougao-sidepanel", action: "REQUEST_HOST_INFO" }, "*");

  // Check if we're already recording (e.g. user closed/reopened the panel mid-recording)
  chrome.runtime.sendMessage({ action: "GET_STATUS" }, (status) => {
    if (status && status.isRecording) {
      setRecordingState(true, status.duration || 0);
    }
  });
}

// ── State ───────────────────────────────────────────────────────────────────
function setRecordingState(isRecording, initialSeconds = 0) {
  durationSeconds = initialSeconds;
  if (isRecording) {
    statusDot.className = "dot recording";
    statusText.textContent = "Gravando…";
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

function clearMessage() {
  msgArea.innerHTML = "";
}

// ── Events ──────────────────────────────────────────────────────────────────
btnStart.addEventListener("click", async () => {
  clearMessage();

  if (!parentTabId) {
    // Try again to get the host info synchronously
    window.parent.postMessage({ source: "dougao-sidepanel", action: "REQUEST_HOST_INFO" }, "*");
    showMessage("Carregando contexto da aba do Meet…", "info");
    setTimeout(() => btnStart.click(), 500);
    return;
  }

  const title = titleInput.value.trim() || meetTitleHint || `Reunião ${new Date().toLocaleDateString("pt-BR")}`;

  btnStart.disabled = true;
  btnStart.textContent = "Iniciando…";

  chrome.runtime.sendMessage(
    { action: "START_RECORDING", tabId: parentTabId, meetingTitle: title },
    (res) => {
      btnStart.disabled = false;
      btnStart.textContent = "⏺ Iniciar Gravação";
      if (res && res.ok) {
        setRecordingState(true);
        showMessage("✅ Gravação iniciada!", "success");
      } else {
        showMessage(`Erro: ${res?.error || "Falha ao iniciar"}`, "error");
      }
    }
  );
});

btnStop.addEventListener("click", async () => {
  clearMessage();
  const title = titleInput.value.trim() || meetTitleHint || `Reunião ${new Date().toLocaleDateString("pt-BR")}`;

  btnStop.disabled = true;
  btnStop.textContent = "Enviando…";
  showMessage("⏳ Enviando áudio para processamento…");

  chrome.runtime.sendMessage(
    { action: "STOP_RECORDING", meetingTitle: title, speakerNames: {} },
    (res) => {
      btnStop.disabled = false;
      btnStop.textContent = "⏹ Finalizar e Enviar";
      setRecordingState(false);
      if (res && res.ok) {
        showMessage(`✅ Enviado! Processando transcrição…<br><small>ID: ${res.meeting_id}</small>`, "success");
      } else {
        showMessage(`Erro: ${res?.error || "Falha ao enviar"}`, "error");
      }
    }
  );
});

// Prompt buttons — wired but disabled until SAL-104 backend is ready
document.querySelectorAll(".prompt-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    // Placeholder behavior — when SAL-104 lands, this will POST to /meetings/{id}/chat
    showMessage("Chat IA estará disponível em breve (SAL-104).", "info");
  });
});

// Minimize: tell the host content script to collapse
minLink.addEventListener("click", (e) => {
  e.preventDefault();
  window.parent.postMessage({ source: "dougao-sidepanel", action: "TOGGLE_COLLAPSE" }, "*");
});

init();
