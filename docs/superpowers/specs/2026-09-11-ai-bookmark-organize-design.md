# AI topic organize + 7-day organize snapshots

Date: 2026-09-11  
Surface: Zen Tab side panel — Bookmarks Organize sheet  
Status: approved; implementation plan written  
Depends on: [bookmark-management-design](./2026-09-11-bookmark-management-design.md)  
Amends that spec: Organize / health sheet is no longer “local only, no network.” Duplicates stay local. Topic analyze is user-initiated and may call the configured model.  
Does not replace: host-cluster `proposeBookmarkOrganize` (instant local fallback)

## Goal

Let the user ask Organize to group bookmarks **by topic** (Design, Reading, Work — not only same-site folders), preview the plan, then write Chrome bookmarks only after confirm.

Before that write, save a compact timestamped snapshot of the bookmarks that will actually be attempted. For 7 days the user can restore those bookmarks toward their previous folders. At most 3 snapshots stay in `chrome.storage.local`.

## Non-goals

- A Rico navigation site, theme pack, or a parallel taxonomy store. Topic folders are normal Chrome folders under Other Bookmarks.
- Tags, dead-link scanning, or a Lishu-style copy folder as the organize result.
- Auto-file on `bookmarks.onCreated`.
- Chat / Stella-style natural-language commands.
- Extending the 30s last-action ⌘Z window to 7 days.
- `unlimitedStorage`.
- Sending page HTML, unread page bodies, query strings, or browsing history to the model.
- Organizing any Bookmarks Bar item (root shortcuts **and** nested bar folders).
- Changing Inbox review or duplicate removal.

## User flow

1. Organize opens. The sheet immediately shows the **host-cluster** plan (no model). Duplicate section unchanged. Fetch snapshot summaries (`GET_BOOKMARK_ORGANIZE_SNAPSHOTS`).
2. **Organize by topic** is enabled only when the path that will actually run is ready:
   - `aiProvider === 'openai-compatible'` **and** `snapshot.hasCloudApiKey` **and** the API host permission is granted, or
   - built-in `LanguageModel` status is `available`.
   `downloadable` does not start a download here (Settings only). No cloud key / local-only provider: do not call analyze; host-cluster stays applicable; one line of copy says topic organize needs a model.
3. Click topic analyze:
   - Cloud: `ANALYZE_BOOKMARK_ORGANIZE` (service worker holds the key).
   - Local model: the **side panel** runs the topic helper (Prompt API is unreliable in the worker — same split as tab grouping).
   Closing the sheet, applying, or revoke increments `analyzeGen`; ignore late results. Nothing is written.
4. Topic success: topic clusters list first. Host clusters remain underneath for eligible bookmarks the model did not classify. Apply uses the **union** (topic wins on id overlap). Show `analyzed N of M eligible`. If the model path fails or returns nothing usable: keep the full host list and toast analyze-failed. If `source !== 'topic-model'`, do not swap the list.
5. Confirm **Apply N changes** (host-only or topic+host union) → `APPLY_BOOKMARK_ORGANIZE`. Inbox review stays on `APPLY_BOOKMARK_FILING` (no 7-day snapshot).
6. Snapshot section lists unexpired summaries: formatted time, move count, days left (hide expired / 0-day leftovers). Restore uses `window.confirm` that says later drags will also be pulled back. Then `RESTORE_BOOKMARK_ORGANIZE`. Empty list: hide the section.
7. After a topic result, “Show site groups only” resets to the host plan without closing the sheet.

⌘Z after apply undoes that apply **and deletes its 7-day snapshot**. The two restore paths never stack.

## Architecture

