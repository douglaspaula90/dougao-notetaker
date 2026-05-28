// DougãoCast — Content Script
// Injects the side panel into Google Meet pages and bridges messages between
// the iframe (sidepanel.html) and the extension service worker.

(function () {
  // ── Meet info helpers ──────────────────────────────────────────────────────
  function getParticipants() {
    const names = new Set();
    const selectors = [
      '[data-participant-id] [data-self-name]',
      '.zWGUib',
      '.KF4T6b',
      '[jsname="tZPcob"]'
    ];
    for (const sel of selectors) {
      document.querySelectorAll(sel).forEach(el => {
        const name = el.textContent.trim();
        if (name && name.length > 1) names.add(name);
      });
    }
    return [...names];
  }

  // True iff string contains a Meet room code like "abc-defg-hij".
  function _hasRoomCode(s) {
    return /\b[a-z]{3}-[a-z]{4}-[a-z]{3}\b/i.test(s || "");
  }

  // Reject candidates we've seen the Meet DOM produce that are garbage:
  // - concatenated room codes ("fzw-yvzp-gjdfzw-yvzp-gjdmeeting_room…")
  // - "meeting_room" / "Esta cha…" debris
  // - empty / too short
  function _isJunkTitle(s) {
    if (!s || s.trim().length < 2) return true;
    if (/meeting_room|reunion_room/i.test(s)) return true;
    if (/([a-z]{3}-[a-z]{4}-[a-z]{3}).*\1/i.test(s)) return true; // code twice
    return false;
  }

  function getMeetingTitle() {
    // 1) document.title is the most stable signal on Meet — it carries the
    //    Calendar event name when the meeting came from an invite.
    if (document.title && document.title !== "Google Meet") {
      const clean = document.title.replace(/ [-—|] Google Meet$/i, "").trim();
      if (clean && clean !== "Google Meet" && !_isJunkTitle(clean) && !_hasRoomCode(clean)) {
        return clean;
      }
    }

    // 2) data-meeting-title attribute (cleaner than visible DOM text)
    const titleEl = document.querySelector('[data-meeting-title]');
    if (titleEl) {
      const attr = titleEl.getAttribute('data-meeting-title');
      if (attr && !_isJunkTitle(attr) && !_hasRoomCode(attr)) return attr.trim();
    }

    // 3) Last resort: room code from URL.
    //    We deliberately skip the `.u6vdEc` DOM lookup the previous version
    //    used — it has been observed to concatenate duplicated room codes
    //    with i18n debris ("…meeting_roomEsta cha…").
    const match = location.pathname.match(/\/([a-z]{3}-[a-z]{4}-[a-z]{3})/);
    if (match) return `Reunião ${match[1].toUpperCase()}`;
    return `Reunião ${new Date().toLocaleDateString('pt-BR')}`;
  }

  function isInMeeting() {
    return /\/[a-z]{3}-[a-z]{4}-[a-z]{3}/i.test(location.pathname);
  }

  // ── Side panel injection ───────────────────────────────────────────────────
  const CONTAINER_ID = "dougao-sidepanel-container";
  const TOGGLE_ID = "dougao-sidepanel-toggle";
  let collapsed = false;
  let cachedTabId = null;

  function injectSidePanel() {
    if (document.getElementById(CONTAINER_ID)) return;
    if (!isInMeeting()) return;

    const container = document.createElement("div");
    container.id = CONTAINER_ID;
    Object.assign(container.style, {
      position: "fixed",
      top: "60px",
      right: "0",
      width: "360px",
      height: "calc(100vh - 80px)",
      zIndex: "9999",
      boxShadow: "-4px 0 16px rgba(0,0,0,0.4)",
      transition: "transform 0.25s ease",
      borderRadius: "8px 0 0 8px",
      overflow: "hidden"
    });

    const iframe = document.createElement("iframe");
    iframe.src = chrome.runtime.getURL("sidepanel.html");
    iframe.id = "dougao-sidepanel-iframe";
    Object.assign(iframe.style, {
      width: "100%",
      height: "100%",
      border: "none",
      display: "block"
    });
    container.appendChild(iframe);

    const toggle = document.createElement("button");
    toggle.id = TOGGLE_ID;
    toggle.textContent = "🎙️";
    toggle.title = "Mostrar/ocultar DougãoCast";
    Object.assign(toggle.style, {
      position: "fixed",
      top: "100px",
      right: "360px",
      zIndex: "10000",
      width: "36px",
      height: "36px",
      border: "none",
      borderRadius: "10px 0 0 10px",
      background: "#6366f1",
      color: "white",
      fontSize: "18px",
      cursor: "pointer",
      boxShadow: "-2px 2px 8px rgba(0,0,0,0.3)",
      transition: "right 0.25s ease"
    });
    toggle.addEventListener("click", toggleCollapse);

    document.body.appendChild(container);
    document.body.appendChild(toggle);

    console.log("[DougãoCast] side panel injected");
  }

  function toggleCollapse() {
    collapsed = !collapsed;
    const container = document.getElementById(CONTAINER_ID);
    const toggle = document.getElementById(TOGGLE_ID);
    if (!container || !toggle) return;
    container.style.transform = collapsed ? "translateX(100%)" : "translateX(0)";
    toggle.style.right = collapsed ? "0" : "360px";
  }

  // ── Bridge: iframe ↔ extension service worker ──────────────────────────────
  window.addEventListener("message", async (event) => {
    if (!event.data || event.data.source !== "dougao-sidepanel") return;

    if (event.data.action === "REQUEST_HOST_INFO") {
      if (!cachedTabId) {
        try {
          const res = await chrome.runtime.sendMessage({ action: "WHO_AM_I" });
          cachedTabId = (res && res.tabId) || null;
        } catch (e) { /* ignore */ }
      }
      const iframe = document.getElementById("dougao-sidepanel-iframe");
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({
          source: "dougao-host",
          action: "HOST_INFO",
          tabId: cachedTabId,
          title: getMeetingTitle(),
          participants: getParticipants()
        }, "*");
      }
    }

    if (event.data.action === "TOGGLE_COLLAPSE") {
      toggleCollapse();
    }
  });

  // Legacy popup support
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "GET_MEET_INFO") {
      sendResponse({
        participants: getParticipants(),
        title: getMeetingTitle(),
        url: location.href
      });
    }
  });

  // ── Bootstrap ──────────────────────────────────────────────────────────────
  // Meet is a SPA — re-check on every DOM mutation.
  const observer = new MutationObserver(() => {
    if (isInMeeting()) injectSidePanel();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  if (isInMeeting()) injectSidePanel();
})();
