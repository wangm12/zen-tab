# Atmosphere + object surfaces

Date: 2026-09-08  
Surface: Zen Tab side panel only  
Status: draft for review

## Goal

Make the side panel feel less like a settings list without turning it into an Oh My Tab new-tab canvas.

Two layers:

1. **Atmosphere** — one quiet particle field behind the whole panel.
2. **Objects** — Chrome tab groups and bookmark folders become colored surfaces with a favicon stack. Search becomes a stage, not a 38px filter chip.

Tab rows stay rows. Density for 100+ tabs stays.

## Non-goals

- New-tab override, pixel clock, burning clock, garden, Pixi, GSAP.
- A particle canvas on every tab row.
- Five-column bookmark grid.
- Search-engine picker / Bing suggest.
- Changing stash rows into cards.

## Architecture

```
App shell
  AtmosphereCanvas          // 1 live 2d canvas, pointer-events: none
  chrome (search, nav, lists)
    GroupRow surface        // CSS wash + cached static dot texture
    BookmarkFolder surface  // same recipe, color from folder id
    tab / bookmark rows     // unchanged list treatment
```

Shared pure helpers live in `src/shared/`:

| Helper | Job |
|---|---|
| `sampleParticleCell(color, seed, x, y)` | Deterministic cell opacity / offset for tests |
| `groupSurfaceColor(chromeColor)` | Map Chrome group color → wash + dot color |
| `folderSurfaceColor(folderId)` | Stable HSL from id hash, saturation capped |
| `pickFaviconStack(icons, limit = 3)` | First 3 non-empty favicon URLs |

The live canvas is the only `requestAnimationFrame` consumer.

## 1. Atmosphere

One canvas, absolutely filled behind `.app-shell`, `aria-hidden`, `pointer-events: none`, `z-index` under chrome.

- Grid pitch: 9px. Paint a **sparse** subset (~120 cells), not a filled lattice.
- Color: `var(--accent)` at 6–12% alpha on dark, 8–14% on light.
- Motion: slow vertical drift + weak pointer attraction. No bursts, no trails.
- DPR cap: `min(devicePixelRatio, 1.5)`.
- Pause when `document.hidden`, `prefers-reduced-motion: reduce`, or the side panel is not visible.
- Default **on**. Appearance setting `atmosphereEnabled` (en + zh) can turn it off. Reduced motion forces off regardless of the setting.

No second live canvas on search. Search gets chrome, not its own rAF.

## 2. Objects

### Search

- Height 44px, radius 12px, `surface` fill, accent-soft inner edge on focus.
- Placeholder and 12px text stay; the box is the stage, not a hero prompt textarea.
- Unified search results stay a list. Do not turn hits into mosaic tiles.

### Tab groups

Replace the 3px rail + transparent 36px row with a 44px surface:

- Background: 12% mix of the Chrome group color over `surface`.
- Cached **static** 9px dot texture for that color (generate once, CSS `background-image`). No per-row canvas.
- Right side: up to 3 overlapping favicons from tabs in the group (16px, -8px overlap). Missing icons omitted; if none, no stack.
- Ungrouped (synthetic) group: muted wash, no rail color, no fake color.

Tab rows under a group stay 46px list rows. Virtualization unchanged.

### Bookmark folders

Same surface recipe as groups.

- Color from `folderSurfaceColor(id)` so it does not jump between renders.
- Favicon stack from descendant bookmark URLs (open-tab favicon when we already have it, else `_favicon` if granted).
- Inbox tray header can use the same surface with a single reserved ink color, not a random hash.

Bookmark URL rows stay rows.

## Settings and motion

- Settings → Appearance: `Atmosphere` toggle, default on.
- `prefers-reduced-motion: reduce`: no drift, static wash + static dots only.
- Existing theme tokens stay. Chartreuse remains the only signal color for selection, focus, and primary actions. Group/folder washes are supporting color, not a second brand.

## Performance budget

- ≤ 1 live canvas.
- Atmosphere paint target: 60fps on a 320×800 panel, or the loop self-throttles to 30fps if a frame exceeds 8ms.
- Group/folder textures: ≤ 9 cached patterns (Chrome colors) + folder hashes reuse the nearest of those 9 if we want a hard cap. Do not allocate a canvas per visible row.
- No new dependencies (`pixi.js`, `gsap`).

## Testing

- `sampleParticleCell` is deterministic for a fixed seed.
- `pickFaviconStack` returns at most 3, skips empty, preserves order.
- `folderSurfaceColor` is stable for the same id and different for two ids.
- Reduced-motion helper reports animation disabled.
- Existing tab/bookmark tests stay green. No screenshot tests required.

## Success

Opening the side panel no longer looks like a blank utility sheet: the field is present, groups and folders read as objects, search is a clear block. A window with 100+ tabs still first-paints from the local snapshot path and scrolls with the existing virtualizer. Turning atmosphere off returns a quieter panel without breaking layout.
