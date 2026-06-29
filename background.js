// Default Scholar domain. Users in mainland China may prefer "scholar.google.com.hk".
const DEFAULT_DOMAIN = "scholar.google.com";
const DEFAULT_LANG = "en";

// Build the Scholar profile URL from the user's saved configuration.
// Returns null when the extension has not been configured yet.
async function buildScholarUrl() {
  const cfg = await chrome.storage.local.get(["scholarUserId", "scholarLang", "scholarDomain"]);
  if (!cfg.scholarUserId) return null;

  const domain = cfg.scholarDomain || DEFAULT_DOMAIN;
  const lang = cfg.scholarLang || DEFAULT_LANG;
  return `https://${domain}/citations?user=${encodeURIComponent(cfg.scholarUserId)}&hl=${encodeURIComponent(lang)}`;
}

async function fetchCitations() {
  try {
    const scholarUrl = await buildScholarUrl();
    if (!scholarUrl) {
      // Not configured yet — prompt the user to open the popup and set their profile.
      chrome.action.setBadgeText({ text: "?" });
      chrome.action.setBadgeBackgroundColor({ color: [0, 0, 0, 0] });
      if (chrome.action.setBadgeTextColor) chrome.action.setBadgeTextColor({ color: "#A1A9AD" });
      return { success: false, error: "NO_CONFIG" };
    }

    const response = await fetch(scholarUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36' }
    });

    if (response.url.includes("google.com/sorry")) {
      chrome.action.setBadgeText({ text: "!" });
      chrome.action.setBadgeBackgroundColor({ color: [0, 0, 0, 0] });
      if (chrome.action.setBadgeTextColor) chrome.action.setBadgeTextColor({ color: "#C28A3D" });
      return { success: false, error: "CAPTCHA", url: response.url };
    }

    const text = await response.text();

    // 1. Parse the total citation count.
    const match = text.match(/class="gsc_rsb_std">(\d+)</);

    // 2. Safe parsing: split the page by paper table rows (tr) to avoid
    //    regex matching across rows and producing misaligned data.
    const rows = text.split('<tr class="gsc_a_tr">').slice(1);
    let currentPapersMap = {};
    let count = 0;

    for (let row of rows) {
      if (count >= 15) break; // Look at the first 15 papers.

      // Extract the title.
      const titleMatch = row.match(/class="gsc_a_at">([^<]+)<\/a>/);
      if (!titleMatch) continue;
      const title = titleMatch[1].trim();

      // Extract the citation number (default to 0 if the paper has none or no match).
      const citeMatch = row.match(/class="gsc_a_ac[^>]*>(\d*)</);
      const citeCount = (citeMatch && citeMatch[1]) ? parseInt(citeMatch[1]) : 0;

      currentPapersMap[title] = citeCount;
      count++;
    }

    if (match && match[1]) {
      const totalCount = match[1];

      // Compare against the previously saved snapshot to detect new citations.
      const localData = await chrome.storage.local.get(['savedPapersMap', 'newPapers']);
      let newPapersList = [];

      if (localData.savedPapersMap) {
        for (let title in currentPapersMap) {
          const currentVal = currentPapersMap[title];
          const oldVal = localData.savedPapersMap[title];

          if (oldVal === undefined) {
            // Newly listed paper.
            if (currentVal > 0) {
              newPapersList.push({ title: title, diff: currentVal });
            }
          } else if (currentVal > oldVal) {
            // Existing paper gained citations.
            newPapersList.push({ title: title, diff: (currentVal - oldVal) });
          }
        }
      }

      // Persistence: if this run found new citations, update the list; otherwise
      // keep the last recorded list so it is not overwritten with empty data.
      let finalNewPapers = newPapersList.length > 0 ? newPapersList : (localData.newPapers || []);

      chrome.storage.local.set({
        citationCount: totalCount,
        lastRefreshTime: Date.now(),
        savedPapersMap: currentPapersMap,
        newPapers: finalNewPapers
      });

      chrome.action.setBadgeText({ text: totalCount });
      chrome.action.setBadgeBackgroundColor({ color: [0, 0, 0, 0] }); // transparent — no pill
      if (chrome.action.setBadgeTextColor) {
        chrome.action.setBadgeTextColor({ color: "#4A6B82" }); // thin morandi deep-blue number
      }
      return { success: true, count: totalCount };
    }
    return { success: false, error: "Err" };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "GET_DATA") { fetchCitations().then(sendResponse); return true; }
});

chrome.alarms.create("checkUpdate", { periodInMinutes: 360 });
chrome.alarms.onAlarm.addListener(fetchCitations);
chrome.runtime.onInstalled.addListener(fetchCitations);