```
Organize sheet
  proposeBookmarkOrganize(local)                 // host clusters, sync
  topic analyze
    cloud  → ANALYZE_BOOKMARK_ORGANIZE (SW)
    local  → bookmark-organize-ai.ts in the side panel
    both   → sanitizeBookmarkTopicProposal
    merge  → topic clusters + host clusters for leftovers
  APPLY_BOOKMARK_ORGANIZE                        // host and topic confirms
    await mutation queue
    re-flatten + same eligibility/sanitize
    snapshot only attempted rows
    applyBookmarkFiling
    patch snapshot from completed writes (try/finally)
  RESTORE_BOOKMARK_ORGANIZE
    indexed chrome.bookmarks.move
    delete empty created folders
    clear last-action
```

Side panel never calls `chrome.bookmarks.*`. Do **not** call `createAIProvider.proposeProjects` for bookmarks (that API returns tab `GroupProposal`s and falls through to tab heuristics).

### Messages

```ts
| { type: 'ANALYZE_BOOKMARK_ORGANIZE' }
| {
    type: 'APPLY_BOOKMARK_ORGANIZE'
    creates: Array<{ clientId: string; parentId: string; title: string }>
    moves: Array<{ bookmarkId: string; folderId: string }>
  }
| { type: 'RESTORE_BOOKMARK_ORGANIZE'; snapshotId: string }
| { type: 'GET_BOOKMARK_ORGANIZE_SNAPSHOTS' }
```

`ANALYZE` and `GET` are reads. Before `getTree`, ANALYZE waits for the current mutation queue to drain (still not queued as a mutation). `APPLY_BOOKMARK_ORGANIZE` and `RESTORE_BOOKMARK_ORGANIZE` join `isMutationMessage` and require `hasBookmarksPermission`.

Analyze result (cloud path; local path produces the same object in the panel):

```ts
{
  proposal: BookmarkOrganizeProposal
  source: 'topic-model' | 'host-heuristic'
  provider: ProviderCapabilities['name']
  analyzedCount: number
  eligibleCount: number
}
```

Permission missing: same shape as `GET_BOOKMARK_TREE` (`granted: false`); no model call.

## Eligibility

A bookmark may enter a plan only when all hold:

- Has a URL and a non-empty host
- Not managed (`unmodifiable` or managed ancestor)
- `folderKind` is not `mobile` or `managed`
- Not on the Bookmarks Bar: `folderKind !== 'bar'` and `isBookmarksBar !== true` (nested bar folders included)
- Immediate parent is not a bar-kind folder (covers bar-root shortcuts)

Inbox-folder children and Other-root loose URLs **are** sources (same as host organize).

Destinations: `filingDestinationFolders` **plus** no bar ancestor. Do not file into Inbox or a folder whose title normalizes to `inbox`.

New folders: `parentId` must be `otherBookmarksRootId`. If that id is missing, no creates (reuse-only / host-only).

Reuse an existing eligible folder when its title matches the topic name via one shared `normalizeName` (trim, lower case, collapse whitespace). Otherwise create.

A **new** topic folder needs at least two bookmarks. A **reuse** may receive one or more. Each bookmark appears in at most one cluster (first group wins). `isAlreadyHome`: already in a folder whose title matches that topic → do not move. Unclassified stay put.

Refuse topic names that `normalizeName` to `inbox`.

## Topic model

New helper module `src/shared/bookmark-organize-ai.ts` (keep `ai.ts` tab-only). Reuse private-equivalent JSON request patterns (export small `requestLocalJson` / `requestCloudJson` wrappers if needed). Same cloud key as grouping. No second API-key setting.

Prompt payload:

```ts
{
  language: Language
  folders: Array<{ id: string; title: string }>
  bookmarks: Array<{
    id: string
    title: string
    host: string
    path: string          // pathname only
    folderId: string
    folderTitle: string
  }>
}
```

Eligible order (deterministic, tested): Inbox and Other-root loose URLs first, then folders by descending URL-child count, then id. Cap **40** bookmarks per analyze (one batch inside the existing 20s/request, 30s budget). Send the dest folder list **once**, not repeated per leftover. UI must show `analyzedCount` / `eligibleCount` so a 40-cap on a large library is visible.

