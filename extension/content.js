// DougãoCast — Content Script
//
// Lives inside meet.google.com tabs. Its only jobs now are:
//   1) Extract meeting title + participants from the Meet DOM
//   2) Answer GET_MEET_INFO requests from the side panel / popup
//
// The 1.0.x version also injected a fake side panel as an iframe, but that
// produced the "Extension has not been invoked" error because tabCapture
// can only be initiated from a context that the user has explicitly invoked
// (the toolbar action). We now use the real chrome.sidePanel API instead,
// so this script no longer touches the DOM.

(function () {
  // ── Helpers ────────────────────────────────────────────────────────────────
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
    //    We deliberately skip the `.u6vdEc` DOM lookup the old version used —
    //    it concatenated duplicated room codes with i18n debris.
    const match = location.pathname.match(/\/([a-z]{3}-[a-z]{4}-[a-z]{3})/);
    if (match) return `Reunião ${match[1].toUpperCase()}`;
    return `Reunião ${new Date().toLocaleDateString('pt-BR')}`;
  }

  // ── Message bridge ─────────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "GET_MEET_INFO") {
      sendResponse({
        participants: getParticipants(),
        title: getMeetingTitle(),
        url: location.href
      });
      return false;
    }
  });
})();
