# AI topic organize + 7-day snapshots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Organize can propose topic folders via the existing AI stack, preview them, write Chrome bookmarks only after confirm, and keep a 7-day compact snapshot so the user can restore.

**Architecture:** Host-cluster `proposeBookmarkOrganize` stays the instant plan. Topic analyze runs in the side panel for Chrome `LanguageModel` and in the service worker for openai-compatible. Both paths sanitize with the same helpers, then Apply goes through `APPLY_BOOKMARK_ORGANIZE` (snapshot → existing `applyBookmarkFiling`). Inbox stays on `APPLY_BOOKMARK_FILING`. Restore uses indexed `chrome.bookmarks.move` and never journals into folders it is about to delete.

**Tech Stack:** Chrome MV3, React 18 side panel, existing Groq/OpenAI-compatible + Prompt API stack, Vitest, `en`/`zh` `i18n.ts`.

**Spec:** `docs/superpowers/specs/2026-09-11-ai-bookmark-organize-design.md`

## Global Constraints

- Chrome bookmarks stay the only tree of record. Side panel must not call `chrome.bookmarks.*`.
- Preview-then-write for organize. Nothing writes on analyze.
- Do not call `createAIProvider.proposeProjects` for bookmarks.
- Local Prompt API runs in the side panel only. Service worker runs cloud analyze only.
- Do not add `unlimitedStorage`, tags, dead-link scan, Rico navigation, or a copy-folder result.
- Bookmarks Bar (root and nested), Mobile, and Managed never enter a plan.
- Inbox review stays `APPLY_BOOKMARK_FILING` (no 7-day snapshot). Host and topic Apply both use `APPLY_BOOKMARK_ORGANIZE`.
- TDD for every new helper. Run the exact vitest command in the task.
- Do not commit unless the user asks. Skip commit steps until then.
- Work from `/Users/mingjie/Documents/github/personal-projects/chrome-ext/zen-tab`.
- Do not edit `docs/plan/`.

## File map

| File | Responsibility |
|---|---|
| `src/shared/bookmark-organize.ts` | Eligibility, dest filter, sanitize, leftover host merge, snapshot prune, restore plan, apply-time constrain |
| `src/shared/bookmark-organize-ai.ts` | Topic prompt, JSON parse, 40-cap payload, local/cloud request |
| `src/shared/bookmark-organize.test.ts` | Pure tests for the above |
| `src/shared/bookmark-organize-ai.test.ts` | Parse + payload tests |
| `src/shared/types.ts` | Messages + snapshot types |
| `src/shared/storage.ts` | Snapshot read/write/delete with prune + byte cap |
| `src/shared/ai.ts` | Export `requestLocalJson` / `requestCloudJson` only |
| `src/background/service-worker.ts` | Analyze (cloud), apply-organize, restore, get snapshots; file-undo deletes snapshot |
| `src/sidepanel/BookmarkList.tsx` | `analyzeGen`, local analyze, apply/restore, snapshot fetch |
| `src/sidepanel/BookmarkHealthSheet.tsx` | Topic + leftover host + snapshot UI |
| `src/sidepanel/i18n.ts` | `en`/`zh` strings |
| `src/sidepanel/styles.css` | Snapshot row if the existing dedup card is not enough |

---

### Task 1: Full bar skip + organize destinations

**Files:**
- Modify: `src/shared/bookmark-organize.ts`
- Modify: `src/shared/bookmarks.ts` (export a bar-ancestor helper if you extract it; otherwise keep the walk in organize)
- Test: `src/shared/bookmark-organize.test.ts`

**Interfaces:**
- Consumes: `flattenBookmarkTree`, existing `tree()` / `page()` test helpers
- Produces: `canOrganizeBookmark` (exported), `organizeDestinationFolders(folders)`, `normalizeOrganizeName(title)`

- [ ] **Step 1: Write the failing test**

Add to `src/shared/bookmark-organize.test.ts`:

```ts
test('does not organize nested Bookmarks Bar folders', () => {
  const proposal = organizeFrom([], [{
    id: 'work',
    parentId: '1',
    title: 'Work',
    children: [
      page('g1', 'https://github.com/acme/one', 'work'),
      page('g2', 'https://github.com/acme/two', 'work'),
    ],
  }]);
  expect(proposal).toEqual({ creates: [], moves: [], clusters: [] });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/bookmark-organize.test.ts`
Expected: FAIL — nested bar GitHub bookmarks are currently eligible (`parent.folderKind === 'folder'`).

- [ ] **Step 3: Write minimal implementation**

In `bookmark-organize.ts`, replace `canOrganizeBookmark` and add dest filter. `proposeBookmarkOrganize` must use `organizeDestinationFolders`, not raw `filingDestinationFolders`.

