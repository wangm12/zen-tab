# Zen Tab

> A calm, fast workspace for your browser tabs.

[English](README.md) · [简体中文](README.zh-CN.md)

Zen Tab is a Manifest V3 Chrome extension for people who work with many tabs. It keeps the browser organized without taking over: duplicate tabs are handled quickly, project groups are suggested with evidence, and sessions can be stashed and restored when you need them again.

## Preview

![Zen Tab side-panel workspace](docs/screenshots/zen-tab-workspace.png)

![Zen Tab AI project grouping preview](docs/screenshots/zen-tab-project-map.png)

## Highlights

- **Live tab workspace** — Browse windows, native tab groups, and ungrouped tabs from Chrome's side panel.
- **Duplicate guard** — Detect repeated pages using conservative URL normalization. Actions are fast, reversible, and isolated between normal and private windows.
- **Project-aware grouping** — Suggests groups from titles, URL paths, search terms, and optional page context instead of grouping by domain alone.
- **Safe cleanup** — Recommends low-value tabs for review; nothing is closed until you confirm it.
- **Stash and restore** — Save a window, group, or selection locally, close the saved tabs, and restore them later in a new window.
- **Large-session friendly** — Uses event-driven state updates, incremental rendering, bounded AI batches, and no background polling.
- **Keyboard-friendly selection** — Supports multi-selection patterns such as Command/Ctrl-click, Shift-click, and Command/Ctrl+A.

## Privacy and safety

- Tab management works without an AI provider.
- Project analysis starts with tab metadata; page summaries are opt-in and requested only when additional context is needed.
- Local analysis is preferred when available. Groq is optional BYOK: your API key is stored locally and is used only after you choose Groq in Settings.
- AI grouping and cleanup always show a review state. Low-confidence tabs remain unclassified instead of being forced into a group.
- Cleanup uses conservative guardrails for active, pinned, local, audio-playing, and protected pages. If safety cannot be verified, the page is left alone.
- Stashes are stored in `chrome.storage.local`. Zen Tab does not collect full browsing history or enable telemetry by default.

## Install as an unpacked extension

### Requirements

- Chrome 116 or newer
- Node.js and npm for building from source

### Build

```bash
npm install
npm run build
```

### Load in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this project's generated `dist/` directory.
5. Pin Zen Tab if you want quick access, then click its toolbar icon to open the side panel.

After source changes, run `npm run build` again and click **Reload** on the extension card.

## Development

Start the Vite development workflow:

```bash
npm run dev
```

Run the complete quality gate before submitting changes:

```bash
npm run check
```

The quality gate includes:

- TypeScript type checking
- Unit tests
- Production extension build

## Architecture

Zen Tab is built with:

- Manifest V3
- React + Vite + TypeScript
- Chrome `sidePanel`, `tabs`, `tabGroups`, and `storage` APIs
- A service worker as the source of truth for tab state and browser mutations
- Virtualized side-panel rendering for large tab collections
- A provider interface for local and optional cloud AI analysis

## Project status

Zen Tab is currently an active development project. The core side-panel workspace, duplicate handling, stash/restore flow, AI grouping preview, conservative cleanup flow, settings, localization, undo behavior, and performance-oriented state updates are implemented. Chrome Desktop is the supported target for now.
