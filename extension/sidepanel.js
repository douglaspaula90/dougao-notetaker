// DougãoCast — Side Panel (chrome.sidePanel API)
//
// Opens when the user clicks the toolbar icon (openPanelOnActionClick=true
// in background.js). Because that click is a user gesture targeting our
// extension, tabCapture is allowed from anywhere in this panel.

const DEFAULT_DASHBOARD_URL = "http://187.77.56.193:3010";
const DEFAULT_API_BASE = "http://187.77.56.193:3010/api";

let timerInterval = null;
let durationSeconds = 0;
let activeTab = null;
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

// ── Active tab discovery ────────────────────────────────────────────────────
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

async function fetchMeetInfo(tabId) {
  return new Promise(resolve => {
    try {
      chrome.tabs.sendMessage(tabId, { action: "GET_MEET_INFO" }, (info) => {
        if (chrome.runtime.lastError) {
          // Content script may not be loaded yet (e.g. pre-join lobby).
          resolve(null);
        } else {
          resolve(info || null);
        }
      });
    } catch (e) {
      resolve(null);
    }
  });
}

// ── Init ────────────────────────────────────────────────────────────────────
async function init() {
  const cfg = await loadConfig();
  dashLink.href = cfg.dashboardUrl;
  minLink.style.display = "none"; // Side Panel can be closed from the browser UI

  activeTab = await getActiveMeetTab();
  if (!activeTab) {
    showMessage(
      "Abra uma reunião no Google Meet primeiro, depois reabra este painel.",
      "info"
    );
    btnStart.disabled = true;
    return;
  }

  const info = await fetchMeetInfo(activeTab.id);
  if (info && info.title) {
    meetTitleHint = info.title;
    titleInput.placeholder = info.title;
  }

  // Re-attach to an in-progress recording (e.g. user closed/reopened panel)
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

  // Re-discover the active tab in case the user switched tabs since opening.
  activeTab = await getActiveMeetTab();
  if (!activeTab) {
    showMessage("Foque uma aba do Google Meet primeiro.", "error");
    return;
  }

  const title = titleInput.value.trim() || meetTitleHint
    || `Reunião ${new Date().toLocaleDateString("pt-BR")}`;

  btnStart.disabled = true;
  btnStart.textContent = "Iniciando…";

  chrome.runtime.sendMessage(
    { action: "START_RECORDING", tabId: activeTab.id, meetingTitle: title },
    (res) => {
      btnStart.disabled = false;
      btnStart.textContent = "⏺ Iniciar Gravação";
      if (res && res.ok) {
        setRecordingState(true);
        showMessage("✅ Gravação iniciada!", "success");
      } else {
        const err = (res && res.error) || "Falha ao iniciar";
        if (/not been invoked|activeTab/i.test(err)) {
          showMessage(
            "O Chrome bloqueou a captura porque a extensão ainda não foi 'invocada' nessa aba. " +
            "Feche este painel, clique no ícone 🎙️ DougãoCast na barra de novo e tente outra vez.",
            "error"
          );
        } else {
          showMessage(`Erro: ${err}`, "error");
        }
      }
    }
  );
});

btnStop.addEventListener("click", async () => {
  clearMessage();
  const title = titleInput.value.trim() || meetTitleHint
    || `Reunião ${new Date().toLocaleDateString("pt-BR")}`;

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
        showMessage(
          `✅ Enviado! Processando transcrição…<br><small>ID: ${res.meeting_id}</small>`,
          "success"
        );
      } else {
        showMessage(`Erro: ${(res && res.error) || "Falha ao enviar"}`, "error");
      }
    }
  );
});

// Prompt-suggestion buttons (still placeholders until SAL-104 backend lands)
document.querySelectorAll(".prompt-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    showMessage("Chat IA estará disponível em breve (SAL-104).", "info");
  });
});

init();