```ts
export function normalizeOrganizeName(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, '');
}

export function folderHasBarAncestor(id: string, folders: BookmarkFolderRecord[]): boolean {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  let current = byId.get(id);
  while (current) {
    if (current.folderKind === 'bar') return true;
    if (!current.parentId) break;
    current = byId.get(current.parentId);
  }
  return false;
}

export function canOrganizeBookmark(
  bookmark: BookmarkRecord,
  folders: BookmarkFolderRecord[],
  foldersById = new Map(folders.map((folder) => [folder.id, folder])),
): boolean {
  if (!bookmark.url || bookmark.unmodifiable === 'managed') return false;
  if (bookmark.folderKind === 'bar' || bookmark.folderKind === 'mobile' || bookmark.folderKind === 'managed') return false;
  if (bookmark.isBookmarksBar) return false;
  if (isManagedBookmarkNode(bookmark.parentId, folders)) return false;
  const parent = foldersById.get(bookmark.parentId);
  if (!parent) return false;
  if (parent.folderKind === 'bar' || parent.folderKind === 'mobile' || parent.folderKind === 'managed') return false;
  if (folderHasBarAncestor(parent.id, folders)) return false;
  return Boolean(clusterHostFromUrl(bookmark.url));
}

export function organizeDestinationFolders(folders: BookmarkFolderRecord[]): BookmarkFolderRecord[] {
  return filingDestinationFolders(folders).filter((folder) => (
    !folderHasBarAncestor(folder.id, folders)
    && normalizeOrganizeName(folder.title) !== 'inbox'
  ));
}
```

Export `canOrganizeBookmark`. Keep existing host tests green (bar-root case already expects empty).

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/shared/bookmark-organize.test.ts`
Expected: PASS (including the previous 8 host tests)

- [ ] **Step 5: Commit only if the user asked**

```bash
git add src/shared/bookmark-organize.ts src/shared/bookmark-organize.test.ts
git commit -m "$(cat <<'EOF'
fix: keep Bookmarks Bar folders out of organize plans

EOF
)"
```

---

### Task 2: Snapshot prune helpers

**Files:**
- Modify: `src/shared/types.ts` (add snapshot types next to bookmark types)
- Modify: `src/shared/bookmark-organize.ts`
- Test: `src/shared/bookmark-organize.test.ts`

**Interfaces:**
- Consumes: none
- Produces:

```ts
export const BOOKMARK_ORGANIZE_SNAPSHOT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const BOOKMARK_ORGANIZE_SNAPSHOT_LIMIT = 3;
export const BOOKMARK_ORGANIZE_SNAPSHOTS_JSON_LIMIT = 500_000;

export function pruneBookmarkOrganizeSnapshots(
  snapshots: BookmarkOrganizeSnapshot[],
  now: number,
  jsonLimit?: number,
): BookmarkOrganizeSnapshot[]

export function toBookmarkOrganizeSnapshotSummary(
  snapshot: BookmarkOrganizeSnapshot,
): BookmarkOrganizeSnapshotSummary
```

Types in `src/shared/types.ts`:

```ts
export type BookmarkOrganizeSnapshot = {
  id: string
  createdAt: number
  expiresAt: number
  moveCount: number
  createdFolderIds: string[]
  nodes: Array<{ id: string; parentId: string; index: number }>
}

export type BookmarkOrganizeSnapshotSummary = {
  id: string
  createdAt: number
  expiresAt: number
  moveCount: number
}
```

- [ ] **Step 1: Write the failing test**

```ts
import { pruneBookmarkOrganizeSnapshots } from './bookmark-organize';

function snap(id: string, createdAt: number): BookmarkOrganizeSnapshot {
  return { id, createdAt, expiresAt: createdAt + 7 * 24 * 60 * 60 * 1000, moveCount: 1, createdFolderIds: [], nodes: [{ id: 'n', parentId: '2', index: 0 }] };
}