Expected JSON:

```ts
{
  groups: Array<{
    name: string
    bookmarkIds: string[]
    folderId?: string
  }>
}
```

`sanitizeBookmarkTopicProposal` (pure, tested):

- Drop unknown / ineligible ids; first group keeps a duplicate id
- Drop illegal `folderId`; drop names outside 1–80 chars after trim
- Drop names that normalize to `inbox`
- Drop create-groups with fewer than two remaining ids
- Reuse dest when `normalizeName(name)` matches an eligible folder title even if `folderId` omitted
- Unique `clientId` (`organize-topic-${slug}` + numeric suffix like host ids)
- Merge remaining eligible ids through `proposeBookmarkOrganize` so Apply can include leftover host clusters

Folder titles in the prompt language (`settings.language`).

## Snapshots

Storage key: `zen-tab.bookmark-organize-snapshots`.  
TTL: `7 * 24 * 60 * 60 * 1000`.  
Cap: `3` after dropping expired (then oldest).  
JSON byte cap: `500_000` for the stored array (same spirit as project-memory). Nodes store `{ id, parentId, index }` only — no title/url. On `QUOTA_EXCEEDED` or `set` throw: continue apply; snapshot-save-failed toast; 30s undo still works.

```ts
type BookmarkOrganizeSnapshot = {
  id: string
  createdAt: number
  expiresAt: number
  moveCount: number
  createdFolderIds: string[]
  nodes: Array<{ id: string; parentId: string; index: number }>
}

type BookmarkOrganizeSnapshotSummary = {
  id: string
  createdAt: number
  expiresAt: number
  moveCount: number
}
```

UI label is formatted from `createdAt` + `settings.language`.

### Write order on apply

1. `hasBookmarksPermission` or reject.
2. Re-flatten. Re-run eligibility + `sanitizeBookmarkTopicProposal` / host sanitize on the **client plan** (treat it as a hint). Drop illegal, vanished, no-op, and bar/mobile/managed rows. If nothing remains, do not write a snapshot; toast nothing-to-apply.
3. Snapshot **only attempted** live URL nodes (`parentId` / `index` from `bookmarks.get`). Prune first.
4. `applyBookmarkFiling`. Extend return to `{ moved, skipped, created: Array<{ clientId: string; id: string }> }`. Inbox ignores `created`. Do not change today’s `skipped = moves.length - completed.length`.
5. **Always** (success, partial, or throw after some writes): patch `createdFolderIds` + `moveCount` from **completed** writes; delete the snapshot if both are empty.
6. 30s last-action is the existing `kind: 'file'` journal of completed filing moves. Undoing that action **also deletes this snapshot** so a later 7-day restore cannot yank items a second time.

### Restore

`planBookmarkOrganizeRestore(snapshot, liveBookmarks, liveFolders)` → `{ moves, deleteFolderIds, skipped }`.

- Live URL node exists and original `parentId` still exists and is fileable → `chrome.bookmarks.move` with `parentId` + `index`. Use `bookmarkMoveIndex` when the node is already under that parent. Order by `parentId`, then original `index` ascending. **Best-effort** sibling order; do not promise original order after later edits.
- Missing bookmark or missing/unfileable parent: skip (do not recreate deleted homes).
- After moves, delete snapshot `createdFolderIds` that still exist, are mutable, and have **no children**. Keep user-filled created folders.

SW executes the plan, removes the snapshot, toasts moved + skipped, and **clears `last-action`**. Restore must not journal `kind: 'file'` moves whose `fromParentId` may be a folder this restore just deleted (`restoreAction` throws on missing parent).

Confirm copy: restore moves these bookmarks toward where they were at apply time, including any the user moved afterward.

## UI

Same `BookmarkHealthSheet`. Request / `analyzeGen` / apply / restore live in `BookmarkList` (sheet stays presentational).

