# Bookmark management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chrome-parity bookmark tree in the side panel (index-order drag, folder/bookmark CRUD) plus preview-then-write Inbox filing, health report, and Markdown/Netscape export.

**Architecture:** `chrome.bookmarks` stays the only tree of record. Flatten gains `folderKind` / `index` / `unmodifiable`. The forest mixes children by Chrome index. Tree writes go through new SW messages on `isMutationMessage`. Organize actions build a React plan and call `APPLY_BOOKMARK_FILING` or `APPLY_BOOKMARK_DEDUP` only on confirm. Tab drop stays `CREATE_BOOKMARKS`. Bookmark drag uses a discriminated payload so it cannot be parsed as a tab.

**Tech Stack:** Chrome MV3 `bookmarks` API, React 18 side panel, existing dnd-kit session, Vitest, `en`/`zh` `i18n.ts`.

**Spec:** `docs/superpowers/specs/2026-09-11-bookmark-management-design.md`

## Global Constraints

- Do not replace `chrome://bookmarks`, generate a Rico site, add tags, or scan dead links.
- Organize writes (filing, dedup) are preview-then-write. Tree ops write immediately.
- Side panel must not call `chrome.bookmarks.*`. All bookmark writes go through the service worker.
- Tab drop / `fileDroppedTab` stays `CREATE_BOOKMARKS`. Never wire it to `FILE_BOOKMARKS`.
- `eligibleFolders` stays non-special + non-inbox (Bookmarks bar excluded) unless a later spec amends it.
- Non-empty unified search still unmounts `BookmarkList`. Chips only exist when search is empty.
- Keep Sparkles enrich / `zen-tab.bookmark-summaries`.
- Export uses blob + `<a download>`. Do not add the `downloads` permission.
- Auto-file on `bookmarks.onCreated` stays until Task 11.
- TDD for every new helper. Run the exact vitest command in the task.
- Do not commit unless the user asks.
- Work from `/Users/mingjie/Documents/github/personal-projects/chrome-ext/zen-tab`.
- Do not edit `docs/plan/`.

## File map

| File | Responsibility |
|---|---|
| `src/shared/types.ts` | `BookmarkFolderKind`, record fields, new `ZenTabMessage`s |
| `src/shared/bookmarks.ts` | flatten flags; `otherBookmarksRootId`; `canMutateBookmarkNode`; `bookmarkMoveIndex`; `isBookmarkMoveCycle` |
| `src/shared/bookmark-tree.ts` | mixed-index forest; skip only Other root |
| `src/shared/bookmark-dnd.ts` | bookmark drag ids + `resolveBookmarkDragEnd` |
| `src/shared/bookmark-filing.ts` | filing-plan create-then-move resolution |
| `src/shared/bookmark-created.ts` | `decideCreatedBookmarkAction` (never auto-file) |
| `src/shared/bookmark-export.ts` | Markdown, Netscape, parse helper |
| `src/shared/tab-dnd.ts` | do not parse `bookmark-row-` / `bookmark-folder-row-` as folder headers |
| `src/background/service-worker.ts` | new messages, undo kinds, `permissions.onRemoved`, stop auto-file in Task 11 |
| `src/sidepanel/context-menu.ts` | parameterized bookmark menus |
| `src/sidepanel/i18n.ts` | new strings |
| `src/sidepanel/BookmarkList.tsx` | tree, chips, sheets, keep enrich |
| `src/sidepanel/BookmarkEditPanel.tsx` | title/URL edit |
| `src/sidepanel/BookmarkFilingSheet.tsx` | Inbox review (Task 13) |
| `src/sidepanel/BookmarkHealthSheet.tsx` | health report (Task 14) |
| `src/sidepanel/BookmarkExportSheet.tsx` | export (Task 15) |
| `src/sidepanel/file-dropped-tab.ts` | unchanged |

---

### Task 1: Flatten `folderKind`, `index`, `unmodifiable`

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/bookmarks.ts`
- Modify: `src/shared/bookmarks.test.ts`
- Modify: `src/shared/bookmark-tree.test.ts` (fixture defaults only)

**Interfaces:**
- Produces:
```ts
export type BookmarkFolderKind = 'bar' | 'other' | 'mobile' | 'managed' | 'folder';

export type BookmarkRecord = {
  /* existing fields */
  folderKind: BookmarkFolderKind;
  index: number;
  unmodifiable?: 'managed';
};

