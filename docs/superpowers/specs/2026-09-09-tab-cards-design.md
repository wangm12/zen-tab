# Tab cards + sticky group chrome

Date: 2026-09-09  
Surface: Zen Tab side panel, **Tabs** section only  
Status: approved in conversation; waiting on spec review  
Supersedes: `2026-09-08-atmosphere-objects-design.md` §2 “Tab rows under a group stay 46px list rows”

## Goal

Opening the Tabs section must not look like the old flat list. Every open tab is a small card. The group that owns the visible cards stays on screen while scrolling. Atmosphere is a visible lining in the gaps, not the product.

Chosen intensity: **B** (open and it reads). Chosen tab treatment: **3** (each tab is a card). Bookmarks and stashes are out of scope this round.

## Non-goals

- New-tab override, pixel clock, garden, Pixi, GSAP.
- A canvas or rAF loop on each tab card.
- Multi-column / mosaic tab grid.
- Changing bookmark URL rows or stash rows into cards.
- Restoring the 3px DOM `.group-rail` span.
- Restoring `.app-shell > :not(.atmosphere-canvas)` stacking.
- Changing `store.load` local-snapshot first paint.

## Architecture

```
App shell
  AtmosphereCanvas          // still the only live 2d canvas
  Tabs section
    tree-scroller
      StickyGroupHeader     // overlay clone; NOT CSS sticky on virtual rows
      tree-canvas           // existing virtualizer
        GroupRow            // 44px object (source of truth for the clone)
        TabCard             // 48px min card; was TabRow
```

The current virtualizer absolutely positions `.tree-position` with `transform: translateY(...)`. CSS `position: sticky` on a group row **does not work** in that tree. Sticky chrome is a separate header above the canvas, driven by a pure helper.

### New helper

`src/shared/atmosphere.ts` (keep with the other surface helpers):

```ts
resolveStickyGroup<T extends { kind: string }>(
  rows: readonly T[],
  firstVisibleIndex: number,
): T | null
```

Rules:

- `firstVisibleIndex < 0` or `rows` empty → `null`.
- Walk backward from `firstVisibleIndex` inclusive to `0`. Return the nearest `kind === 'group'` row.
- If none, `null`.

The scroller uses that group as the overlay when the real group header’s bottom is above the scroller’s top (header has scrolled away). If the real header is still fully visible, render no overlay (avoid a double header).

`TabRow` / tree tab variant gains `groupColor: GroupColor | 'none'`. Synthetic ungrouped tabs use `'none'`.

## 1. Tab cards

Replace the hairline-divided `.tab-row` with a card. Still one column. Still `@tanstack/react-virtual`.

| Token | Value |
|---|---|
| min-height | 48px |
| vertical margin | 3px 0 |
| radius | 10px |
| fill | `var(--surface)` |
| border | `1px solid var(--border-soft)` |
| hover | `var(--surface-2)` |
| active / selected | existing chartreuse `accent-soft` fill + accent outline |
| virtualizer estimate | **54** for tab rows (group estimate stays **52**) |

Chrome, not content:

- Checkbox, favicon, title, host, ⋯ stay. No larger type, no extra decorative line.
- Grouped card (`groupColor !== 'none'`): `box-shadow: inset 3px 0 0 var(--group-dot)` using `groupSurfaceColor(color).dot`.
- Ungrouped (`'none'`): ink border only. No fake Chrome color.

Drop indicators, drag opacity, selection mode, and the ⋯ menu keep current behavior; restyle only the row chrome.

## 2. Group objects (already shipped, visibility pass)

- Keep 44px shell, static SVG dots, favicon stack, no rail span.
- **Ungrouped** wash must read on light: `color-mix(in oklch, var(--text-dim) 20%, var(--surface))` plus the existing none-dot texture. Do not use the current `surface-2` 80% mix (≈2% lightness delta).
- Colored Chrome groups keep `groupSurfaceColor`; do not invent a second brand. Chartreuse stays selection / focus / primary only.
- Overlay sticky header reuses `GroupRow` visuals (same wash, count, stack). It is display + collapse/stash/menu affordances, not a second data model. Clicks on the overlay toggle/stash the same group as the source row.

## 3. Atmosphere (support)

Still one canvas, seed 3, pitch 9, ~120 cells, DPR cap 1.5, pause on hidden / reduced motion / invisible / `atmosphereEnabled === false`.

Paint alpha (replace the current 0.09 / 0.12):

- Dark: **0.14**
- Light: **0.22**

Field shows in the gaps between cards. No second canvas. Turning atmosphere off does not collapse card or sticky layout.

## Performance

- ≤ 1 live `requestAnimationFrame` canvas.
- 100+ tabs: virtualizer stays; first paint still `readLocalSnapshot` then worker.
- Sticky overlay is one extra group chrome node, not a second list.
- No new dependencies.

## Testing

- `resolveStickyGroup`: empty → null; first visible is a group → that group; first visible is a tab → nearest previous group; tabs before any group → null.
- Existing `atmosphere.test.ts` cases stay green (cell target, motion gate, stacks).
- `context-menu.test.ts` and tab-tree related tests stay green.
- Typecheck + `npx vitest run`. No screenshot tests.

## Success

On a light window of ~95 ungrouped tabs, after reload:

1. The list is clearly cards, not hairline rows.
2. Scrolling to the active tab still shows **Ungrouped** (or the owning Chrome group) at the top of the scroller.
3. Gaps show a faint accent field. Reduce Motion freezes it; Atmosphere off removes the canvas only.
4. A colored Chrome group’s cards carry that group’s inset ink.
5. Bookmarks / stashes look as they do today.

## Files

| File | Change |
|---|---|
| `src/shared/atmosphere.ts` + `.test.ts` | `resolveStickyGroup` |
| `src/sidepanel/AtmosphereCanvas.tsx` | light/dark alpha 0.22 / 0.14 |
| `src/sidepanel/TabTree.tsx` | tab `groupColor`; estimate 54; sticky overlay |
| `src/sidepanel/styles.css` | card chrome; ungrouped 20% wash; sticky header |
