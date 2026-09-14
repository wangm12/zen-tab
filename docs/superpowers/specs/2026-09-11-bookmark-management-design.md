# Bookmark management: Chrome-parity tree + review-then-write

Date: 2026-09-11  
Surface: Zen Tab side panel — Bookmarks section  
Status: revised after subagent review; waiting on spec re-review  
Reference: [rico-bookmark-manager](https://github.com/ricocc/rico-bookmark-manager) (workflow only: analyze → report → human confirm → write). Not its navigation site, themes, or taxonomy.

## Goal

Help manage Chrome bookmarks from the side panel without replacing `chrome://bookmarks`.

The tree uses the same operations Chrome does (create/rename folder, edit title and URL, delete, drag folders and URLs to move or reorder). Organizing actions — Inbox filing, duplicate cleanup, export — always show a preview sheet. Nothing in those sheets writes until the user confirms. Chrome’s bookmark tree remains the only source of truth.

## Non-goals

- Replacing Chrome’s bookmark manager, bookmark bar, or sync UI.
- A Rico navigation site, theme pack, or `AI / 前端 / 设计` category tree.
- Tags, or any parallel bookmark store besides optional page summaries already in `chrome.storage.local`.
- Dead-link scanning (later, opt-in, report-only; not this spec).
- Bookmark card grid, two-pane manager, cut/copy/paste, Reading List.
- Creating a bookmark by typing a URL into the side panel (new bookmarks still come from tab drag / `CREATE_BOOKMARKS`).
- Auto-filing on `bookmarks.onCreated` (end state; removed in phase 2).
- An in-list bookmark search hit list. Non-empty unified search still unmounts `BookmarkList` and shows `UnifiedSearch` (`App.tsx`). Chips only apply when search is empty.
- Calling `chrome.bookmarks.*` from the side panel. All bookmark writes go through the service worker.

## Behavior change

Today `handleCreatedBookmark` calls `fileBookmarks` immediately when the suggestion is high-confidence and the side panel is open (`service-worker.ts`). That path is removed in phase 2. Every new Inbox bookmark only emits `BOOKMARK_FILING_SUGGESTED` (or stores it in session if the panel is closed). Filing happens through the Inbox review sheet.

The auto-file toast strings are hardcoded in the service worker, not `i18n.ts`. Removing them is an SW edit, not an i18n key deletion.

## Architecture

```
chrome.bookmarks                         // only tree of record
        │
        ▼
Service Worker  (isMutationMessage queue)
  GET_BOOKMARK_TREE
  CREATE_BOOKMARKS                       // tab drop / nav-bookmarks / fileDroppedTab
  FILE_BOOKMARKS                         // existing same-folderId multi-move; not tab drop
  MOVE_BOOKMARK                          // tree drag (one node, parent + index)
  UPDATE_BOOKMARK / REMOVE_BOOKMARK
  CREATE_BOOKMARK_FOLDER / REMOVE_BOOKMARK_FOLDER
  APPLY_BOOKMARK_FILING                  // preview plan only
  APPLY_BOOKMARK_DEDUP                   // unchanged
  OPEN_BOOKMARK_URLS                     // open / open-all; exemptFromDuplicateGuard
        │
        ▼
BookmarkList  (mounted only when search is empty)
  forest by Chrome child index
  chips (All / Inbox / Duplicates)
  preview sheets
```

No new taxonomy tables. Suggestions reuse `suggestBookmarkFolder` (same-host, project memory, folder-name tokens).

`eligibleFolders` stays as today: non-special, non-inbox folders. Bookmarks bar is **not** in that list. Inbox review uses the same list unless this spec is later amended. Do not “fix” that in passing.

### Folder identity

`flattenBookmarkTree` must attach enough data to implement Mobile / Managed / Inbox without hardcoding `'1'|'2'|'3'`.

On every `BookmarkFolderRecord` and `BookmarkRecord`:

```ts
folderKind: 'bar' | 'other' | 'mobile' | 'managed' | 'folder'
index: number
unmodifiable?: 'managed'
```

`folderKind` comes from the same `rootKind` / `folderType` / localized title logic already in flatten, plus `'managed'` when `folderType === 'managed'` or `unmodifiable === 'managed'`. Copy Chrome’s `unmodifiable` onto every node, not only the managed root.

Helpers (pure, tested):

- `otherBookmarksRootId(folders)` — Other Bookmarks id via `folderKind === 'other'`.
- `canMutateBookmarkNode(node)` — false for special roots (`bar|other|mobile|managed`) and any node with `unmodifiable === 'managed'`.
- Inbox tray source of truth remains `inboxBookmarks()`. Do not simplify to `bookmark.isInbox` or `folder.isInbox`. Mobile loose URLs are not in the tray (`folderKind === 'mobile'` on the parent).

Forest: skip only `folderKind === 'other'` as a row (Inbox + its child folders stay as today). Show `bar`, `mobile`, `managed`, and normal folders. Managed descendants inherit read-only from `unmodifiable` or an ancestor `managed` root.

Service worker mutates using the **live** Chrome node (`bookmarks.get`), not stored ids. Reject if the live node is a special root or `unmodifiable === 'managed'`.

### Write rules

| Action | When it writes | Message |
|---|---|---|
| Edit title / URL | Immediately | `UPDATE_BOOKMARK` |
| Drag move or reorder (URL or folder) | Immediately | `MOVE_BOOKMARK` |
| Delete one bookmark | Immediately | `REMOVE_BOOKMARK` |
| Delete folder | After confirm (contents go too) | `REMOVE_BOOKMARK_FOLDER` |
| Create folder from the tree | Immediately | `CREATE_BOOKMARK_FOLDER` |
| Tab dropped on folder / Inbox / nav-bookmarks | Immediately (existing) | `CREATE_BOOKMARKS` |
| Inbox filing plan | After preview confirm | `APPLY_BOOKMARK_FILING` |
| Duplicate removal | After preview confirm | `APPLY_BOOKMARK_DEDUP` |
| Open / Open all | Tabs only | `OPEN_BOOKMARK_URLS` |
| Export | Never writes Chrome | download from the side panel |

`FILE_BOOKMARKS { bookmarkIds, folderId }` is **not** tab-drop. It stays as today’s multi-id move into one folder (single-item filing bar in phase 1). Phase 2 review sheet does not use it. Tree drag never uses it.

### Undo

One `zen-tab.last-action`, 30s TTL.

`BookmarkUndoData` in the service worker becomes:

```ts
| { kind: 'file'; moves: BookmarkFileMove[] }           // parent actually changed
| { kind: 'move'; moves: BookmarkIndexMove[] }          // parent and/or index
| { kind: 'dedup'; removed: Array<{ id: string; title: string; url: string; parentId: string; index: number }> }
| { kind: 'create'; created: Array<{ id: string }> }
| { kind: 'edit'; id: string; previousTitle: string; previousUrl?: string }
| { kind: 'folder-create'; id: string }
```

`BookmarkIndexMove` is `{ id, fromParentId, fromIndex, toParentId, toIndex }`. Restore if the live node still exists: `move` back to `fromParentId` + `fromIndex`. Same-folder reorder uses this kind. Do **not** reuse `shouldRestoreFiledBookmark` (it requires `parentId` to have changed).

| Write | Undo |
|---|---|
| Filing plan / `FILE_BOOKMARKS` | `kind: 'file'` (parent change only) |
| Tree `MOVE_BOOKMARK` | `kind: 'move'` |
| Dedup | `kind: 'dedup'` |
| Delete one bookmark | `kind: 'dedup'` with that one row. Recreate gets a **new** Chrome id; `zen-tab.bookmark-summaries` keyed by the old id is lost. Accept that. |
| Edit title / URL | `kind: 'edit'` |
| Create folder | `kind: 'folder-create'`. Undo: if the folder still exists and has no children, `bookmarks.remove` (not `removeTree`). If it has children, skip undo. |
| Delete folder | no undo. **Clear** `last-action` so a previous file/move journal cannot `bookmarks.get` a now-missing id and throw. File/move undo must also skip missing ids. |
| Export | none |

A filing plan that creates folders then moves into them undoes as `file` moves (bookmarks return to Inbox). Created folders stay; the user can delete them from the tree.

Extend `checkpointBookmarkUndo`, `restoreAction`, and `isMutationMessage` together. Every new write message is on `isMutationMessage`. `hasBookmarksPermission` is checked before any write.

## 1. Side-panel tree

Keep the nested tree. Do not build a left-folder / right-list manager.

**Child order (Chrome-parity)**

Today `buildFolderNode` title-sorts folders first, then URLs, and `BookmarkFolderRecord` has no `index`. That cannot represent Chrome reorder.

Phase 1 changes flatten + forest:

- Every folder and bookmark carries Chrome `index`.
- A folder’s children are **one mixed list** sorted by `index` (folders and URLs interleaved), matching `chrome.bookmarks.getChildren`.
- No title sort.

Same-parent `chrome.bookmarks.move` uses Chrome’s index (destination among remaining children after the node is removed). Implement `bookmarkMoveIndex(fromIndex, toIndex)` and test off-by-one; do not pass the visual index through blindly.

**Roots**

- **Inbox** — `inboxBookmarks()` only. Not a Chrome folder row. Other Bookmarks root is not a row.
- **Bookmarks bar** — visible, not mutable as a root.
- **Other Bookmarks’ child folders** — in the forest as today.
- **Mobile Bookmarks** — visible folder, not a second Inbox. Loose mobile URLs render inside it.
- **Managed** — visible, read-only, including descendants.

**Immediate tree operations**

`buildBookmarkRowContextSpecs` and `buildBookmarkGroupContextSpecs` take `{ canMutate, isInbox, isSpecialRoot, collapsed }` (names can match the code). Tests update; they no longer lock Open+File / expand-only.

Bookmark row: Open, Edit, Delete. Inbox rows also get File (opens the Inbox review sheet in phase 2, scrolled to that row; phase 1 keeps today’s single-item file). Hide Edit/Delete when `!canMutate`.

Folder: Expand or Collapse, Open all, New folder, Rename, Delete. Hide New folder / Rename / Delete when `isSpecialRoot` or `!canMutate`.

- **Edit bookmark** — small panel: title and URL. `UPDATE_BOOKMARK`. Invalid URL: no write, panel stays, toast.
- **Rename folder** — same panel, title only.
- **Delete bookmark** — no second confirm.
- **Delete folder** — confirm that all bookmarks and subfolders inside will be deleted; then clear last-action and `REMOVE_BOOKMARK_FOLDER`.
- **New folder** — title prompt; parent is the right-clicked folder, or `otherBookmarksRootId(folders)` from the Inbox header.
- **Open / Open all** — `OPEN_BOOKMARK_URLS { urls }`. SW creates tabs in the last-focused window of this profile (incognito side panel → that incognito window), `exemptFromDuplicateGuard` on each created id (same as session restore). If more than 15 URLs, UI confirms the count first. Do not call `chrome.tabs.create` from the side panel for this.

Sparkles enrich / stored summaries stay. The new toolbar does not remove that row action.

**Drag contract**

Shared dnd-kit session (tabs + nav + bookmark surfaces) already exists. Payloads are discriminated:

| Field | Tab drag | Bookmark drag |
|---|---|---|
| `type` | `'tab'` | `'bookmark'` |
| sortable / row id | `tab-${tabId}` | `bookmark-row-${chromeId}` (never a raw Chrome id, never `tab-`) |
| folder / inbox droppable | existing `bookmark-folder-${id}`, `bookmark-inbox` | same droppables accept both |
| commit | existing `commitTabDrag` → `fileDroppedTab` → `CREATE_BOOKMARKS` | `commitBookmarkDrag` → `MOVE_BOOKMARK` only |

- Bookmark drop on Stash, Tabs, or `nav-bookmarks` → `none`.
- Bookmark drop on Inbox header → `MOVE_BOOKMARK` to `otherBookmarksRootId` (append).
- Bookmark drop on Bookmarks bar folder header → allowed (bar is a destination, not a mutable root).
- Bookmark drop on Managed (root or descendant) → `none`.
- Folder rows are also draggable (`bookmark-folder-row-${id}` as sortable source). Dropping a folder uses the same `MOVE_BOOKMARK` (Chrome allows moving folders). Cannot drop a folder into itself or a descendant (pure helper `isBookmarkMoveCycle`).
- Tab drop on folder / Inbox / nav-bookmarks is unchanged (`CREATE_BOOKMARKS`).

While unified search has text, `BookmarkList` is unmounted, so bookmark drag is off. No extra “disable sortable while searching” inside the list.

## 2. Preview sheets

Shared chrome: existing `modal-sheet`. Cancel writes nothing. Confirm runs one SW apply and one last-action.

### Inbox review (phase 2)

Opens from Review Inbox, the banner, or File on an Inbox row. One row per `inboxBookmarks()`:

- title, host
- suggested folder (`suggestBookmarkFolder`) or empty
- confidence and reason when present
- folder `<select>` of `eligibleFolders` (Bookmarks bar excluded, as today)
- Skip
- New folder: title + parent (default `otherBookmarksRootId`). Plan entry with `clientId`; a row may target that id

High-confidence is only the default selection. Confirm → `APPLY_BOOKMARK_FILING`:

1. Create planned folders (skip a create if the parent is gone; rows targeting it are skipped).
2. Resolve client ids, then `move` each non-skipped bookmark.
3. Missing live nodes: skip and continue.
4. Toast moved + skipped. Undo = completed `file` moves.

Apply disabled when every row is skipped or has no destination.

### Health report (phase 3)

Local only. No network.

1. **Duplicates** — today’s keep/remove preview. Confirm → `APPLY_BOOKMARK_DEDUP`. Empty groups: section says so; do not toast-and-close the sheet.
2. **Unfiled** — Inbox count; button closes the report and opens Inbox review. Never `move`.

Replaces Find Duplicates. Dead links are not shown.

### Export (phase 4)

Small sheet: Markdown or Netscape HTML, then download via a blob + `<a download>` on the extension page. **Do not** add the `downloads` permission.

Export the live in-memory tree (bar + Other + Mobile + Managed). Chips do not filter. Managed URLs are included because the user asked for the file; this is a local download.

- Markdown: `##` / `###` for folder depth, `- [title](url)` for bookmarks. Empty folders omitted.
- Netscape HTML: `NETSCAPE-Bookmark-file-1`.

The sheet states that a browser import **adds** a new folder tree and does not replace existing bookmarks.

Helpers in `src/shared/bookmark-export.ts`:

- `bookmarksToMarkdown(folders, bookmarks): string`
- `bookmarksToNetscapeHtml(folders, bookmarks): string`
- `parseNetscapeBookmarkHtml(html): chrome.bookmarks.BookmarkTreeNode[]`

Parser output is a Chrome-like forest **wrapped in one untitled root** (`parentId == null`, empty title) so `flattenBookmarkTree` does not treat user folders as special roots. Round-trip test: URL set + folder titles after flatten. Ignore special-root flags on the wrapper.

## 3. Service worker messages

Keep: `GET_BOOKMARK_TREE`, `FILE_BOOKMARKS`, `APPLY_BOOKMARK_DEDUP`, `SUGGEST_BOOKMARK_FILE`, `CREATE_BOOKMARKS`.

Add:

```ts
| { type: 'UPDATE_BOOKMARK'; id: string; title: string; url?: string }
| { type: 'REMOVE_BOOKMARK'; id: string }
| { type: 'CREATE_BOOKMARK_FOLDER'; parentId: string; title: string }
| { type: 'REMOVE_BOOKMARK_FOLDER'; id: string }
| { type: 'MOVE_BOOKMARK'; id: string; parentId: string; index?: number }
| { type: 'OPEN_BOOKMARK_URLS'; urls: string[] }
| {
    type: 'APPLY_BOOKMARK_FILING'
    creates: Array<{ clientId: string; parentId: string; title: string }>
    moves: Array<{ bookmarkId: string; folderId: string }> // folderId may be a clientId
  }
```

Reject update/remove/move on a live special root or `unmodifiable === 'managed'`. `UPDATE_BOOKMARK` with `url` on a folder is rejected. `REMOVE_BOOKMARK` on a folder is rejected.

`permissions.onRemoved`: if `bookmarks` was removed, broadcast `BOOKMARKS_UPDATED` and treat the next `GET_BOOKMARK_TREE` as `{ granted: false }`. UI closes sheets and shows the grant empty state. Confirm after revoke must not write (`hasBookmarksPermission` on every write).

## 4. UI copy and i18n

New `en` / `zh` strings for chips, review/health/export, skip, new folder, delete-folder confirm, import-adds-not-replaces, moved/skipped, edit labels, open-all confirm. Auto-file toast removal is in the service worker, not i18n.

## 5. Errors

- Permission missing or revoked: grant empty state; close sheets; no writes.
- Partial apply: skip missing nodes; toast skipped count; persist undo for completed writes only.
- Create-folder failure in a plan: do not move rows that targeted that client id.
- Invalid edit URL: no write.
- Export failure: toast only.
- File/move undo after a later folder delete: skip missing ids; do not throw.

## 6. Tests

Pure helpers and plan validation. No click-through side-panel tests.

- Flatten: `folderKind`, `index`, `unmodifiable` on roots and a managed descendant.
- Forest: mixed children by `index`; Mobile visible; Inbox excludes mobile loose URLs; `canMutateBookmarkNode` on bar/other/mobile/managed.
- `otherBookmarksRootId`, `isBookmarkMoveCycle`, `bookmarkMoveIndex`.
- Filing plan apply-order helper: per-item destinations, skip, create-then-move, skip when create failed or node vanished.
- `validateBookmarkDedupGroups` unchanged.
- Export: Markdown hierarchy; Netscape round-trip URL set + folder titles with untitled-root wrapper.
- Extracted `decideCreatedBookmarkAction`: high-confidence never auto-files (phase 2).
- Context-menu specs: parameterized; tests cover mutate vs read-only vs inbox File.

Out of test scope: dead links, navigation site, tags, typed-URL create.

## Phases (implementation order)

Four shippable slices. Do not merge them into one plan task.

1. **Tree** — flatten flags + index-ordered forest; `canMutate` / `otherBookmarksRootId`; SW tree messages + `OPEN_BOOKMARK_URLS` + undo kinds + `isMutationMessage` + `permissions.onRemoved`; context menus; edit/delete/create folder; bookmark and folder drag contract; chips (All / Inbox / Duplicates). Filing stays as today’s single-item `FILE_BOOKMARKS` bar, banner, and high-confidence auto-file.
2. **Inbox review** — `APPLY_BOOKMARK_FILING`; banner / File / Review Inbox open the sheet; remove the inline `<select>` bar and auto-file.
3. **Health report** — replace Find Duplicates; keep `APPLY_BOOKMARK_DEDUP`.
4. **Export** — Markdown + Netscape download.

Phase 1 is blocked on forest ordering + drag discriminator even if Inbox review waits. Auto-file disappears only in phase 2.

## Existing files to extend

| File | Change |
|---|---|
| `src/shared/bookmarks.ts` | `folderKind`, `index`, `unmodifiable`; `canMutateBookmarkNode`; `otherBookmarksRootId`; `bookmarkMoveIndex`; `isBookmarkMoveCycle`; filing-plan apply-order helper |
| `src/shared/bookmark-tree.ts` | mixed `index` children; show Mobile/Managed; Inbox still from `inboxBookmarks()` |
| `src/shared/bookmark-export.ts` | new |
| `src/shared/types.ts` | new fields + messages |
| `src/shared/tab-dnd.ts` / `src/sidepanel/dnd-surfaces.tsx` | `type: 'tab' \| 'bookmark'`; bookmark row/folder ids; Inbox drop → Other root |
| `src/background/service-worker.ts` | new cases; queue; undo; `OPEN_BOOKMARK_URLS`; `permissions.onRemoved`; stop auto-file in phase 2 |
| `src/sidepanel/BookmarkList.tsx` | tree ops, chips, sheets; keep enrich |
| `src/sidepanel/context-menu.ts` + tests | parameterized specs |
| `src/sidepanel/file-dropped-tab.ts` | unchanged: still `CREATE_BOOKMARKS` |
| `src/sidepanel/i18n.ts` | new strings |
| `src/sidepanel/styles.css` | chips, edit panel, sheets as needed |

## Success

A user can do Chrome-like folder and bookmark maintenance in the side panel (including index-order drag), review Inbox destinations and duplicates before any organize write, export Markdown or importable HTML, and never get a silent high-confidence `move`. The product is still a workspace assistant, not a second bookmark manager or a generated site.
