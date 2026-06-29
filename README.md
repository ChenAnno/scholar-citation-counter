# 🚀 Scholar Rocket

A minimalist Chrome extension that tracks your **Google Scholar** citation count right from your toolbar — and quietly highlights which papers picked up new citations since your last check.

Designed with a calm, Morandi-inspired color palette and an iOS-style slide-up interface.

<p align="center">
  <img src="icons/icon128.png" width="96" alt="Scholar Rocket icon">
</p>

## ✨ Features

- **Live citation badge** — your total citation count sits on the extension icon.
- **New-citation tracker** — see exactly which of your papers gained citations since the last sync.
- **Privacy-friendly** — everything runs locally in your browser. No accounts, no servers, no tracking. Your configuration is stored only in `chrome.storage.local`.
- **One-time setup** — paste your Scholar profile URL on first launch and you're done.
- **Polished UI** — frosted-glass drawers, soft shadows, and a Morandi color scheme.

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
| **Display name** | — | The name shown at the top of the card. |
| **Homepage URL** | — | If set, your display name links to your personal site. |

Click **Save** and Scholar Rocket fetches your stats.

To change any of this later, click the **⚙ gear** in the top-right corner of the popup.

### Where do I find my Scholar profile URL?

Open [Google Scholar](https://scholar.google.com/), sign in, click your profile, and copy the address from the browser bar. The part that matters is `user=XXXXXXXX`.

## 🔄 How syncing works

- Scholar Rocket refreshes automatically in the background every **6 hours**.
- You can refresh manually with **Sync Now** (rate-limited to once per hour to stay polite to Google).
- If Google shows a CAPTCHA, the status line offers a **Verify Identity** link — solve it once and sync again.

## 🗂️ Project Structure

```
scholar-rocket/
├── manifest.json      # Extension manifest (Manifest V3)
├── background.js      # Service worker: fetches & parses Scholar, manages the badge
├── popup.html         # Popup markup + Morandi styling
├── popup.js           # Popup logic: config, settings, new-papers drawer
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
