# Tab list drag: dnd-kit replace

Date: 2026-09-10  
Surface: Zen Tab side panel — Tabs list, plus Stash / Bookmarks drop targets  
Status: implemented (waiting on Chrome Reload verification)  
Replaces: hand-rolled HTML5 `draggable` / `setDragImage` / `text/tab-id` in `TabTree.tsx`

## Goal

Dragging a tab must feel like a sortable list: the source slot closes, other cards slide open a gap, a small chip follows the pointer. Drop commits once to Chrome. The virtualizer, sticky group chrome, and atmosphere stay.

Chosen engine: **@dnd-kit** (new React API: `DragDropProvider` + `useSortable` / `useDroppable` + `move()`). Not hello-pangea, Motion Reorder, FormKit, or Pragmatic.

## Non-goals

- A drop-in `<SortableList>` that replaces `TabTree`.
- Live `chrome.tabs.move` on dragover.
- Multi-tab drag, keyboard drag.
- Changing bookmark or stash **row** chrome.
- New-tab canvas, Pixi, GSAP.
- Replacing `@tanstack/react-virtual`.
- Mid-drag section switch to Bookmarks (HTML5 could survive `TabTree` unmount; dnd-kit cannot).

## Interaction

| Gesture | Result |
|---|---|
| Drag tab over another tab | Optimistic splice: cards slide; gap is the drop. Chip overlay, not a full-card ghost. No line painted on titles. |
| Drop on a tab gap | `MOVE_TAB` using the neighbor the user saw. Chrome strip index decides group membership (same as today). |
| Drop on a real group header (or its sticky clone) | `GROUP_TAB` with that `groupId`. |
| Drop on Ungrouped header (or its sticky clone) | `GROUP_TAB` `-1` then `MOVE_TAB` to the first ungrouped index (or end if none). |
| Drop on bottom-nav Stash | Existing `stashSelection` for that one tab. |
| Drop on bottom-nav Bookmarks | Existing `fileDroppedTab` with no folder (inbox). Do **not** switch section during the drag. |
| Drop on a bookmark folder or inbox (already on Bookmarks) | `fileDroppedTab` with that folder / inbox. |
| Cancel / same index / invalid pin slot | No message. Visual rows snap back to the snapshot. |
| Click, shift/cmd select, `⋯` | Still work. Pointer must move **8px** before drag starts. |
| Search box has text | Sortable disabled. No reorder while the list is filtered. |
| `prefers-reduced-motion` | No slide or drop animation. Commit behavior unchanged. |

Group headers are not draggable. Window chips and AudioBar are not drop targets.

## Architecture

```
App
  DragDropProvider          // one session for list + nav + bookmark folders
    TabTree                 // virtualizer + sortable tab rows
    bottom-nav Stash        // droppable
    bottom-nav Bookmarks    // droppable
    BookmarkList folders    // droppable when that section is mounted
```

Chrome remains the source of truth. During a drag, `TabTree` holds a local `visualRows` copy and calls `move()` on tab-over-tab. Incoming snapshot updates do not rebuild `visualRows` until the drag ends. After drop or cancel, snapshot rows win again.

### Packages

Install (React 18 compatible latest):

- `@dnd-kit/react`
- `@dnd-kit/helpers`
- `@dnd-kit/dom` (peer)

Use `Feedback` mode `'none'` and a React chip overlay (favicon + title, existing `.tab-drag-preview` look). Do not clone the full 48px card. Do not use HTML5 `setDragImage`.

Use dnd-kit auto-scroll on `.tree-scroller`. Delete `scrollWhileDragging`.

### IDs

Stable string ids, one namespace:

| Id | Role |
|---|---|
| `tab-${tabId}` | sortable |
| `group-${groupId}` | droppable, real Chrome group |
| `ungrouped-${windowId}` | droppable, synthetic Ungrouped |
| `sticky-group-${groupId}` | droppable, same action as `group-${groupId}` |
| `sticky-ungrouped-${windowId}` | droppable, same action as `ungrouped-${windowId}` |
| `nav-stash` | droppable |
| `nav-bookmarks` | droppable |
| `bookmark-folder-${folderId}` | droppable |
| `bookmark-inbox` | droppable |

Sticky overlay must not reuse the in-list droppable id. The resolver canonicalizes `sticky-*` to the same action as the live header.

### Virtualizer

`.tree-position` is still `position: absolute`. Stop using `transform: translateY(...)` — it fights dnd-kit’s transform. Position with `top: ${virtualRow.start}px` only.

`.tree-canvas.reorganizing` transitions `top`, not `transform`.

Estimates stay **52** group / **54** tab. Overscan 10. Sticky helper and atmosphere unchanged.

### Delete

- `draggable` on tab rows
- `setDragImage` + DOM chip appended to `document.body`
- `dataTransfer` `text/tab-id` for tab → Stash / Bookmarks
- `.tab-row.drop-before` / `drop-after` lines
- `.drop-start-bar` / `.drop-end-bar`
- HTML5 `onDragOver` / `onDrop` on TabTree, Stash nav, Bookmarks nav, bookmark folders