| State | Cluster section |
|---|---|
| Open | Host list + Apply + Organize by topic (ready-path only) + Review Inbox |
| Analyzing | Loading copy; **all** sheet actions disabled (topic, host apply, restore, dedup) |
| Topic result | Topic clusters + leftover host clusters + analyzed N of M + Show site groups only |
| Analyze failed / `source !== 'topic-model'` | Host list unchanged; toast |
| No model | Host list; topic disabled + hint |

Footer: Cancel + Remove duplicates. Host and topic confirms both call `APPLY_BOOKMARK_ORGANIZE`. Apply count is union `moves.length` (create-only rows do not add to N).

Pass `hasCloudApiKey`, `aiProvider`, and built-in status into the sheet. Do not read the API key in the sheet.

## Errors

| Case | Result |
|---|---|
| No bookmarks permission | Grant empty state; no analyze/apply/restore |
| No ready model path | No analyze call; host plan only |
| Model timeout / HTTP / unusable JSON / port killed | Host plan + analyze-failed toast |
| Invalid AI ids / illegal dests | Dropped in sanitize |
| No Other root | No creates |
| Snapshot persist / quota | Apply writes; snapshot-save-failed toast; 30s undo remains |
| Restore expired / unknown id | Toast; no writes |
| Restore parent or node gone | Skip |
| Analyze in flight, sheet closed / applied / revoked | Ignore result |
| `ANALYZE` during an in-flight apply | Wait for mutation queue, then flatten |

## Tests (pure)

- `sanitizeBookmarkTopicProposal`: illegal ids, bar (root **and** nested), mobile, managed, inbox-named topics, duplicate membership, short create groups, title reuse, unique client ids, leftover host merge.
- Topic JSON parse: well-formed groups; garbage / missing `groups` → empty → host fallback.
- Eligible order + 40 cap.
- Payload pathname only (no search).
- `pruneBookmarkOrganizeSnapshots`: expiry, cap 3, oldest dropped, byte budget.
- Apply-time sanitize: drops stale bar/managed rows from a client plan.
- Snapshot patch after partial/throw; empty completed writes drop the snapshot.
- `planBookmarkOrganizeRestore`: index order on a clean parent; skip missing; do not delete filled created folders; do not emit undo into a parent the plan will delete.
- Existing host `proposeBookmarkOrganize` tests stay green.

SW handlers stay untested (repo norm). Helpers must not live only inside the worker.

## Files

| File | Change |
|---|---|
| `src/shared/bookmark-organize.ts` | eligibility (full bar skip), sanitize, prune, restore plan, leftover host merge |
| `src/shared/bookmark-organize-ai.ts` | topic prompt + parse + batch-of-one |
| `src/shared/bookmark-organize.test.ts` | cases above |
| `src/shared/types.ts` | messages + snapshot types |
| `src/shared/storage.ts` | read/write/prune/byte-cap snapshots |
| `src/shared/bookmarks.ts` | `applyBookmarkFiling` return `created` (SW); dest helper if bar-ancestor filter is extracted |
| `src/background/service-worker.ts` | analyze (cloud), apply-organize, restore, get snapshots; ⌘Z deletes snapshot |
| `src/sidepanel/BookmarkList.tsx` | analyzeGen, local-model analyze, apply/restore, snapshot fetch |
| `src/sidepanel/BookmarkHealthSheet.tsx` | topic + leftover host + snapshot sections |
| `src/sidepanel/i18n.ts` | strings |
| `src/sidepanel/styles.css` | snapshot row if needed |

## Success

A user with a mixed folder like Interesting Projects can run Organize by topic, see named topic folders plus leftover site groups, confirm, and get Chrome folders created. If they dislike the result they restore from a dated snapshot within 7 days, or ⌘Z within 30s (which also drops that snapshot). Host-cluster organize still works with no model and also gets a 7-day snapshot. Nothing writes without confirm. Bar / Mobile / Managed stay put.