export type BookmarkFolderRecord = {
  /* existing fields */
  folderKind: BookmarkFolderKind;
  index: number;
  unmodifiable?: 'managed';
};
```
- `folderKind` on a folder is that node’s kind (`rootKind` + managed). On a bookmark it is the nearest special-root ancestor, or `'folder'`.
- `index` is `node.index ?? 0`.
- Copy Chrome `unmodifiable` onto every emitted node.
- `rootKind` also returns `'managed'` when `folderType === 'managed'` or `unmodifiable === 'managed'`.
- `isSpecialRoot` stays true for bar/other/mobile/managed and direct children of the invisible root.

- [ ] **Step 1: Write the failing test**

Add to `src/shared/bookmarks.test.ts` inside `describe('flattenBookmarkTree')`. Extend the local `Node` type:

```ts
type Node = chrome.bookmarks.BookmarkTreeNode & {
  folderType?: 'bookmarks-bar' | 'other' | 'mobile' | 'managed';
  unmodifiable?: 'managed';
  children?: Node[];
};
```

```ts
test('attaches folderKind, index, and unmodifiable', () => {
  const roots: Node[] = [{
    id: '0',
    title: '',
    children: [
      { id: '1', parentId: '0', title: 'Bookmarks Bar', index: 0, folderType: 'bookmarks-bar', children: [] },
      {
        id: '2',
        parentId: '0',
        title: 'Other Bookmarks',
        index: 1,
        folderType: 'other',
        children: [
          { id: 'eng', parentId: '2', title: 'Engineering', index: 2, children: [
            { id: 'doc', parentId: 'eng', title: 'Doc', url: 'https://doc.example', index: 0 },
          ] },
        ],
      },
      { id: '3', parentId: '0', title: 'Mobile Bookmarks', index: 2, folderType: 'mobile', children: [
        { id: 'm1', parentId: '3', title: 'Phone', url: 'https://m.example', index: 0 },
      ] },
      {
        id: '99',
        parentId: '0',
        title: 'Managed Bookmarks',
        index: 3,
        folderType: 'managed',
        unmodifiable: 'managed',
        children: [
          { id: 'policy', parentId: '99', title: 'Policy', url: 'https://policy.example', index: 0, unmodifiable: 'managed' },
        ],
      },
    ],
  }];

  const { folders, bookmarks } = flattenBookmarkTree(roots);
  expect(folders.find((folder) => folder.id === '1')).toMatchObject({ folderKind: 'bar', index: 0, isSpecialRoot: true });
  expect(folders.find((folder) => folder.id === '2')).toMatchObject({ folderKind: 'other', index: 1, isSpecialRoot: true });
  expect(folders.find((folder) => folder.id === '3')).toMatchObject({ folderKind: 'mobile', index: 2, isSpecialRoot: true });
  expect(folders.find((folder) => folder.id === '99')).toMatchObject({
    folderKind: 'managed',
    index: 3,
    isSpecialRoot: true,
    unmodifiable: 'managed',
  });
  expect(folders.find((folder) => folder.id === 'eng')).toMatchObject({ folderKind: 'folder', index: 2 });
  expect(bookmarks.find((item) => item.id === 'doc')).toMatchObject({ folderKind: 'other', index: 0, isInbox: false });
  expect(bookmarks.find((item) => item.id === 'm1')).toMatchObject({ folderKind: 'mobile', index: 0, isInbox: false });
  expect(bookmarks.find((item) => item.id === 'policy')).toMatchObject({
    folderKind: 'managed',
    unmodifiable: 'managed',
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/bookmarks.test.ts`
Expected: FAIL — `folderKind` undefined on records.

- [ ] **Step 3: Write minimal implementation**

In `src/shared/types.ts` add `BookmarkFolderKind` and the three fields on both records (`index` required, use `node.index ?? 0` in flatten).

In `src/shared/bookmarks.ts` change `rootKind` to return `'bar' | 'other' | 'mobile' | 'managed' | null` including managed. Thread `inheritedKind` into `visit`:

```ts
const ownKind = rootKind(node);
const childKind = ownKind ?? parentKind;
```

When pushing a bookmark:

```ts
folderKind: parentKind ?? 'folder',
index: node.index ?? 0,
...(node.unmodifiable === 'managed' ? { unmodifiable: 'managed' as const } : {}),
```

When pushing a folder:

```ts
folderKind: ownKind ?? (node.unmodifiable === 'managed' ? 'managed' : 'folder'),
index: node.index ?? 0,
...(node.unmodifiable === 'managed' ? { unmodifiable: 'managed' as const } : {}),
```

Pass `childKind` to children (not `ownKind` alone) so Engineering under Other yields bookmark `folderKind: 'other'`.

- [ ] **Step 4: Update fixtures and re-run**

In `src/shared/bookmark-tree.test.ts` helper defaults:

```ts
function folder(overrides: Partial<BookmarkFolderRecord> & Pick<BookmarkFolderRecord, 'id' | 'title'>): BookmarkFolderRecord {
  return {
    folderPath: overrides.title,
    isInbox: false,
    isSpecialRoot: false,
    isBookmarksBar: false,
    folderKind: 'folder',
    index: 0,
    ...overrides,
  };
}

function bookmark(overrides: Partial<BookmarkRecord> & Pick<BookmarkRecord, 'id' | 'parentId' | 'title'>): BookmarkRecord {
  return {
    url: `https://example.com/${overrides.id}`,
    folderPath: overrides.title,
    isInbox: false,
    isBookmarksBar: false,
    folderKind: 'folder',
    index: 0,
    ...overrides,
  };
}
```

Set `folderKind: 'bar'` on `bar`, `'other'` on `other`. Existing flatten tests must still pass (add `folderKind` only to the new test).

Run: `npx vitest run src/shared/bookmarks.test.ts src/shared/bookmark-tree.test.ts`
Expected: PASS

- [ ] **Step 5:** Skip commit unless the user asks.

---

### Task 2: Forest by Chrome index; show Mobile and Managed

**Files:**
- Modify: `src/shared/bookmark-tree.ts`
- Modify: `src/shared/bookmark-tree.test.ts`

**Interfaces:**
- Consumes: Task 1 `folderKind` / `index` on records
- Produces: `buildBookmarkForest` mixed children sorted by `index`; skips only `folderKind === 'other'` as a row; Mobile and Managed are visible roots; Inbox still `inboxBookmarks()` (mobile loose URLs excluded because `isInbox` is false)

- [ ] **Step 1: Write the failing tests**

Add to `src/shared/bookmark-tree.test.ts`:

```ts
test('mixes folders and bookmarks by index', () => {
  const parent = folder({ id: 'p', parentId: '2', title: 'P', folderPath: '其他书签 / P', folderKind: 'folder' });
  const zebra = folder({ id: 'z', parentId: 'p', title: 'Zebra', index: 1, folderPath: '其他书签 / P / Zebra' });
  const alpha = bookmark({ id: 'a', parentId: 'p', title: 'Alpha', index: 0 });
  const forest = buildBookmarkForest([other, parent, zebra], [alpha]);
  const kids = forest[0].kind === 'folder' ? forest[0].children : [];
  expect(kids.map((node) => node.kind === 'folder' ? node.folder.id : node.bookmark.id)).toEqual(['a', 'z']);
});

test('shows Mobile as a folder and keeps mobile URLs out of the inbox tray', () => {
  const mobile = folder({
    id: '3',
    parentId: '0',
    title: 'Mobile Bookmarks',
    folderPath: 'Mobile Bookmarks',
    isSpecialRoot: true,
    folderKind: 'mobile',
    index: 2,
  });
  const phone = bookmark({
    id: 'm1',
    parentId: '3',
    title: 'Phone',
    folderKind: 'mobile',
    isInbox: false,
  });
  expect(inboxBookmarks([phone], [mobile, other])).toEqual([]);
  const forest = buildBookmarkForest([bar, other, mobile], [phone]);
  expect(forest.some((node) => node.kind === 'folder' && node.folder.id === '3')).toBe(true);
  expect(forest.find((node) => node.kind === 'folder' && node.folder.id === '3')).toMatchObject({
    count: 1,
    children: [{ kind: 'bookmark', bookmark: phone }],
  });
});

test('shows Managed as a read-only root', () => {
  const managed = folder({
    id: '99',
    parentId: '0',
    title: 'Managed Bookmarks',
    folderPath: 'Managed Bookmarks',
    isSpecialRoot: true,
    folderKind: 'managed',
    unmodifiable: 'managed',
    index: 3,
  });
  const policy = bookmark({
    id: 'policy',
    parentId: '99',
    title: 'Policy',
    folderKind: 'managed',
    unmodifiable: 'managed',
  });
  const forest = buildBookmarkForest([bar, other, managed], [policy]);
  expect(forest.some((node) => node.kind === 'folder' && node.folder.id === '99')).toBe(true);
});
```

- [ ] **Step 2:** `npx vitest run src/shared/bookmark-tree.test.ts` — expect FAIL (Mobile still skipped; children title-sorted folders-first)

- [ ] **Step 3: Implement**

Replace `isSkippedSpecialRoot` with:

```ts
function isHiddenRoot(folder: BookmarkFolderRecord): boolean {
  return folder.folderKind === 'other';
}
```

Use `isHiddenRoot` everywhere `isSkippedSpecialRoot` was used.

`buildFolderNode`: build one mixed list:

```ts
const mixed: BookmarkForestNode[] = [
  ...(childFolders.get(folder.id) ?? []).map((child) => buildFolderNode(child, childFolders, childBookmarks)),
  ...(childBookmarks.get(folder.id) ?? []).map((item) => ({ kind: 'bookmark' as const, bookmark: item })),
].sort((left, right) => {
  const leftIndex = left.kind === 'folder' ? left.folder.index : left.bookmark.index;
  const rightIndex = right.kind === 'folder' ? right.folder.index : right.bookmark.index;
  return leftIndex - rightIndex
    || (left.kind === 'folder' ? left.folder.id : left.bookmark.id)
      .localeCompare(right.kind === 'folder' ? right.folder.id : right.bookmark.id);
});
```

Root order: Bookmarks bar folders, then Other’s child folders by `index`, then Mobile, then Managed. Do not title-sort roots. Do not push Other itself.

Inbox: do not change `inboxBookmarks` beyond using flatten’s `isInbox: false` on mobile URLs. Keep the existing inbox vs nested Other test.

Update the “count includes nested” test if child order changes (sibling vs child folder): set explicit indexes so the assertion stays valid (`sibling.index = 0`, `child.index = 1` or the reverse).

- [ ] **Step 4:** `npx vitest run src/shared/bookmark-tree.test.ts` — expect PASS

- [ ] **Step 5:** Skip commit unless the user asks.

---

### Task 3: Mutation and move helpers

**Files:**
- Modify: `src/shared/bookmarks.ts`
- Modify: `src/shared/bookmarks.test.ts`

**Interfaces:**
- Consumes: Task 1 `folderKind` / `unmodifiable`
- Produces:
```ts
export function otherBookmarksRootId(folders: BookmarkFolderRecord[]): string | undefined

export function canMutateBookmarkNode(node: {
  folderKind: BookmarkFolderKind;
  unmodifiable?: 'managed';
}): boolean

export function bookmarkMoveIndex(input: {
  fromIndex: number;
  targetIndex: number;
  placement: 'before' | 'after';
  sameParent: boolean;
}): number

export function isBookmarkMoveCycle(
  movingFolderId: string,
  destParentId: string,
  folders: BookmarkFolderRecord[],
): boolean
```

- `otherBookmarksRootId` → id of the folder with `folderKind === 'other'` (first if multiple).
- `canMutateBookmarkNode` → false when `folderKind` is `bar|other|mobile|managed` **or** `unmodifiable === 'managed'`.
- `bookmarkMoveIndex`: `desired = placement === 'after' ? targetIndex + 1 : targetIndex`; if `sameParent && fromIndex < desired` then `desired -= 1`.
- `isBookmarkMoveCycle` → true if `destParentId === movingFolderId` or `destParentId` is a descendant of `movingFolderId` (walk `parentId`).

- [ ] **Step 1: Write the failing tests**

```ts
import {
  bookmarkMoveIndex,
  canMutateBookmarkNode,
  isBookmarkMoveCycle,
  otherBookmarksRootId,
} from './bookmarks';

describe('otherBookmarksRootId', () => {
  test('finds Other by folderKind, not id 2', () => {
    const folders = [
      { id: 'bar', folderKind: 'bar' as const, title: 'Bar', folderPath: 'Bar', isInbox: false, isSpecialRoot: true, isBookmarksBar: true, index: 0 },
      { id: 'other-root', folderKind: 'other' as const, title: '其他书签', folderPath: '其他书签', isInbox: false, isSpecialRoot: true, isBookmarksBar: false, index: 1 },
    ];
    expect(otherBookmarksRootId(folders)).toBe('other-root');
    expect(otherBookmarksRootId([])).toBeUndefined();
  });
});

describe('canMutateBookmarkNode', () => {
  test('rejects special roots and managed descendants', () => {
    expect(canMutateBookmarkNode({ folderKind: 'folder' })).toBe(true);
    expect(canMutateBookmarkNode({ folderKind: 'bar' })).toBe(false);
    expect(canMutateBookmarkNode({ folderKind: 'other' })).toBe(false);
    expect(canMutateBookmarkNode({ folderKind: 'mobile' })).toBe(false);
    expect(canMutateBookmarkNode({ folderKind: 'managed' })).toBe(false);
    expect(canMutateBookmarkNode({ folderKind: 'folder', unmodifiable: 'managed' })).toBe(false);
  });
});

describe('bookmarkMoveIndex', () => {
  test('same-parent after / before and cross-parent', () => {
    expect(bookmarkMoveIndex({ fromIndex: 1, targetIndex: 3, placement: 'after', sameParent: true })).toBe(3);
    expect(bookmarkMoveIndex({ fromIndex: 1, targetIndex: 3, placement: 'before', sameParent: true })).toBe(2);
    expect(bookmarkMoveIndex({ fromIndex: 3, targetIndex: 1, placement: 'before', sameParent: true })).toBe(1);
    expect(bookmarkMoveIndex({ fromIndex: 1, targetIndex: 2, placement: 'after', sameParent: false })).toBe(3);
  });
});

describe('isBookmarkMoveCycle', () => {
  test('rejects drop into self or descendant', () => {
    const folders = [
      { id: 'p', parentId: '2', title: 'P', folderPath: 'P', isInbox: false, isSpecialRoot: false, isBookmarksBar: false, folderKind: 'folder' as const, index: 0 },
      { id: 'c', parentId: 'p', title: 'C', folderPath: 'P / C', isInbox: false, isSpecialRoot: false, isBookmarksBar: false, folderKind: 'folder' as const, index: 0 },
    ];
    expect(isBookmarkMoveCycle('p', 'p', folders)).toBe(true);
    expect(isBookmarkMoveCycle('p', 'c', folders)).toBe(true);
    expect(isBookmarkMoveCycle('c', 'p', folders)).toBe(false);
    expect(isBookmarkMoveCycle('c', '2', folders)).toBe(false);
  });
});
```

- [ ] **Step 2:** `npx vitest run src/shared/bookmarks.test.ts` — expect FAIL (exports missing)

- [ ] **Step 3: Implement** the four functions in `src/shared/bookmarks.ts`. Export them.

- [ ] **Step 4:** `npx vitest run src/shared/bookmarks.test.ts` — expect PASS

- [ ] **Step 5:** Skip commit unless the user asks.

---

### Task 4: Move-undo helper (do not reuse file undo)

**Files:**
- Modify: `src/shared/bookmarks.ts`
- Modify: `src/shared/bookmarks.test.ts`

**Interfaces:**
- Produces:
```ts
export type BookmarkIndexMove = {
  id: string;
  fromParentId: string;
  fromIndex: number;
  toParentId: string;
  toIndex: number;
};

export function shouldRestoreMovedBookmark(
  move: BookmarkIndexMove,
  liveNode: { parentId?: string; index?: number } | undefined,
): boolean
```

- True only when `liveNode` exists AND (`liveNode.parentId !== move.fromParentId` OR `liveNode.index !== move.fromIndex`) AND `liveNode.parentId === move.toParentId` AND `liveNode.index === move.toIndex`.
- Missing node → false (skip, do not throw).
- `shouldRestoreFiledBookmark` stays unchanged (parent must have changed).

- [ ] **Step 1: Write the failing test**

```ts
test('shouldRestoreMovedBookmark restores same-parent index changes', () => {
  const move = { id: 'b', fromParentId: 'p', fromIndex: 2, toParentId: 'p', toIndex: 0 };
  expect(shouldRestoreMovedBookmark(move, { parentId: 'p', index: 0 })).toBe(true);
  expect(shouldRestoreMovedBookmark(move, { parentId: 'p', index: 2 })).toBe(false);
  expect(shouldRestoreMovedBookmark(move, undefined)).toBe(false);
  expect(shouldRestoreFiledBookmark(
    { id: 'b', fromParentId: 'p', fromIndex: 2, toParentId: 'p' },
    { id: 'b', parentId: 'p' } as chrome.bookmarks.BookmarkTreeNode,
  )).toBe(false);
});
```

- [ ] **Step 2:** `npx vitest run src/shared/bookmarks.test.ts` — expect FAIL

- [ ] **Step 3: Implement** `shouldRestoreMovedBookmark` and export `BookmarkIndexMove`.

- [ ] **Step 4:** Re-run — expect PASS

- [ ] **Step 5:** Skip commit unless the user asks.

---

### Task 5: Parameterized bookmark context menus

**Files:**
- Modify: `src/sidepanel/context-menu.ts`
- Modify: `src/sidepanel/context-menu.test.ts`
- Modify: `src/sidepanel/BookmarkList.tsx` (call sites only, so typecheck passes)
- Modify: `src/sidepanel/i18n.ts` (keys used by the new items)

**Interfaces:**
- Consumes: existing `ContextMenuSpec`
- Produces:
```ts
export function buildBookmarkRowContextSpecs(input: {
  t: Translator;
  isInbox: boolean;
  canMutate: boolean;
}): ContextMenuSpec[]

export function buildBookmarkGroupContextSpecs(input: {
  t: Translator;
  collapsed: boolean;
  canMutate: boolean;
  isSpecialRoot: boolean;
}): ContextMenuSpec[]
```

Row: always `open`. If `canMutate`: `edit`, `delete`. If `isInbox`: `file` after `open` (before edit).  
Folder: `expand` or `collapse`, then `open-all`. If `canMutate && !isSpecialRoot`: `new-folder`, `rename`, `delete`.

- [ ] **Step 1: Write the failing test**

Replace the existing bookmark menu test in `src/sidepanel/context-menu.test.ts` with:

```ts
it('builds bookmark row and folder menus from mutate + inbox flags', () => {
  expect(buildBookmarkRowContextSpecs({ t, isInbox: false, canMutate: false }).map((item) => item.id))
    .toEqual(['open']);
  expect(buildBookmarkRowContextSpecs({ t, isInbox: true, canMutate: true }).map((item) => item.id))
    .toEqual(['open', 'file', 'edit', 'delete']);
  expect(buildBookmarkGroupContextSpecs({ t, collapsed: false, canMutate: true, isSpecialRoot: false }).map((item) => item.id))
    .toEqual(['collapse', 'open-all', 'new-folder', 'rename', 'delete']);
  expect(buildBookmarkGroupContextSpecs({ t, collapsed: true, canMutate: false, isSpecialRoot: true }).map((item) => item.id))
    .toEqual(['expand', 'open-all']);
});
```

- [ ] **Step 2:** `npx vitest run src/sidepanel/context-menu.test.ts` — expect FAIL

- [ ] **Step 3: Implement** the new signatures. Add i18n keys (en + zh) and the `TranslationKey` union members:

| key | en | zh |
|---|---|---|
| `editBookmark` | Edit | 编辑 |
| `deleteBookmark` | Delete | 删除 |
| `newBookmarkFolder` | New folder | 新建文件夹 |
| `renameBookmarkFolder` | Rename | 重命名 |
| `deleteBookmarkFolder` | Delete folder | 删除文件夹 |
| `openAllBookmarks` | Open all | 全部打开 |

Update `BookmarkList.tsx` call sites to pass `canMutate` / `isSpecialRoot` so `tsc` does not fail (behavior can still be expand-only until Task 9).

- [ ] **Step 4:** `npx vitest run src/sidepanel/context-menu.test.ts` — expect PASS

- [ ] **Step 5:** Skip commit unless the user asks.

---

### Task 6: Bookmark drag resolve

**Files:**
- Create: `src/shared/bookmark-dnd.ts`
- Create: `src/shared/bookmark-dnd.test.ts`
- Modify: `src/shared/tab-dnd.ts`
- Modify: `src/shared/tab-dnd.test.ts` (add the prefix collision case)

**Interfaces:**
- Consumes: `DragSurface` from `tab-dnd.ts`; Task 3 helpers
- Produces:
```ts
export type BookmarkDragSource =
  | { type: 'bookmark'; id: string }
  | { type: 'folder'; id: string };

export type BookmarkDragOver =
  | DragSurface
  | { kind: 'bookmark-row'; id: string; parentId: string; index: number }
  | { kind: 'bookmark-folder-row'; id: string; parentId: string; index: number };

export type BookmarkDragEndResult =
  | { type: 'none' }
  | { type: 'move'; id: string; parentId: string; index?: number };

export function formatBookmarkRowId(id: string): string // `bookmark-row-${id}`
export function formatBookmarkFolderRowId(id: string): string // `bookmark-folder-row-${id}`
export function parseBookmarkDragSource(id: string): BookmarkDragSource | null

export function resolveBookmarkDragEnd(input: {
  source: BookmarkDragSource;
  over: BookmarkDragOver | null;
  placement?: 'before' | 'after';
  otherBookmarksRootId: string | undefined;
  folders: BookmarkFolderRecord[];
  siblings: Array<{ id: string; index: number; parentId: string }>;
}): BookmarkDragEndResult
```

Rules:
- `over` null / `stash` / `tab` / `group` / `ungrouped` / `list-end` / `bookmark-nav` → `{ type: 'none' }`
- `bookmark-inbox` → `{ type: 'move', id, parentId: otherBookmarksRootId }` (no index). If no other root → `none`
- `bookmark-folder` → move into that folder if `canMutateBookmarkNode` on that folder and not `isBookmarkMoveCycle`. Else `none`. Managed folder → `none`
- `bookmark-row` / `bookmark-folder-row` → `parentId` of the over row; `index` from `bookmarkMoveIndex` using `source`’s sibling index vs over.index. If source is a folder and cycle → `none`
- Source folder dropping on Inbox → move folder to Other root (same as URL)

`parseTabDragId`: if `id.startsWith('bookmark-folder-row-')` or `id.startsWith('bookmark-row-')` return `null` **before** the `bookmark-folder-` branch.

- [ ] **Step 1: Write the failing tests**

`src/shared/bookmark-dnd.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { parseTabDragId } from './tab-dnd';
import {
  formatBookmarkFolderRowId,
  formatBookmarkRowId,
  parseBookmarkDragSource,
  resolveBookmarkDragEnd,
} from './bookmark-dnd';

const folders = [
  { id: '2', folderKind: 'other' as const, title: 'Other', folderPath: 'Other', isInbox: false, isSpecialRoot: true, isBookmarksBar: false, index: 1 },
  { id: 'eng', parentId: '2', folderKind: 'folder' as const, title: 'Eng', folderPath: 'Other / Eng', isInbox: false, isSpecialRoot: false, isBookmarksBar: false, index: 0 },
  { id: '99', folderKind: 'managed' as const, title: 'Managed', folderPath: 'Managed', isInbox: false, isSpecialRoot: true, isBookmarksBar: false, index: 3, unmodifiable: 'managed' as const },
];

describe('bookmark drag ids', () => {
  test('do not collide with folder header ids', () => {
    expect(formatBookmarkRowId('abc')).toBe('bookmark-row-abc');
    expect(formatBookmarkFolderRowId('eng')).toBe('bookmark-folder-row-eng');
    expect(parseBookmarkDragSource('bookmark-row-abc')).toEqual({ type: 'bookmark', id: 'abc' });
    expect(parseBookmarkDragSource('bookmark-folder-row-eng')).toEqual({ type: 'folder', id: 'eng' });
    expect(parseTabDragId('bookmark-folder-row-eng')).toBeNull();
    expect(parseTabDragId('bookmark-row-abc')).toBeNull();
    expect(parseTabDragId('bookmark-folder-eng')).toEqual({ kind: 'bookmark-folder', folderId: 'eng' });
  });
});

describe('resolveBookmarkDragEnd', () => {
  const siblings = [
    { id: 'a', index: 0, parentId: 'eng' },
    { id: 'b', index: 1, parentId: 'eng' },
  ];

  test('inbox appends to Other root; nav and stash are none', () => {
    expect(resolveBookmarkDragEnd({
      source: { type: 'bookmark', id: 'a' },
      over: { kind: 'bookmark-inbox' },
      otherBookmarksRootId: '2',
      folders,
      siblings,
    })).toEqual({ type: 'move', id: 'a', parentId: '2' });
    expect(resolveBookmarkDragEnd({
      source: { type: 'bookmark', id: 'a' },
      over: { kind: 'bookmark-nav' },
      otherBookmarksRootId: '2',
      folders,
      siblings,
    })).toEqual({ type: 'none' });
    expect(resolveBookmarkDragEnd({
      source: { type: 'bookmark', id: 'a' },
      over: { kind: 'stash' },
      otherBookmarksRootId: '2',
      folders,
      siblings,
    })).toEqual({ type: 'none' });
  });

  test('rejects managed and folder cycles', () => {
    expect(resolveBookmarkDragEnd({
      source: { type: 'bookmark', id: 'a' },
      over: { kind: 'bookmark-folder', folderId: '99' },
      otherBookmarksRootId: '2',
      folders,
      siblings,
    })).toEqual({ type: 'none' });
    expect(resolveBookmarkDragEnd({
      source: { type: 'folder', id: 'eng' },
      over: { kind: 'bookmark-folder', folderId: 'eng' },
      otherBookmarksRootId: '2',
      folders,
      siblings,
    })).toEqual({ type: 'none' });
  });

  test('reorders with chrome move index', () => {
    expect(resolveBookmarkDragEnd({
      source: { type: 'bookmark', id: 'a' },
      over: { kind: 'bookmark-row', id: 'b', parentId: 'eng', index: 1 },
      placement: 'after',
      otherBookmarksRootId: '2',
      folders,
      siblings,
    })).toEqual({ type: 'move', id: 'a', parentId: 'eng', index: 1 });
  });
});
```

- [ ] **Step 2:** `npx vitest run src/shared/bookmark-dnd.test.ts src/shared/tab-dnd.test.ts` — expect FAIL (module missing)

- [ ] **Step 3: Implement** `bookmark-dnd.ts` and the `parseTabDragId` guard.

- [ ] **Step 4:** Re-run those two files — expect PASS

- [ ] **Step 5:** Skip commit unless the user asks.

---

### Task 7: Service worker tree messages + undo + permission revoke

**Files:**
- Modify: `src/shared/types.ts` (`ZenTabMessage`)
- Modify: `src/background/service-worker.ts`

**Interfaces:**
- Consumes: Task 3–4 helpers; existing `runBookmarkBatch`, `hasBookmarksPermission`, `persistAction`, `exemptFromDuplicateGuard`, `flattenBookmarkTree`
- Produces messages:
```ts
| { type: 'UPDATE_BOOKMARK'; id: string; title: string; url?: string }
| { type: 'REMOVE_BOOKMARK'; id: string }
| { type: 'CREATE_BOOKMARK_FOLDER'; parentId: string; title: string }
| { type: 'REMOVE_BOOKMARK_FOLDER'; id: string }
| { type: 'MOVE_BOOKMARK'; id: string; parentId: string; index?: number }
| { type: 'OPEN_BOOKMARK_URLS'; urls: string[] }
```

`BookmarkUndoData` (SW-local) adds:

```ts
| { kind: 'move'; moves: BookmarkIndexMove[] }
| { kind: 'edit'; id: string; previousTitle: string; previousUrl?: string }
| { kind: 'folder-create'; id: string }
```

Every new write type (not `OPEN_BOOKMARK_URLS`) is listed on `isMutationMessage`. `OPEN_BOOKMARK_URLS` is a mutation too (tab creates) — include it so it serializes.

Live-node rules: `bookmarks.get` first; reject if missing, if `!canMutateBookmarkNode` on the flattened live node (or live `unmodifiable === 'managed'`), if `UPDATE_BOOKMARK` sets `url` on a folder, if `REMOVE_BOOKMARK` target has no `url`.

`MOVE_BOOKMARK`: persist `kind: 'move'`.  
`REMOVE_BOOKMARK`: persist `kind: 'dedup'` with one removed row.  
`UPDATE_BOOKMARK`: persist `kind: 'edit'`.  
`CREATE_BOOKMARK_FOLDER`: persist `kind: 'folder-create'`. Undo: `get` children; if none, `bookmarks.remove` (not `removeTree`).  
`REMOVE_BOOKMARK_FOLDER`: confirm already happened in UI; **`clearLastAction`** before `removeTree`; no undo.  
File undo loop: if `bookmarks.get` throws, shift and continue (missing id), same as create-undo.

`OPEN_BOOKMARK_URLS`: for each url, `chrome.tabs.create({ url })` and `exemptFromDuplicateGuard(tab.id)`. Use the last focused window (`chrome.windows.getLastFocused`).

`permissions.onRemoved`: if `permissions` includes `bookmarks`, `sendEvent({ type: 'BOOKMARKS_UPDATED' })`. Every write starts with `if (!(await hasBookmarksPermission())) throw new Error(...)`.

Do **not** change `handleCreatedBookmark` auto-file in this task.

- [ ] **Step 1: Write the failing test** for `assertMutableBookmarkNode` in `src/shared/bookmarks.test.ts`.

```ts
export function assertMutableBookmarkNode(
  live: { id: string; url?: string; unmodifiable?: string },
  folders: BookmarkFolderRecord[],
): void
```

Throws when `folders` has no matching id and `live.url` is absent (unknown folder), when the matching folder fails `canMutateBookmarkNode`, or when `live.unmodifiable === 'managed'`. Does not throw for a URL bookmark whose parent folder is mutable.

```ts
test('assertMutableBookmarkNode', () => {
  const folders = [
    { id: 'eng', folderKind: 'folder' as const, title: 'Eng', folderPath: 'Eng', isInbox: false, isSpecialRoot: false, isBookmarksBar: false, index: 0 },
    { id: '1', folderKind: 'bar' as const, title: 'Bar', folderPath: 'Bar', isInbox: false, isSpecialRoot: true, isBookmarksBar: true, index: 0 },
  ];
  expect(() => assertMutableBookmarkNode({ id: 'doc', url: 'https://x.example' }, folders)).not.toThrow();
  expect(() => assertMutableBookmarkNode({ id: '1' }, folders)).toThrow();
  expect(() => assertMutableBookmarkNode({ id: 'missing' }, folders)).toThrow();
  expect(() => assertMutableBookmarkNode({ id: 'doc', url: 'https://x.example', unmodifiable: 'managed' }, folders)).toThrow();
});
```

- [ ] **Step 2:** `npx vitest run src/shared/bookmarks.test.ts` — FAIL if the helper is new and missing

- [ ] **Step 3: Implement** the helper + all SW cases. Extend `restoreAction` for `move`, `edit`, `folder-create`. Extend `checkpointBookmarkUndo` so `data.created` is not the implicit else (switch on `kind`).

- [ ] **Step 4:** `npx vitest run src/shared/bookmarks.test.ts && npm run typecheck` — expect PASS

- [ ] **Step 5:** Skip commit unless the user asks.

---

### Task 8: Tree UI — edit, delete, create folder, open all, chips

**Files:**
- Create: `src/sidepanel/BookmarkEditPanel.tsx`
- Modify: `src/sidepanel/BookmarkList.tsx`
- Modify: `src/sidepanel/i18n.ts`
- Modify: `src/sidepanel/styles.css`

**Interfaces:**
- Consumes: Task 5 menus; Task 3 helpers; Task 7 messages
- Produces: BookmarkList tree operations. Filing bar / auto-file / Find Duplicates stay as today.

Add i18n keys (en + zh):

| key | en | zh |
|---|---|---|
| `bookmarkChipAll` | All | 全部 |
| `bookmarkChipInbox` | Inbox | 收件箱 |
| `bookmarkChipDuplicates` | Duplicates | 重复 |
| `bookmarkTitleLabel` | Name | 名称 |
| `bookmarkUrlLabel` | URL | 网址 |
| `saveBookmarkEdit` | Save | 保存 |
| `invalidBookmarkUrl` | Enter a valid URL. | 请输入有效的网址。 |
| `deleteFolderConfirm` | Delete this folder and everything inside? | 删除这个文件夹及其全部内容？ |
| `openAllBookmarksConfirm` | Open {count} bookmarks? | 打开 {count} 个书签？ |
| `bookmarkFolderName` | Folder name | 文件夹名称 |
| `bookmarksSkipped` | Skipped {count}. | 已跳过 {count} 条。 |

`BookmarkEditPanel`: controlled `title`, optional `url`, Save calls `onSave({ title, url })`, Cancel calls `onClose`. Invalid URL (when `url` is shown) — `new URL(value)` throws → toast `invalidBookmarkUrl`, do not call `onSave`.

`BookmarkList` changes:
- Chip state `'all' | 'inbox' | 'duplicates'`. Filter the visible forest/inbox. Duplicates = ids in `findBookmarkDuplicateGroups` (keep + remove).
- Context menu actions: `edit` opens `BookmarkEditPanel`; `delete` → `REMOVE_BOOKMARK`; folder `delete` → `window.confirm(t('deleteFolderConfirm'))` then `REMOVE_BOOKMARK_FOLDER`; `rename` → edit panel without URL; `new-folder` → `window.prompt(t('bookmarkFolderName'))` then `CREATE_BOOKMARK_FOLDER` with parent = that folder id, or `otherBookmarksRootId(folders)` from Inbox header; `open-all` collects descendant URLs, if `urls.length > 15` confirm, then `OPEN_BOOKMARK_URLS`.
- `canMutate` = `canMutateBookmarkNode(node)`.
- Do not remove Find Duplicates, filing bar, banner, or enrich.

No new vitest for the React panel (spec: no click-through). Typecheck is the gate.

- [ ] **Step 1:** Add i18n keys first so `BookmarkEditPanel` can typecheck.

- [ ] **Step 2:** `npm run typecheck` — expect FAIL if keys are referenced before added; add them.

- [ ] **Step 3: Implement** `BookmarkEditPanel` and BookmarkList wiring as above.

- [ ] **Step 4:** `npx vitest run src/shared/bookmark-tree.test.ts src/sidepanel/context-menu.test.ts && npm run typecheck` — expect PASS

- [ ] **Step 5:** Skip commit unless the user asks.

---

### Task 9: Wire bookmark / folder drag

**Files:**
- Modify: `src/sidepanel/BookmarkList.tsx`
- Modify: `src/sidepanel/dnd-surfaces.tsx` only if a bookmark-row droppable is required

**Interfaces:**
- Consumes: `resolveBookmarkDragEnd`, `formatBookmarkRowId`, `formatBookmarkFolderRowId`, `MOVE_BOOKMARK`
- Tab headers keep `DroppableSurface` + `data-tab-drop` so tab → folder still hits `commitTabDrag` → `CREATE_BOOKMARKS`.

Implementation:
- Bookmark URL row and folder header/row are drag sources with ids from Task 6. Pointer must move 8px (`TAB_DRAG_THRESHOLD_PX`) before drag starts (reuse existing threshold).
- On drag end, `parseBookmarkDragSource(activeId)`; if null, do nothing (tab session handles it). If non-null, `resolveBookmarkDragEnd` then `request({ type: 'MOVE_BOOKMARK', ... })`.
- Inbox header remains a tab droppable; bookmark drop on it is resolved when `over` is `bookmark-inbox`.
- Do not change `file-dropped-tab.ts`.

- [ ] **Step 1:** No new helper. Regression gate is existing drag + tab-drop tests.

- [ ] **Step 2:** `npx vitest run src/shared/bookmark-dnd.test.ts src/sidepanel/file-dropped-tab.test.ts` — must stay PASS (tab drop still `CREATE_BOOKMARKS`)

- [ ] **Step 3: Implement** drag sources + end handler. Folder header: still `DroppableSurface surface={{ kind: 'bookmark-folder', folderId }}` for tabs.

- [ ] **Step 4:** Same tests + `npm run typecheck` — PASS

- [ ] **Step 5:** Skip commit unless the user asks.

---

### Task 10: Filing-plan apply-order helper

**Files:**
- Create: `src/shared/bookmark-filing.ts`
- Create: `src/shared/bookmark-filing.test.ts`

**Interfaces:**
- Produces:
```ts
export type BookmarkFilingCreate = { clientId: string; parentId: string; title: string };
export type BookmarkFilingMove = { bookmarkId: string; folderId: string };

export function resolveFilingMoves(
  moves: BookmarkFilingMove[],
  createdByClientId: Map<string, string>,
  clientIds: Set<string>,
): BookmarkFilingMove[]
```

- If `folderId` is in `clientIds` and missing from the map, drop that move.
- If `folderId` is in `clientIds` and present, replace with the real id.
- Otherwise keep the move (real Chrome folder id).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from 'vitest';
import { resolveFilingMoves } from './bookmark-filing';

describe('resolveFilingMoves', () => {
  test('resolves client ids and skips failed creates', () => {
    const clientIds = new Set(['tmp-a', 'tmp-b']);
    const created = new Map([['tmp-a', 'real-a']]);
    expect(resolveFilingMoves([
      { bookmarkId: '1', folderId: 'tmp-a' },
      { bookmarkId: '2', folderId: 'tmp-b' },
      { bookmarkId: '3', folderId: 'eng' },
    ], created, clientIds)).toEqual([
      { bookmarkId: '1', folderId: 'real-a' },
      { bookmarkId: '3', folderId: 'eng' },
    ]);
  });
});
```

- [ ] **Step 2:** `npx vitest run src/shared/bookmark-filing.test.ts` — FAIL

- [ ] **Step 3: Implement** `resolveFilingMoves`.

- [ ] **Step 4:** Re-run — PASS

- [ ] **Step 5:** Skip commit unless the user asks.

---

### Task 11: Stop auto-file; add `APPLY_BOOKMARK_FILING`

**Files:**
- Create: `src/shared/bookmark-created.ts`
- Create: `src/shared/bookmark-created.test.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/background/service-worker.ts`

**Interfaces:**
- Produces:
```ts
export function decideCreatedBookmarkAction(input: {
  isInbox: boolean;
}): 'suggest' | 'ignore'
```

- `isInbox === false` → `'ignore'`. Else `'suggest'`. Never auto-file.

Message:

```ts
| {
    type: 'APPLY_BOOKMARK_FILING'
    creates: Array<{ clientId: string; parentId: string; title: string }>
    moves: Array<{ bookmarkId: string; folderId: string }>
  }
```

Apply:
1. `hasBookmarksPermission` or throw.
2. For each create: `bookmarks.create({ parentId, title })`; on success `createdByClientId.set(clientId, id)`; on missing parent skip.
3. `resolveFilingMoves` then `move` each; skip missing live nodes; persist `kind: 'file'` for completed parent-changing moves.
4. Add `APPLY_BOOKMARK_FILING` to `isMutationMessage`.

`handleCreatedBookmark`: if `decideCreatedBookmarkAction` is `ignore`, return. Always emit / persist `BOOKMARK_FILING_SUGGESTED`. Delete the `fileBookmarks` high-confidence branch and its hardcoded toast.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from 'vitest';
import { decideCreatedBookmarkAction } from './bookmark-created';

test('never auto-files', () => {
  expect(decideCreatedBookmarkAction({ isInbox: false })).toBe('ignore');
  expect(decideCreatedBookmarkAction({ isInbox: true })).toBe('suggest');
});
```

- [ ] **Step 2:** `npx vitest run src/shared/bookmark-created.test.ts` — FAIL

- [ ] **Step 3: Implement** helper + SW apply + remove auto-file.

- [ ] **Step 4:** `npx vitest run src/shared/bookmark-created.test.ts src/shared/bookmark-filing.test.ts && npm run typecheck` — PASS

- [ ] **Step 5:** Skip commit unless the user asks.

---

### Task 12: Inbox review sheet

**Files:**
- Create: `src/sidepanel/BookmarkFilingSheet.tsx`
- Modify: `src/sidepanel/BookmarkList.tsx`
- Modify: `src/sidepanel/i18n.ts`

**Interfaces:**
- Consumes: `SUGGEST_BOOKMARK_FILE` per Inbox id so project memory applies. SW returns `{ bookmark, suggestion }`. Do not call `suggestBookmarkFolder` in the side panel (it would drop project memory).

Sheet props:

```ts
{
  rows: Array<{ bookmark: BookmarkRecord; suggestion: BookmarkFolderSuggestion | null }>;
  folders: BookmarkFolderRecord[];
  t: Translator;
  busy: boolean;
  onClose: () => void;
  onApply: (plan: {
    creates: Array<{ clientId: string; parentId: string; title: string }>;
    moves: Array<{ bookmarkId: string; folderId: string }>;
  }) => void;
}
```

UI: one row per bookmark — title, host, reason, folder `<select>` of `eligibleFolders` (same filter as today: `!isSpecialRoot && !isInbox`), Skip checkbox, optional “New folder” title (parent default `otherBookmarksRootId`). Confirm disabled if every row is skipped or has empty destination. Confirm → `onApply` → parent sends `APPLY_BOOKMARK_FILING`.

Remove the inline `<select>` filing bar (`filingDraft` UI). Banner Review, toolbar “Review Inbox”, and row File all open this sheet (scroll/focus the source bookmark id if provided). Add toolbar button `reviewInbox` (en: Review Inbox / zh: 审查收件箱). Disable when inbox is empty.

- [ ] **Step 1:** Add i18n `reviewInbox`, `skipBookmark`, `newFolderInReview` (en/zh).

- [ ] **Step 2:** `npm run typecheck` after adding keys.

- [ ] **Step 3: Implement** the sheet and replace `filingDraft`. Toast moved + skipped using existing `bookmarksFiled` plus `bookmarksSkipped` when skipped > 0.

- [ ] **Step 4:** `npm run typecheck` — PASS

- [ ] **Step 5:** Skip commit unless the user asks.

---

### Task 13: Health report

**Files:**
- Create: `src/sidepanel/BookmarkHealthSheet.tsx`
- Modify: `src/sidepanel/BookmarkList.tsx`
- Modify: `src/sidepanel/i18n.ts`

**Interfaces:**
- Reuse `APPLY_BOOKMARK_DEDUP` and `findBookmarkDuplicateGroups`.
- Props: `{ bookmarks, inboxCount, groups, t, busy, onClose, onApplyDedup, onReviewInbox }`.
- Duplicates section: same keep/remove copy as today’s modal. Empty: `t('noDuplicateBookmarks')` inside the sheet (do not toast-and-close).
- Unfiled section: `t('unfiledBookmarkCount', { count: inboxCount })` + button that calls `onReviewInbox` (closes health, opens filing sheet). Never `move`.
- Toolbar: replace Find Duplicates with `bookmarkHealthReport` (en: Health report / zh: 健康报告).

- [ ] **Step 1:** Add i18n `bookmarkHealthReport`, `unfiledBookmarkCount`, `reviewUnfiled` (en: `{count} in Inbox` / `Review Inbox`).

- [ ] **Step 2:** Implement sheet; remove `duplicateGroups` portal modal.

- [ ] **Step 3:** `npm run typecheck` — PASS

- [ ] **Step 4:** Skip commit unless the user asks.

---

### Task 14: Export Markdown + Netscape HTML

**Files:**
- Create: `src/shared/bookmark-export.ts`
- Create: `src/shared/bookmark-export.test.ts`
- Create: `src/sidepanel/BookmarkExportSheet.tsx`
- Modify: `src/sidepanel/BookmarkList.tsx`
- Modify: `src/sidepanel/i18n.ts`

**Interfaces:**
```ts
export function bookmarksToMarkdown(folders: BookmarkFolderRecord[], bookmarks: BookmarkRecord[]): string
export function bookmarksToNetscapeHtml(folders: BookmarkFolderRecord[], bookmarks: BookmarkRecord[]): string
export function parseNetscapeBookmarkHtml(html: string): chrome.bookmarks.BookmarkTreeNode[]
```

Parser returns **one untitled root** (`id` can be `'0'`, `title: ''`, `parentId` omitted, `children` = bar/other/mobile/managed-style folders as parsed). `flattenBookmarkTree` then sees the invisible root and does not mark user folders as special roots unless their titles match root titles.

Markdown: walk forest-equivalent by parent/index; `##` for depth 1, extra `#` per level; `- [title](url)` for bookmarks; omit empty folders.

Netscape: `<!DOCTYPE NETSCAPE-Bookmark-file-1>` + nested `<DL><DT><H3>` / `<A HREF>`.

Round-trip test: build a flattenable tree, export HTML, parse, flatten, compare `Set` of URLs and sorted folder titles (ignore wrapper special-root flags).

Sheet: choose Markdown or HTML, download via `URL.createObjectURL` + `<a download>` (`bookmarks.md` / `bookmarks_import.html`). Copy: `exportAddsNotReplaces` — en: `Importing this HTML adds a new folder tree. It does not replace your existing bookmarks.` zh: `导入这份 HTML 会新增一棵文件夹树，不会替换现有书签。`

Do not add `downloads` permission. Chips do not filter. Include bar + Other + Mobile + Managed from the in-memory lists.

Toolbar secondary button `exportBookmarks`.

- [ ] **Step 1: Write the failing export tests**

```ts
import { describe, expect, test } from 'vitest';
import { flattenBookmarkTree } from './bookmarks';
import { bookmarksToMarkdown, bookmarksToNetscapeHtml, parseNetscapeBookmarkHtml } from './bookmark-export';

const folders = [
  { id: '1', parentId: '0', title: 'Bookmarks Bar', folderPath: 'Bookmarks Bar', isInbox: false, isSpecialRoot: true, isBookmarksBar: true, folderKind: 'bar' as const, index: 0 },
  { id: 'work', parentId: '1', title: 'Work', folderPath: 'Bookmarks Bar / Work', isInbox: false, isSpecialRoot: false, isBookmarksBar: true, folderKind: 'folder' as const, index: 0 },
];
const bookmarks = [
  { id: 'd', parentId: 'work', title: 'Doc', url: 'https://doc.example', folderPath: 'Bookmarks Bar / Work', isInbox: false, isBookmarksBar: true, folderKind: 'bar' as const, index: 0 },
];

test('markdown lists folder then link', () => {
  const md = bookmarksToMarkdown(folders, bookmarks);
  expect(md).toContain('## Work');
  expect(md).toContain('[Doc](https://doc.example)');
});

test('netscape round-trips urls and folder titles', () => {
  const html = bookmarksToNetscapeHtml(folders, bookmarks);
  expect(html).toContain('NETSCAPE-Bookmark-file-1');
  const parsed = parseNetscapeBookmarkHtml(html);
  const flat = flattenBookmarkTree(parsed);
  expect(new Set(flat.bookmarks.map((item) => item.url))).toEqual(new Set(['https://doc.example']));
  expect(flat.folders.map((folder) => folder.title).includes('Work')).toBe(true);
});
```

- [ ] **Step 2:** `npx vitest run src/shared/bookmark-export.test.ts` — FAIL

- [ ] **Step 3: Implement** export helpers + sheet + toolbar button.

- [ ] **Step 4:** `npx vitest run src/shared/bookmark-export.test.ts && npm run typecheck` — PASS

- [ ] **Step 5:** Skip commit unless the user asks.

---

## Self-review (plan vs spec)

| Spec requirement | Task |
|---|---|
| `folderKind` / `index` / `unmodifiable` on flatten | 1 |
| Mixed Chrome index forest; Mobile visible; Inbox excludes mobile | 2 |
| `otherBookmarksRootId`, `canMutateBookmarkNode`, `bookmarkMoveIndex`, `isBookmarkMoveCycle` | 3 |
| `kind: 'move'` undo; do not reuse `shouldRestoreFiledBookmark` | 4, 7 |
| Parameterized context menus + tests | 5 |
| Drag discriminator; `bookmark-row-` vs `bookmark-folder-` | 6, 9 |
| SW tree messages, queue, `OPEN_BOOKMARK_URLS`, `permissions.onRemoved`, folder delete clears last-action | 7 |
| Tree UI, chips, edit panel, enrich kept, UnifiedSearch unchanged | 8 |
| Tab drop stays `CREATE_BOOKMARKS` | 9 + file-dropped-tab untouched |
| Filing plan resolve + `APPLY_BOOKMARK_FILING` + kill auto-file | 10, 11 |
| Inbox review sheet; remove `<select>` bar | 12 |
| Health report replaces Find Duplicates | 13 |
| Markdown + Netscape + untitled-root parse; no `downloads` permission | 14 |
| Dead links / Rico site / tags | omitted (non-goals) |

No `TBD` / “add validation later” / “similar to Task N” implementations. Types introduced in Task 1 are the names later tasks use.
