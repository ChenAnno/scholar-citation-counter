const countEl = document.getElementById('citation-count');
const statusEl = document.getElementById('status');
const refreshBtn = document.getElementById('refresh');
const viewNewBtn = document.getElementById('view-new');
const homeLinkEl = document.getElementById('home-link');
const scholarLinkEl = document.getElementById('scholar-link');

// New-papers drawer.
const overlayView = document.getElementById('overlay-view');
const closeOverlayBtn = document.getElementById('close-overlay');
const paperListContainer = document.getElementById('paper-list');

// Settings drawer.
const openSettingsBtn = document.getElementById('open-settings');
const settingsView = document.getElementById('settings-view');
const closeSettingsBtn = document.getElementById('close-settings');
const saveSettingsBtn = document.getElementById('save-settings');
const settingsStatusEl = document.getElementById('settings-status');
const inputScholar = document.getElementById('input-scholar');
const inputName = document.getElementById('input-name');
const inputHome = document.getElementById('input-home');

const COOLDOWN_MS = 60 * 60 * 1000;
const DEFAULT_DOMAIN = "scholar.google.com";
const DEFAULT_LANG = "en";

// Parse a pasted Scholar profile URL (or bare user ID) into its parts.
function parseScholarInput(raw) {
  const value = (raw || '').trim();
  if (!value) return null;

  // Looks like a Scholar URL.
  if (value.includes('scholar.google')) {
    try {
      const url = new URL(value.startsWith('http') ? value : 'https://' + value);
      const userId = url.searchParams.get('user');
      if (!userId) return null;
      return {
        userId,
        lang: url.searchParams.get('hl') || DEFAULT_LANG,
        domain: url.hostname || DEFAULT_DOMAIN
      };
    } catch (e) {
      return null;
    }
  }

  // Otherwise treat it as a bare user ID (optionally prefixed with "user=").
  const userId = value.replace(/^user=/, '');
  return { userId, lang: DEFAULT_LANG, domain: DEFAULT_DOMAIN };
}

function buildScholarUrl(cfg) {
  const domain = cfg.scholarDomain || DEFAULT_DOMAIN;
  const lang = cfg.scholarLang || DEFAULT_LANG;
  return `https://${domain}/citations?user=${encodeURIComponent(cfg.scholarUserId)}&hl=${encodeURIComponent(lang)}&oi=sra`;
}

// Render the main card's name + links from saved config.
function applyConfig(cfg) {
  // Display name + homepage link.
  const name = cfg.displayName || 'My Profile';
  homeLinkEl.textContent = name;
  if (cfg.homepageUrl) {
    homeLinkEl.href = cfg.homepageUrl;
    homeLinkEl.style.pointerEvents = '';
  } else {
    homeLinkEl.removeAttribute('href');
    homeLinkEl.style.pointerEvents = 'none';
  }

  // Scholar profile link.
  if (cfg.scholarUserId) {
    scholarLinkEl.href = buildScholarUrl(cfg);
    scholarLinkEl.style.pointerEvents = '';
  } else {
    scholarLinkEl.removeAttribute('href');
    scholarLinkEl.style.pointerEvents = 'none';
  }
}

function startRefresh() {
  chrome.storage.local.get(['lastRefreshTime', 'scholarUserId'], (data) => {
    if (!data.scholarUserId) {
      statusEl.innerText = "Set up your profile";
      openSettings();
      return;
    }

    const now = Date.now();
    if (data.lastRefreshTime && (now - data.lastRefreshTime < COOLDOWN_MS)) {
      const minsLeft = Math.ceil((COOLDOWN_MS - (now - data.lastRefreshTime)) / 60000);
      statusEl.innerText = `${minsLeft}m to next sync`;
      return;
    }

    statusEl.innerText = "Syncing...";
    chrome.runtime.sendMessage({ type: "GET_DATA" }, (res) => {
      if (res && res.success) {
        countEl.innerText = res.count;
        statusEl.innerText = "Updated";
      } else if (res && res.error === "CAPTCHA") {
        statusEl.innerHTML = `<a href="${res.url}" target="_blank" class="captcha-link">Verify Identity</a>`;
      } else if (res && res.error === "NO_CONFIG") {
        statusEl.innerText = "Set up your profile";
        openSettings();
      } else {
        statusEl.innerText = "Offline";
      }
    });
  });
}

// ---- New-papers drawer ----
viewNewBtn.addEventListener('click', () => {
  chrome.storage.local.get(['newPapers'], (data) => {
    const papersToDisplay = data.newPapers;
    paperListContainer.innerHTML = '';

    if (papersToDisplay && papersToDisplay.length > 0) {
      papersToDisplay.forEach(item => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'paper-item';

        const badge = document.createElement('span');
        badge.className = 'paper-badge';
        badge.textContent = `+${item.diff} Citations`;

        const title = document.createElement('div');
        title.className = 'paper-title';
        title.textContent = item.title;

        itemDiv.appendChild(badge);
        itemDiv.appendChild(title);
        paperListContainer.appendChild(itemDiv);
      });
    } else {
      paperListContainer.innerHTML = `<div class="empty-state">No new citations since last record.</div>`;
    }

    overlayView.classList.add('active');
  });
});

closeOverlayBtn.addEventListener('click', () => {
  overlayView.classList.remove('active');
});

// ---- Settings drawer ----
function openSettings() {
  chrome.storage.local.get(
    ['scholarUserId', 'scholarLang', 'scholarDomain', 'displayName', 'homepageUrl'],
    (cfg) => {
      if (cfg.scholarUserId) {
        inputScholar.value = buildScholarUrl(cfg);
      }
      inputName.value = cfg.displayName || '';
      inputHome.value = cfg.homepageUrl || '';
      settingsStatusEl.textContent = '';
      settingsView.classList.add('active');
    }
  );
}

openSettingsBtn.addEventListener('click', openSettings);
closeSettingsBtn.addEventListener('click', () => settingsView.classList.remove('active'));

saveSettingsBtn.addEventListener('click', () => {
  const parsed = parseScholarInput(inputScholar.value);
  if (!parsed) {
    settingsStatusEl.style.color = '#C97B7B';
    settingsStatusEl.textContent = 'Enter a valid Scholar URL or user ID';
    return;
  }

  const cfg = {
    scholarUserId: parsed.userId,
    scholarLang: parsed.lang,
    scholarDomain: parsed.domain,
    displayName: inputName.value.trim(),
    homepageUrl: inputHome.value.trim()
  };

  chrome.storage.local.set(cfg, () => {
    applyConfig(cfg);
    settingsStatusEl.style.color = '';
    settingsStatusEl.textContent = 'Saved';
    setTimeout(() => {
      settingsView.classList.remove('active');
      startRefresh();
    }, 600);
  });
});

// ---- Init ----
chrome.storage.local.get(
  ['citationCount', 'lastRefreshTime', 'scholarUserId', 'scholarLang', 'scholarDomain', 'displayName', 'homepageUrl'],
  (data) => {
    applyConfig(data);

    if (!data.scholarUserId) {
      // First run — guide the user through setup.
      statusEl.innerText = "Set up your profile";
      openSettings();
      return;
    }

    if (data.citationCount) {
      countEl.innerText = data.citationCount;
      const time = new Date(data.lastRefreshTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      statusEl.innerText = "Last: " + time;
    } else {
      startRefresh();
    }
  }
);

refreshBtn.addEventListener('click', startRefresh);
