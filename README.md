# 🚀 Scholar Rocket

A minimalist Chrome extension that tracks your **Google Scholar** citation count right from your toolbar — and quietly highlights which papers picked up new citations since your last check.

Designed with a calm, Morandi-inspired color palette and an iOS-style slide-up interface.

<p align="center">
  <img src="icons/icon128.png" width="96" alt="Scholar Rocket icon">
</p>

## ✨ Features

- **Live citation badge** — your total citation count sits on the extension icon and turns green when new citations are waiting.
- **New citations** — see exactly which papers gained citations, with before → after counts. Click a paper to see who cited it, newest first. The list stays for a day after you first open it, or clear it yourself with **Clear now**.
- **Citation growth** — the 📈 button (top left of the card) opens a curve of your total citations, recorded every day and growing as time passes (30D / 1Y / All). Before recording began, it starts from Scholar's year-end totals.
- **At a glance** — your total citations, with a `+N` for what's new, plus Homepage and Scholar buttons.
- **Tap your name to sync** — your display name at the top is the sync button. Set it to an emoji like 🚀 and it flies while syncing.
- **Privacy-friendly** — everything runs locally in your browser. No accounts, no servers, no tracking. Your configuration is stored only in `chrome.storage.local`.
- **One-time setup** — paste your Scholar profile URL on first launch and you're done.
- **Polished UI** — slide-up sheets, soft shadows, a Morandi color scheme, and automatic dark mode.

## 📦 Installation

Since this extension is not on the Chrome Web Store, load it manually (developer mode):

1. **Download** this repository (green **Code → Download ZIP**, then unzip) or clone it:
   ```bash
   git clone https://github.com/<your-username>/scholar-rocket.git
   ```
2. Open Chrome and go to `chrome://extensions/`.
3. Toggle **Developer mode** on (top-right corner).
4. Click **Load unpacked** and select the project folder (the one containing `manifest.json`).
5. The 🚀 icon appears in your toolbar. Pin it for quick access.

> Works in any Chromium-based browser (Chrome, Edge, Brave, Arc) that supports Manifest V3.

## ⚙️ First-time Setup

On first launch the popup opens the **Settings** drawer automatically. Fill in:

| Field | Required | Description |
|-------|----------|-------------|
| **Google Scholar profile** | ✅ | Paste your full profile URL, e.g. `https://scholar.google.com/citations?user=XXXXXXXX`. You can also paste just the `user` ID. The language (`hl`) and domain (e.g. `scholar.google.com.hk`) are picked up automatically from the URL. |
| **Display name** | — | The name shown at the top of the card. Defaults to the name on your Scholar profile. |
| **Homepage URL** | — | If set, your display name links to your personal site. |

Click **Save** and Scholar Rocket fetches your stats.

To change any of this later, click the **⚙** button in the top-right corner of the card.

### Where do I find my Scholar profile URL?

Open [Google Scholar](https://scholar.google.com/), sign in, click your profile, and copy the address from the browser bar. The part that matters is `user=XXXXXXXX`.

## 🆕 How "New citations" works

The **New citations** list shows what changed since your counts were last cleared:

1. The first sync records your current citation counts as the starting point.
2. Every later sync compares against that starting point, so increases add up until you look.
3. Opening **New citations** lists each paper that gained citations (and papers newly added to your profile). The list then **stays for 24 hours from when you first opened it**, so you can come back to it.
4. Click **Clear now** to clear it right away; otherwise it clears itself a day later and the counts you looked at become the new starting point.
5. Citations that arrive after you opened the list are marked with a dot and stay until you have looked at them.

The toolbar badge turns green while there are citations you haven't looked at yet. The `+N` next to your total stays until the list is cleared.

## 📈 How the growth curve works

- Every successful sync saves that day's total citations (a later sync on the same day replaces it), so the curve gains one point per day.
- For the time before the extension started recording, the curve begins with your year-end totals from Scholar's citations-per-year chart.
- Once there is a week of daily data, switch between **30D**, **1Y** and **All**; shorter ranges zoom in so day-to-day growth is visible.

## 🔄 How syncing works

- Scholar Rocket refreshes automatically in the background every **6 hours**, and when you open the popup if the data is older than that.
- Each sync reads every page of your profile (up to 1,000 papers), so a paper moving up the citation ranking is never mistaken for new citations.
- You can sync manually by tapping your **display name** at the top of the popup (once per hour to stay polite to Google); hover it to see when the last sync was.
- If Google shows a CAPTCHA, a **Verify ↗** chip appears under your name — click it, solve the CAPTCHA, then tap your name to retry.

## 🗂️ Project Structure

```
scholar-rocket/
├── manifest.json      # Extension manifest (Manifest V3)
├── background.js      # Service worker: fetches & parses Scholar, schedules syncs
├── shared.js          # Used by both: URLs, "what's new" comparison, badge
├── popup.html         # Popup markup + Morandi styling (light & dark)
├── popup.js           # Popup logic: settings, sync status, New citations sheet
├── icons/             # Toolbar and store icons
│   ├── icon16.png
│   ├── icon48.png
│   ├── icon128.png
│   └── rocket.png
└── README.md
```

## 🔒 Privacy

Scholar Rocket only requests permission to read your **own public Google Scholar page**. It stores your settings and citation snapshots locally and sends nothing to any third party.

## 🎨 Color Palette

| Token | Hex |
|-------|-----|
| Morandi Blue | `#9BB7D4` |
| Morandi Deep Blue | `#4A6B82` |
| Morandi Grey | `#A1A9AD` |
| Morandi Green | `#8FBA95` |
| Background | `#F4F4F2` |

## 🤝 Contributing

Issues and pull requests are welcome. Because Scholar's HTML can change, the parsing logic in `background.js` is the most likely thing to need maintenance.

## 📄 License

Released under the [MIT License](LICENSE).
