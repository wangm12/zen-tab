# Zen Tab

> A calm, fast workspace for your browser tabs.

[English](README.md) · [简体中文](README.zh-CN.md)

Zen Tab is a Manifest V3 Chrome extension designed for people who work with many browser tabs. It transforms Chrome's native side panel into a focused, organized command center—helping you manage multi-window tabs, detect and close duplicates, file bookmarks, and stash heavy project sessions to free up memory, all without changing your browsing habits.

---

## Preview

<p align="center">
  <img src="docs/screenshots/zen-tab-workspace.png" alt="Zen Tab side-panel workspace" width="380" />
</p>

---

## ✨ Highlights & Features

### ⚡ Live Tab Workspace
- **Multi-Window Navigation**: Switch between Window 1, Window 2, and Window 3 with clear tab counters without flipping desktop windows.
- **Native Group Support**: Integrates directly with Chrome's native tab groups. Drag, collapse, and color-code groups right from the side panel.
- **Instant Search (`⌘K` / `Ctrl+K`)**: Fuzzy-search across active tabs, stashed sessions, and bookmarks in real time.

### 🛡️ Duplicate Tab Guard
- **Early Detection**: Identifies repeated URLs immediately as tabs open.
- **Reversible Actions**: One-click cleanup of duplicate pages with complete undo support.
- **Window Isolation**: Strict separation between normal and incognito browsing sessions.

### 📦 Stash & Restore Sessions
- **Free Up Memory**: Save an entire window, tab group, or multi-selected tabs to local storage and close them.
- **Resume Anytime**: Restore your stashed project in a fresh window whenever you're ready to pick it up again.
- **Zero Background Polling**: Uses event-driven state updates to maintain performance during large sessions.

### 📥 Bookmark Inbox & Smart Filing
- **Visual Folder Navigation**: Fast color-coded pills for your bookmark folders (`Work`, `Research`, `Reading`, etc.).
- **Filing Inbox**: Quickly file unorganized tabs into bookmark folders on the fly.
- **Bookmark Health Check**: Review duplicates, broken links, and unfiled items before deleting.

### 🎨 Atmosphere & Focus
- **Subtle Background Canvas**: Adaptive dynamic visual texture that responds softly to your workspace.
- **Dark & Light Mode**: Seamless adaptation with high-contrast accessibility.
- **Keyboard-First Selection**: Multi-select tabs effortlessly with `Command/Ctrl-click`, `Shift-click`, and `Command/Ctrl+A`.

---

## 🔒 Privacy & Safety

Zen Tab is built on an uncompromising local-first philosophy:

- **100% Local-First by Default**: Tab management, duplicate detection, and session stashing require **no internet connection** and **no external servers**.
- **Zero Telemetry**: No tracking, no user profiling, and no analytics scripts.
- **Safe Guardrails**: Active audio-playing tabs, pinned tabs, and protected system pages are never closed automatically.
- **Optional BYOK AI**: Advanced semantic grouping is purely optional and runs using your own API key (Bring Your Own Key) directly against Groq. Keys are stored strictly on device in `chrome.storage.local`.

---

## ⌨️ Keyboard Shortcuts

| Shortcut (Mac) | Shortcut (Windows/Linux) | Action |
| :--- | :--- | :--- |
| `⌘ + Shift + Space` | `Ctrl + Shift + Space` | Open / Close Zen Tab Side Panel |
| `⌘ + K` | `Ctrl + K` | Focus Global Fuzzy Search |
| `⌘ + Click` | `Ctrl + Click` | Toggle multi-select individual tabs |
| `Shift + Click` | `Shift + Click` | Range select tabs |
| `⌘ + A` | `Ctrl + A` | Select all tabs in current group/window |

---

## 📦 Installation

### From Chrome Web Store
> *Currently under review by the Chrome Web Store team. Direct store link will be updated here upon public availability.*

### Install from Source (Developer Mode)

1. **Clone the repository**:
   ```bash
   git clone https://github.com/wangm12/zen-tab.git
   cd zen-tab
   ```
2. **Install dependencies and build**:
   ```bash
   npm install
   npm run build
   ```
3. **Load unpacked in Chrome**:
   - Open `chrome://extensions` in Chrome.
   - Enable **Developer mode** in the top-right corner.
   - Click **Load unpacked** and select the `dist/` directory inside `zen-tab`.
   - Click the Zen Tab toolbar icon or press `⌘ + Shift + Space` to open the side panel!

---

## 🛠️ Development & Quality Gate

```bash
# Start local Vite development server
npm run dev

# Run comprehensive quality checks (TypeScript + 350 Vitest tests + Build)
npm run check

# Package extension zip for Chrome Web Store
npm run package
```

---

## 🏗️ Architecture & Tech Stack

- **Platform**: Chrome Extensions Manifest V3
- **Frontend**: React 18, TypeScript 5.7, Tailwind CSS 3.4
- **Build System**: Vite 6, `@crxjs/vite-plugin`
- **Testing**: Vitest 2.1 (350+ unit tests)
- **State Management**: Zustand 5 + Service Worker Message Bus
- **Performance**: `@tanstack/react-virtual` for virtualized rendering of large tab collections