test('drops expired snapshots, then the oldest past three', () => {
  const now = 1_000_000;
  const kept = pruneBookmarkOrganizeSnapshots([
    snap('old', now - 8 * 24 * 60 * 60 * 1000),
    snap('a', now - 3_000),
    snap('b', now - 2_000),
    snap('c', now - 1_000),
    snap('d', now - 100),
  ], now);
  expect(kept.map((item) => item.id)).toEqual(['b', 'c', 'd']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/bookmark-organize.test.ts -t "drops expired"`
Expected: FAIL — `pruneBookmarkOrganizeSnapshots` is not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
export function pruneBookmarkOrganizeSnapshots(
  snapshots: BookmarkOrganizeSnapshot[],
  now: number,
  jsonLimit = BOOKMARK_ORGANIZE_SNAPSHOTS_JSON_LIMIT,
): BookmarkOrganizeSnapshot[] {
  const live = snapshots
    .filter((item) => item.expiresAt > now)
    .sort((left, right) => left.createdAt - right.createdAt);
  let next = live.length > BOOKMARK_ORGANIZE_SNAPSHOT_LIMIT
    ? live.slice(live.length - BOOKMARK_ORGANIZE_SNAPSHOT_LIMIT)
    : live;
  while (next.length && JSON.stringify(next).length > jsonLimit) next = next.slice(1);
  return next;
}

export function toBookmarkOrganizeSnapshotSummary(
  snapshot: BookmarkOrganizeSnapshot,
): BookmarkOrganizeSnapshotSummary {
  return { id: snapshot.id, createdAt: snapshot.createdAt, expiresAt: snapshot.expiresAt, moveCount: snapshot.moveCount };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/shared/bookmark-organize.test.ts`
Expected: PASS

- [ ] **Step 5: Commit only if the user asked**

---

### Task 3: Topic sanitize + leftover host merge + apply constrain

**Files:**
- Modify: `src/shared/bookmark-organize.ts`
- Test: `src/shared/bookmark-organize.test.ts`

**Interfaces:**
- Consumes: Task 1 dest/eligibility, `proposeBookmarkOrganize`
- Produces:

```ts
export function sanitizeBookmarkTopicProposal(
  raw: unknown,
  bookmarks: BookmarkRecord[],
  folders: BookmarkFolderRecord[],
): BookmarkOrganizeProposal

export function mergeTopicWithHostOrganize(
  topic: BookmarkOrganizeProposal,
  bookmarks: BookmarkRecord[],
  folders: BookmarkFolderRecord[],
): BookmarkOrganizeProposal

export function constrainOrganizePlan(
  plan: { creates: BookmarkFilingCreate[]; moves: BookmarkFilingMove[] },
  bookmarks: BookmarkRecord[],
  folders: BookmarkFolderRecord[],
): { creates: BookmarkFilingCreate[]; moves: BookmarkFilingMove[] }
```

- [ ] **Step 1: Write the failing tests**

Use the existing `tree()` / `flattenBookmarkTree` fixtures. Cover:

1. Unknown id dropped; first group wins a duplicate id.
2. Name `Inbox` dropped (no create).
3. One-bookmark create group dropped; one-bookmark reuse of existing `Figma` kept.
4. Nested bar / managed ids dropped.
5. `mergeTopicWithHostOrganize` adds host clusters only for leftover ids.
6. `constrainOrganizePlan` drops a move whose bookmark is on the bar.

```ts
test('sanitizes topic groups and merges leftover host clusters', () => {
  const { bookmarks, folders } = flattenBookmarkTree(tree([{
    id: 'proj',
    parentId: '2',
    title: 'Interesting Projects',
    children: [
      page('g1', 'https://github.com/acme/one', 'proj', 'One'),
      page('g2', 'https://github.com/acme/two', 'proj', 'Two'),
      page('f1', 'https://figma.com/file/aaa', 'proj', 'Board'),
      page('f2', 'https://figma.com/file/bbb', 'proj', 'Board 2'),
    ],
  }, { id: 'design', parentId: '2', title: 'Design', children: [] }]));

  const topic = sanitizeBookmarkTopicProposal({
    groups: [
      { name: 'Design', bookmarkIds: ['f1', 'missing', 'f1'], folderId: 'design' },
      { name: 'Inbox', bookmarkIds: ['g1', 'g2'] },
    ],
  }, bookmarks, folders);

  expect(topic.moves).toEqual([{ bookmarkId: 'f1', folderId: 'design' }]);
  expect(topic.creates).toEqual([]);

  const merged = mergeTopicWithHostOrganize(topic, bookmarks, folders);
  expect(merged.moves.some((move) => move.bookmarkId === 'f1' && move.folderId === 'design')).toBe(true);
  expect(merged.creates.some((create) => create.title === 'Github')).toBe(true);
  expect(merged.moves.filter((move) => move.bookmarkId === 'g1' || move.bookmarkId === 'g2')).toHaveLength(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/bookmark-organize.test.ts -t "sanitizes topic"`
Expected: FAIL — functions missing.

- [ ] **Step 3: Write minimal implementation**

Rules:
- Parse `raw.groups` only if it is an array.
- Bookmark must pass `canOrganizeBookmark`.
- `folderId` must be in `organizeDestinationFolders`.
- Title 1–80 after trim; `normalizeOrganizeName` !== `inbox`.
- If no legal `folderId`, reuse dest whose `normalizeOrganizeName(title)` equals the topic name; else create under `otherBookmarksRootId` when ≥2 ids remain.
- `clientId` = `organize-topic-${slug}` with numeric suffix.
- `isAlreadyHome` for topic: parent title `normalizeOrganizeName` equals topic name → skip move.
- Merge: claimed = topic move ids; run `proposeBookmarkOrganize`; keep host creates/moves/clusters whose bookmark ids are not claimed; topic clusters first.

`constrainOrganizePlan`: keep moves whose bookmark is eligible and dest is an organize dest or a `clientId` present in `creates`; keep creates whose `parentId` is Other root and title is not inbox.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/shared/bookmark-organize.test.ts`
Expected: PASS

- [ ] **Step 5: Commit only if the user asked**

---

### Task 4: Restore plan

**Files:**
- Modify: `src/shared/bookmark-organize.ts`
- Test: `src/shared/bookmark-organize.test.ts`

**Interfaces:**
- Consumes: `canFileIntoBookmarkParent`, `canMutateBookmarkNode`, snapshot type
- Produces:

```ts
export type BookmarkOrganizeRestorePlan = {
  moves: Array<{ id: string; parentId: string; index: number }>;
  deleteFolderIds: string[];
  skipped: number;
}

export function planBookmarkOrganizeRestore(
  snapshot: BookmarkOrganizeSnapshot,
  liveBookmarks: BookmarkRecord[],
  liveFolders: BookmarkFolderRecord[],
  folderChildCounts: Map<string, number>,
): BookmarkOrganizeRestorePlan
```

`folderChildCounts` is live children per folder id (URLs + folders). SW builds it from `chrome.bookmarks.getChildren` or flatten.

- [ ] **Step 1: Write the failing test**

```ts
test('restores in original index order and only deletes empty created folders', () => {
  const snapshot = {
    id: 's1',
    createdAt: 1,
    expiresAt: 9,
    moveCount: 2,
    createdFolderIds: ['new', 'kept'],
    nodes: [
      { id: 'b2', parentId: 'proj', index: 1 },
      { id: 'b1', parentId: 'proj', index: 0 },
      { id: 'gone', parentId: 'proj', index: 2 },
    ],
  };
  const liveBookmarks = [
    { id: 'b1', parentId: 'new', title: 'A', url: 'https://a.example', folderPath: '', isInbox: false, isBookmarksBar: false, folderKind: 'other' as const, index: 0 },
    { id: 'b2', parentId: 'new', title: 'B', url: 'https://b.example', folderPath: '', isInbox: false, isBookmarksBar: false, folderKind: 'other' as const, index: 1 },
  ];
  const liveFolders = [
    { id: '2', folderKind: 'other' as const, title: 'Other', folderPath: 'Other', isInbox: false, isSpecialRoot: true, isBookmarksBar: false, index: 1 },
    { id: 'proj', parentId: '2', folderKind: 'folder' as const, title: 'Proj', folderPath: 'Other / Proj', isInbox: false, isSpecialRoot: false, isBookmarksBar: false, index: 0 },
    { id: 'new', parentId: '2', folderKind: 'folder' as const, title: 'Design', folderPath: 'Other / Design', isInbox: false, isSpecialRoot: false, isBookmarksBar: false, index: 1 },
    { id: 'kept', parentId: '2', folderKind: 'folder' as const, title: 'Kept', folderPath: 'Other / Kept', isInbox: false, isSpecialRoot: false, isBookmarksBar: false, index: 2 },
  ];
  const plan = planBookmarkOrganizeRestore(snapshot, liveBookmarks, liveFolders, new Map([['new', 0], ['kept', 2], ['proj', 0]]));
  expect(plan.moves.map((move) => move.id)).toEqual(['b1', 'b2']);
  expect(plan.moves[0]).toMatchObject({ parentId: 'proj', index: 0 });
  expect(plan.deleteFolderIds).toEqual(['new']);
  expect(plan.skipped).toBe(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/bookmark-organize.test.ts -t "restores in original"`
Expected: FAIL — helper missing.

- [ ] **Step 3: Write minimal implementation**

- Skip if live bookmark missing or parent folder missing / `!canFileIntoBookmarkParent`.
- Sort remaining by `parentId` then `index`.
- `deleteFolderIds`: snapshot created ids that exist, `canMutateBookmarkNode`, and `folderChildCounts.get(id) === 0`. After planned moves, treat a created folder as empty only when its **current** count is 0 (test passes `0` for `new`). Do not subtract in-flight restores in this helper — SW refreshes counts after moves before delete.
- Do not put a `deleteFolderId` into any restore `fromParent` journal (this helper does not emit undo).

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/shared/bookmark-organize.test.ts`
Expected: PASS

- [ ] **Step 5: Commit only if the user asked**

---

### Task 5: Topic payload + JSON parse (no network)

**Files:**
- Create: `src/shared/bookmark-organize-ai.ts`
- Create: `src/shared/bookmark-organize-ai.test.ts`
- Modify: `src/shared/ai.ts` — export `requestLocalJson` and `requestCloudJson` (same bodies, just `export`)

**Interfaces:**
- Consumes: Task 1 eligibility, `organizeDestinationFolders`
- Produces:

```ts
export const BOOKMARK_ORGANIZE_ANALYZE_LIMIT = 40;

export function selectAnalyzeBookmarks(
  bookmarks: BookmarkRecord[],
  folders: BookmarkFolderRecord[],
): { eligible: BookmarkRecord[]; analyzed: BookmarkRecord[] }

export function buildTopicAnalyzePayload(
  analyzed: BookmarkRecord[],
  folders: BookmarkFolderRecord[],
  language: Language,
): {
  language: Language
  folders: Array<{ id: string; title: string }>
  bookmarks: Array<{ id: string; title: string; host: string; path: string; folderId: string; folderTitle: string }>
}

export function parseTopicOrganizeJson(raw: unknown): { name: string; bookmarkIds: string[]; folderId?: string }[]

export function topicOrganizePrompt(payload: ReturnType<typeof buildTopicAnalyzePayload>): string
```

Eligible order: Inbox (`isInbox`) and Other-root loose (`parentId === otherBookmarksRootId`) first (id tiebreak), then remaining by parent folder URL-child count desc, then id. `analyzed = eligible.slice(0, 40)`.

`path` = `new URL(url).pathname` only; if parse fails, `''`.

- [ ] **Step 1: Write the failing tests**

```ts
test('caps analyze input at 40 and strips query strings from path', () => {
  const otherChildren = Array.from({ length: 45 }, (_, index) => (
    page(`p${index}`, `https://ex.example/item/${index}?token=secret`, '2', `P${index}`)
  ));
  const { bookmarks, folders } = flattenBookmarkTree(tree(otherChildren));
  const { eligible, analyzed } = selectAnalyzeBookmarks(bookmarks, folders);
  expect(eligible.length).toBe(45);
  expect(analyzed).toHaveLength(40);
  const payload = buildTopicAnalyzePayload(analyzed, folders, 'en');
  expect(payload.bookmarks.every((item) => item.path.startsWith('/item/') && !item.path.includes('token'))).toBe(true);
});

test('parseTopicOrganizeJson keeps well-formed groups and drops garbage', () => {
  expect(parseTopicOrganizeJson(null)).toEqual([]);
  expect(parseTopicOrganizeJson({ groups: [{ name: 'Design', bookmarkIds: ['a'] }] })).toEqual([
    { name: 'Design', bookmarkIds: ['a'] },
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/bookmark-organize-ai.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation**

Prompt system line: classify bookmarks into topic folders; prefer existing folder ids; JSON only; names in `payload.language`. User body = instructions + `JSON.stringify({ folders, bookmarks })`.

Also export:

```ts
export async function requestTopicOrganizeJson(
  payload: ReturnType<typeof buildTopicAnalyzePayload>,
  mode: 'local-model' | 'openai-compatible',
  settings: ZenTabSettings,
  apiKey: string,
): Promise<unknown | null>
```

`local-model` → `requestLocalJson(topicOrganizePrompt(payload), 'You are a careful bookmark librarian.')`.  
`openai-compatible` → `requestCloudJson(..., settings, apiKey, same system string)`.  
One request only (40-cap). Do not loop batches.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/shared/bookmark-organize-ai.test.ts src/shared/ai.test.ts`
Expected: PASS (exporting the JSON helpers must not break tab AI tests)

- [ ] **Step 5: Commit only if the user asked**

---

### Task 6: Storage read/write for snapshots

**Files:**
- Modify: `src/shared/storage.ts`
- Test: `src/shared/storage.test.ts`

**Interfaces:**
- Consumes: Task 2 prune + types
- Produces:

```ts
export const BOOKMARK_ORGANIZE_SNAPSHOTS_KEY = 'zen-tab.bookmark-organize-snapshots';

export async function loadBookmarkOrganizeSnapshots(): Promise<BookmarkOrganizeSnapshot[]>
export async function saveBookmarkOrganizeSnapshots(snapshots: BookmarkOrganizeSnapshot[]): Promise<void>
export async function deleteBookmarkOrganizeSnapshot(id: string): Promise<void>
```

Normalize: keep objects that have `id` string, numeric timestamps, `nodes` array of `{id,parentId,index}`. Drop title/url if a future blob has them. After load, prune with `Date.now()`.

`save`: prune, then if `JSON.stringify` > 500_000 throw `new Error('Organize snapshots are too large.')`.

- [ ] **Step 1: Write a failing storage test** using the existing chrome.storage mock in `storage.test.ts`. Save 4 snapshots, expect 3 after prune. Save an expired one, load returns [].

- [ ] **Step 2: Run** `npx vitest run src/shared/storage.test.ts` — FAIL missing exports.

- [ ] **Step 3: Implement** the three functions next to project-memory helpers.

- [ ] **Step 4: Run** `npx vitest run src/shared/storage.test.ts` — PASS

- [ ] **Step 5: Commit only if the user asked**

---

### Task 7: Apply organize in the service worker

**Files:**
- Modify: `src/shared/types.ts` — add the four messages
- Modify: `src/background/service-worker.ts`
- Modify: `src/shared/bookmark-organize.ts` if you need `finalizeOrganizeSnapshot(snapshot, createdIds, movedCount)`

**Interfaces:**
- Consumes: `constrainOrganizePlan`, `applyBookmarkFiling`, storage helpers
- Produces: `APPLY_BOOKMARK_ORGANIZE` behavior; `applyBookmarkFiling` return `{ moved, skipped, created: Array<{ clientId: string; id: string }> }`; file-undo deletes `organizeSnapshotId`

No SW unit tests (repo norm). Extract snapshot finalize:

```ts
export function finalizeOrganizeSnapshot(
  snapshot: BookmarkOrganizeSnapshot,
  createdFolderIds: string[],
  moveCount: number,
): BookmarkOrganizeSnapshot | null
```

Returns `null` when `createdFolderIds.length === 0 && moveCount === 0`.

- [ ] **Step 1: Write failing test for finalize**

```ts
test('drops an empty organize snapshot after a no-op apply', () => {
  const base = { id: 's', createdAt: 1, expiresAt: 9, moveCount: 2, createdFolderIds: [], nodes: [{ id: 'a', parentId: '2', index: 0 }] };
  expect(finalizeOrganizeSnapshot(base, [], 0)).toBeNull();
  expect(finalizeOrganizeSnapshot(base, ['f'], 0)?.createdFolderIds).toEqual(['f']);
});
```

- [ ] **Step 2: Run** `npx vitest run src/shared/bookmark-organize.test.ts -t "drops an empty"` — FAIL

- [ ] **Step 3: Implement finalize + SW**

`applyBookmarkFiling` changes:
- Return `created: [...createdByClientId].map(([clientId, id]) => ({ clientId, id }))`.
- Optional third arg `{ organizeSnapshotId?: string }`. When set, `persistAction` restoreData is `{ kind: 'file', moves: completed, organizeSnapshotId }`.

`BookmarkUndoData` file kind gains optional `organizeSnapshotId?: string`.

`restoreAction` file branch: after the while-loop succeeds, `if (data.organizeSnapshotId) await deleteBookmarkOrganizeSnapshot(data.organizeSnapshotId)`.

New `applyBookmarkOrganize(creates, moves)`:

1. `hasBookmarksPermission` or throw.
2. Flatten live tree. `constrained = constrainOrganizePlan({ creates, moves }, bookmarks, folders)`. If no creates and no moves, return `{ moved: 0, skipped: 0, created: [], snapshotSaved: false }` without writing a snapshot.
3. `get` each constrained move id; build `nodes` from live URL nodes that still exist. Snapshot id via `createId('organize')`. `saveBookmarkOrganizeSnapshots` after prune-insert. Catch quota/throw → `snapshotSaved = false`, continue.
4. `try { result = await applyBookmarkFiling(constrained.creates, constrained.moves, { organizeSnapshotId: snapshot.id }) } finally { patch or delete via finalizeOrganizeSnapshot using result.created ids + result.moved (0 if throw before result) }`.
5. Return `{ ...result, snapshotSaved }`.

Add messages to `ZenTabMessage`. Add `APPLY_BOOKMARK_ORGANIZE` to `isMutationMessage`. Handle in `handleMessage`.

Inbox `APPLY_BOOKMARK_FILING` path unchanged (no third arg).

- [ ] **Step 4: Run** `npx vitest run src/shared/bookmark-organize.test.ts src/shared/storage.test.ts` and `npm run typecheck`
Expected: PASS / clean typecheck

- [ ] **Step 5: Commit only if the user asked**

---

### Task 8: Analyze (cloud) + restore + list snapshots

**Files:**
- Modify: `src/background/service-worker.ts`

**Interfaces:**
- Consumes: Task 5 AI helpers, Task 3 sanitize/merge, Task 4 restore plan, Task 6 storage
- Produces: `ANALYZE_BOOKMARK_ORGANIZE`, `RESTORE_BOOKMARK_ORGANIZE`, `GET_BOOKMARK_ORGANIZE_SNAPSHOTS`

Analyze (not a mutation) **must** `await mutationQueue` before `getTree`.

```ts
async function analyzeBookmarkOrganize(): Promise<
  | { granted: false }
  | {
    granted: true
    proposal: BookmarkOrganizeProposal
    source: 'topic-model' | 'host-heuristic'
    provider: ProviderCapabilities['name']
    analyzedCount: number
    eligibleCount: number
  }
> {
  await mutationQueue;
  if (!(await hasBookmarksPermission())) return { granted: false };
  const { bookmarks, folders } = flattenBookmarkTree(await chrome.bookmarks.getTree());
  const { eligible, analyzed } = selectAnalyzeBookmarks(bookmarks, folders);
  const host = proposeBookmarkOrganize({ bookmarks, folders });
  const canCloud = settings.aiProvider === 'openai-compatible' && cloudApiKey && await hasCloudPermission();
  if (!canCloud) {
    return { granted: true, proposal: host, source: 'host-heuristic', provider: 'heuristic', analyzedCount: 0, eligibleCount: eligible.length };
  }
  const payload = buildTopicAnalyzePayload(analyzed, folders, settings.language);
  const raw = await requestTopicOrganizeJson(payload, 'openai-compatible', settings, cloudApiKey);
  const topic = sanitizeBookmarkTopicProposal(parseTopicOrganizeJson(raw) ? { groups: parseTopicOrganizeJson(raw) } : {}, bookmarks, folders);
  if (!topic.clusters.length) {
    return { granted: true, proposal: host, source: 'host-heuristic', provider: 'heuristic', analyzedCount: analyzed.length, eligibleCount: eligible.length };
  }
  return {
    granted: true,
    proposal: mergeTopicWithHostOrganize(topic, bookmarks, folders),
    source: 'topic-model',
    provider: 'openai-compatible',
    analyzedCount: analyzed.length,
    eligibleCount: eligible.length,
  };
}
```

Do not run `LanguageModel` here.

Restore:
1. Permission; load snapshots; find id; if missing or `expiresAt <= now`, throw `'That organize snapshot is no longer available.'`
2. Flatten; build `folderChildCounts` from flatten (bookmark + folder children per parentId) **after** computing moves, re-count children after performing moves before delete.
3. `planBookmarkOrganizeRestore`.
4. For each move: `chrome.bookmarks.move(id, { parentId, index })` using `bookmarkMoveIndex` when `live.parentId === parentId`.
5. Refresh children; delete `deleteFolderIds` that are still empty.
6. `deleteBookmarkOrganizeSnapshot`; `clearLastAction()` (do not persist a file journal).
7. Return `{ moved, skipped, deletedFolders }`.

GET: `loadBookmarkOrganizeSnapshots()` then map `toBookmarkOrganizeSnapshotSummary`.

`RESTORE_BOOKMARK_ORGANIZE` is a mutation. ANALYZE and GET are not.

- [ ] **Step 1:** No new pure test required if Task 3–5 cover sanitize/parse. If `parseTopicOrganizeJson` + sanitize wiring is clumsy, add a one-liner helper `topicProposalFromModel(raw, bookmarks, folders)` in `bookmark-organize-ai.ts` and a test that garbage yields empty groups.

- [ ] **Step 2:** Implement the three handlers + `isMutationMessage` entry for restore.

- [ ] **Step 3:** `npm run typecheck`

Expected: clean

- [ ] **Step 4: Commit only if the user asked**

---

### Task 9: Organize sheet UI

**Files:**
- Modify: `src/sidepanel/i18n.ts`
- Modify: `src/sidepanel/BookmarkHealthSheet.tsx`
- Modify: `src/sidepanel/BookmarkList.tsx`
- Modify: `src/sidepanel/App.tsx` only if bookmarks chrome needs `hasCloudApiKey` / settings (prefer passing from `App` → `BookmarkList` via existing props, or read `useStore` / snapshot already in App)

**Interfaces:**
- Consumes: all previous public helpers + messages
- Produces: working Organize sheet

i18n keys (add to the `TranslationKey` union and both `en` / `zh`):

| Key | en | zh |
|---|---|---|
| `organizeByTopic` | Organize by topic | 按主题整理 |
| `organizeAnalyzing` | Finding topic folders… | 正在按主题分组… |
| `organizeNeedsModel` | Topic organize needs an on-device model or an API key in Settings. | 按主题整理需要端侧模型，或在设置里填写 API Key。 |
| `organizeAnalyzedCount` | Analyzed {analyzed} of {eligible} bookmarks | 已分析 {analyzed} / {eligible} 个书签 |
| `organizeShowHostClusters` | Show site groups only | 只看按网站分组 |
| `organizeTopicFailed` | Topic analysis failed. Site groups are still available. | 主题分析失败，仍可使用按网站分组。 |
| `organizeSnapshotsTitle` | Restore points | 可还原的整理 |
| `organizeSnapshotMeta` | {count} bookmarks · {days} days left | {count} 个书签 · 剩余 {days} 天 |
| `organizeRestore` | Restore | 还原 |
| `organizeRestoreConfirm` | Move these bookmarks back to where they were at {time}? Bookmarks you moved afterward will also go back. | 把这些书签移回 {time} 时的位置？之后你手动挪过的也会一起回去。 |
| `organizeRestored` | Restored {count} bookmarks. | 已还原 {count} 个书签。 |
| `organizeSnapshotSaveFailed` | Organized, but the 7-day restore point could not be saved. | 已整理，但 7 天还原点保存失败。 |
| `organizeNothingToApply` | Nothing to apply. | 没有可应用的改动。 |

`BookmarkHealthSheet` props (replace host-only apply):

```ts
{
  bookmarks, folders, inboxCount, groups, t, busy,
  topicReady: boolean
  analyzing: boolean
  topicResult: null | { proposal: BookmarkOrganizeProposal; analyzedCount: number; eligibleCount: number }
  snapshots: BookmarkOrganizeSnapshotSummary[]
  language: Language
  onClose, onApplyDedup, onApplyOrganize, onReviewInbox,
  onAnalyzeTopic, onClearTopic, onRestoreSnapshot
}
```

When `topicResult` is set, render those clusters first (badge still New/Existing), then leftover host clusters from `proposeBookmarkOrganize` filtered to ids not in the topic proposal (or just render `topicResult.proposal.clusters` because merge already happened). Show analyzed count. Show “Show site groups only” → `onClearTopic`.

Topic button: `disabled={!topicReady || busy}`; hidden hint when `!topicReady`.

All buttons disabled when `analyzing || busy`.

Snapshot section: `snapshots.filter(s => s.expiresAt > Date.now() && daysLeft >= 1)`. `daysLeft = Math.ceil((expiresAt - now) / 86400000)`.

`BookmarkList`:
- `analyzeGen` ref. `openOrganize` fetches snapshots.
- `applyOrganizeFiling` sends **displayed** plan (`topicResult?.proposal ?? proposeBookmarkOrganize(...)`) via `APPLY_BOOKMARK_ORGANIZE`. Toast `organizeSnapshotSaveFailed` when `snapshotSaved === false` and `moved > 0`.
- Local analyze: if built-in `available` and not cloud-ready, `getBuiltInAiStatus` + `requestTopicOrganizeJson(..., 'local-model', settings, '')`, then sanitize+merge in the panel. Cloud-ready: `ANALYZE_BOOKMARK_ORGANIZE`.
- Cloud-ready: `aiProvider === 'openai-compatible' && hasCloudApiKey`. Host permission is enforced in SW; if analyze returns host-heuristic with eligibleCount > 0 after a cloud click, toast `organizeTopicFailed` and do not swap.
- On close / apply / revoke: `analyzeGen += 1`.
- Restore: `window.confirm` then `RESTORE_BOOKMARK_ORGANIZE`.

Pass `hasCloudApiKey` and `settings` into `BookmarkList` from `App.tsx` (snapshot already there).

- [ ] **Step 1:** Add i18n keys so `tsc` fails if a language is missing.

- [ ] **Step 2:** Wire sheet + list. Do not put `chrome.bookmarks` in the panel.

- [ ] **Step 3:** `npm test && npm run typecheck && npm run build`

Expected: tests PASS, typecheck clean, `dist/` rebuilt.

- [ ] **Step 4:** Manual check after loading unpacked `dist/`: Organize shows host groups; topic button disabled without model; with model, analyze then apply writes folders; Restore appears; ⌘Z within 30s removes the restore point.

- [ ] **Step 5: Commit only if the user asked**

---

## Self-review

**Spec coverage**
- Topic vs host, preview-then-write, no panel `chrome.bookmarks.*` → Tasks 5, 8, 9
- Local model in panel / cloud in SW / no `proposeProjects` → Tasks 5, 8, 9
- Full bar skip + inbox sources + reserved Inbox name → Tasks 1, 3
- 40-cap + path-only + leftover host merge + analyzed N of M → Tasks 3, 5, 9
- Snapshot compact / 7d / cap 3 / byte cap / apply-time constrain / patch after partial → Tasks 2, 3, 6, 7
- ⌘Z deletes snapshot; restore indexed move + clear last-action → Tasks 4, 7, 8
- Inbox stays FILING → Task 7, 9
- UI states + confirm copy → Task 9

**Placeholders:** none

**Type names used later match earlier tasks:** `BookmarkOrganizeSnapshot`, `sanitizeBookmarkTopicProposal`, `mergeTopicWithHostOrganize`, `constrainOrganizePlan`, `planBookmarkOrganizeRestore`, `selectAnalyzeBookmarks`, `APPLY_BOOKMARK_ORGANIZE`.
