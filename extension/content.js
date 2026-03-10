// DougãoCast — Content Script
// Runs inside Google Meet pages to extract participant names

(function () {
  // Extract participant names from the Meet DOM
  function getParticipants() {
    const names = new Set();

    // Meet shows participants in multiple places, try all selectors
    const selectors = [
      '[data-participant-id] [data-self-name]',
      '.zWGUib',        // participant tile names
      '.KF4T6b',        // bottom bar participant names
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

  // Get the meeting title/code from the page
  function getMeetingTitle() {
    // Try to get the meeting name if set
    const titleEl = document.querySelector('[data-meeting-title]') ||
                    document.querySelector('.u6vdEc'); // meeting code area
    if (titleEl) return titleEl.textContent.trim();

    // Fallback: use URL code
    const match = location.pathname.match(/\/([a-z]{3}-[a-z]{4}-[a-z]{3})/);
    if (match) return `Reunião ${match[1].toUpperCase()}`;

    return `Reunião ${new Date().toLocaleDateString('pt-BR')}`;
  }

  // Listen for requests from background/popup
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "GET_MEET_INFO") {
      sendResponse({
        participants: getParticipants(),
        title: getMeetingTitle(),
        url: location.href
      });
    }
  });
})();