`fileDroppedTab()` stays. `bookmarkNavTabDragOver()` (HTML5 type check) goes; tests that only exist for that helper go with it.

## Commit helper

New module `src/shared/tab-dnd.ts` (pure, no React, no chrome):

```ts
parseTabDragId(id: string): DragSurface | null
formatTabDragId(surface: DragSurface): string

resolveTabDragEnd(input: {
  dragged: { tabId: number; index: number; pinned: boolean; groupId: number };
  over: DragSurface | null;
  placement?: 'before' | 'after';   // required when over.kind === 'tab'
  windowId: number;
  tabs: readonly { tabId: number; index: number; groupId: number; pinned: boolean }[];
}): TabDragEndResult
```

`TabDragEndResult`:

- `{ type: 'none' }`
- `{ type: 'move'; tabId; windowId; index }` → `MOVE_TAB`
- `{ type: 'group'; tabId; groupId }` → `GROUP_TAB` (real group only)
- `{ type: 'ungroup'; tabId }` → `GROUP_TAB` `-1` only (already at ungrouped start)
- `{ type: 'ungroup-and-move'; tabId; windowId; index }` → `GROUP_TAB` `-1` then `MOVE_TAB`
- `{ type: 'stash'; tabId }`
- `{ type: 'file'; tabId; folderId?: string }`

Rules:

- `over == null` or same tab → `none`.
- Over tab: `resolveTabMoveIndex(dragged.index, { type: placement, targetIndex: overTab.index }, { pinnedCount, tabCount, pinned })`. Null → `none`. Else `move`.
- Over real group / sticky group: `group`, unless `dragged.groupId` is already that group → `none`.
- Over Ungrouped / sticky Ungrouped: `ungroup-and-move` with `resolveUngroupedInsertIndex` then `resolveTabMoveIndex` (`end` if no ungrouped tabs). If the tab is already ungrouped and the move index is null → `none`.
- Over `nav-stash` → `stash`.
- Over `nav-bookmarks` or `bookmark-inbox` → `file` without folder.
- Over `bookmark-folder-*` → `file` with that id.
- Unpinned tabs never get a destination inside the pinned prefix (`resolveTabMoveIndex` already clamps). Optimistic `move()` must not run when that helper would return null.

`onDragEnd` lives on the App `DragDropProvider`. It reads dnd-kit `source` / `over` (and before/after when `over` is a tab) — not a parallel copy of `visualRows`. `visualRows` is display-only so the gap matches that over target.

App maps the result to existing `onAction` / `stashSelection` / `fileDroppedTab`. No new worker messages.

## Error handling

- Drag cancel: drop `visualRows`, show snapshot rows.
- `MOVE_TAB` / `GROUP_TAB` failure: next snapshot overwrites the list. No extra toast beyond what `action()` already shows.
- Missing tab (closed mid-drag): `none`, clear drag.

## Testing

`src/shared/tab-dnd.test.ts`:

- parse / format round-trip for every surface kind, including sticky aliases.
- tab before / after another tab → `move` with the same indexes `resolveTabMoveIndex` already covers.
- drop on self / null over → `none`.
- drop on real group → `group`.
- drop on Ungrouped → `ungroup-and-move`; already-first ungrouped → `none`.
- unpinned toward index `0` when pins exist → clamped or `none`, never pin-zone.
- stash / bookmark-nav / inbox / folder → `stash` / `file`.

Keep existing `tab-ops.test.ts`. Update or remove `file-dropped-tab.test.ts` cases that only assert HTML5 `text/tab-id`.

Gate: `npx vitest run src/shared/tab-dnd.test.ts src/shared/tab-ops.test.ts src/sidepanel/file-dropped-tab.test.ts` plus `npm run typecheck` and `npm run build`. No screenshot tests. Live side panel still needs a Reload after `dist/` writes.

## Success

On a window with grouped tabs plus a long Ungrouped list, after Reload:

1. Dragging a tab opens a gap; the source is not still sitting at the old index; titles are not covered by a full-row ghost.
2. Drop between two cards leaves the tab there after Chrome snapshot lands.
3. Drop on a colored group header joins that group. Drop on Ungrouped ungroups and inserts at the ungrouped start.
4. Drop on Stash archives that tab. Drop on Bookmarks files to inbox without tearing the drag by switching section.
5. Click / select / `⋯` still work. Search disables reorder.

## Files

| File | Change |
|---|---|
| `package.json` | dnd-kit deps |
| `src/shared/tab-dnd.ts` + `.test.ts` | ids + `resolveTabDragEnd` |
| `src/sidepanel/App.tsx` | `DragDropProvider`; nav droppables; onDragEnd routing |
| `src/sidepanel/TabTree.tsx` | sortable tabs; local `visualRows`; chip overlay; `top` positioning; strip HTML5 |
| `src/sidepanel/BookmarkList.tsx` | folder / inbox droppables |
| `src/sidepanel/file-dropped-tab.ts` + `.test.ts` | remove HTML5 nav helper |
| `src/sidepanel/styles.css` | drop bars/lines off; chip overlay; `top` transition |
