# Zen Tab - Chrome Web Store Listing Information (商店上架填报资料)

本文档整理了在 **Chrome Web Store 开发者后台** 新建和上架 Zen Tab 时需要填写的全部信息，可以直接复制粘贴使用。

---

## 1. 基本信息 (Store Listing - Product Details)

### 扩展名称 (Item Name)
```text
Zen Tab
```

### 简短说明 (Summary / Short Description)
*(必须 <= 132 字符)*
```text
A calm, fast workspace for your browser tabs. Live side-panel workspace, duplicate guard, and smart session stash.
```

### 详细说明 (Detailed Description)
```text
Zen Tab is a calm, fast workspace for people who work with many browser tabs. It keeps your workspace organized in Chrome's native side panel without getting in your way: duplicate tabs are resolved quickly, projects are grouped cleanly, and sessions can be stashed and restored with zero memory waste.

✨ KEY FEATURES

• ⚡ Live Side-Panel Workspace
Browse open windows, native Chrome tab groups, and ungrouped tabs in a fast, narrow side panel. Switch between Tabs, Stash, and Bookmarks instantly.

• 🛡️ Duplicate Guard
Automatically detects duplicate tabs as soon as URLs are opened. Clean up redundant pages in one click with full undo support.

• 📦 Stash & Restore
Save an entire window, tab group, or selected tabs to local storage. Close them to free up computer memory, and restore them anytime in a new window.

• 🗂️ Project-Aware Grouping
Smartly groups tabs based on titles, domain paths, and search context. Keeps your active projects neatly organized.

• 📥 Bookmark Inbox (Optional)
File inbox tabs into existing bookmark folders and fuzzy-search across your saved pages.

• ⌨️ Keyboard-Friendly
Supports full keyboard navigation, Command/Ctrl-click, Shift-click, and Command/Ctrl+A multi-selection.

🔒 PRIVACY & SAFETY FIRST

• 100% Local-First: All tab stashes and preferences are stored exclusively on your device in chrome.storage.local.
• Zero Tracking: No telemetry, no third-party analytics, and no remote data collection.
• Safe Guardrails: Active audio, pinned tabs, and protected pages are never closed without explicit user confirmation.
• Optional AI: Tab management works completely offline. Optional AI features use your own API key (BYOK) with no middleman servers.

Designed for speed, clarity, and peace of mind.
```

### 分类 (Category)
- **Primary Category**: `Productivity` (生产力工具)

### 语言 (Language)
- `English`

---

## 2. 隐私权规范 (Privacy Practices - 极其重要，审核必填)

### 单一用途说明 (Single Purpose Description)
*(Google 要求说明扩展的核心单一目的)*
```text
Zen Tab provides a calm side-panel workspace for organizing, grouping, deduplicating, and stashing browser tabs locally.
```

### 权限使用说明 (Permission Justifications)
在后台勾选各权限时，填入以下理由：

| 权限 (Permission) | 用途说明 (Justification) |
| :--- | :--- |
| **`tabs`** | Required to display open tabs in the side panel, allow switching between tabs, and close duplicate tabs upon user confirmation. |
| **`tabGroups`** | Required to organize open tabs into native Chrome tab groups within the side panel. |
| **`sidePanel`** | Required to render the main Zen Tab interface inside Chrome's native side panel. |
| **`storage`** | Required to persist user preferences, workspace layout, and stashed tab sessions locally on device. |
| **`alarms`** | Required to schedule periodic local memory cleanup checks without running persistent background CPU loops. |
| **`sessions`** | Required to safely recover recently closed or stashed tab sessions. |

### 数据使用声明 (Data Usage)
- **Does this extension collect user data?** -> 选择 **No**（绝不收集或向外部传输任何个人数据与浏览历史）。
- **Certification** -> 勾选所有合规承诺复选框。

### 隐私政策链接 (Privacy Policy URL)
```text
https://wangm12.github.io/zen-tab/privacy.html
```
*(或者使用仓库代码链接: https://raw.githubusercontent.com/wangm12/zen-tab/main/docs/privacy.html)*

---

## 3. 图片与视觉资源 (Graphic Assets)

| 资源名称 | 尺寸要求 | 文件位置 |
| :--- | :--- | :--- |
| **Store Icon (商店图标)** | 128 x 128 px | `public/icons/zen-tab-128.png` |
| **Screenshot 1 (主截图)** | 1280 x 800 px | `docs/store/screenshot-1280x800.png` |
| **Small Promo Tile (小宣传图 - 可选)** | 440 x 280 px | `docs/store/promo-440x280.png` |

---

## 4. 安装包上传 (Package Upload)

- 打包生成的文件：`dist/zen-tab-0.1.0.zip`
- 直接在后台拖拽此 zip 文件上传即可。
