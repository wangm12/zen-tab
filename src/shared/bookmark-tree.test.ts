import { describe, expect, test } from 'vitest';
import { BookmarkFolderRecord, BookmarkRecord } from './types';
import { INBOX_COLLAPSE_ID, buildBookmarkForest, flattenVisibleBookmarkRows, inboxBookmarks } from './bookmark-tree';

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

const bar = folder({
  id: '1',
  parentId: '0',
  title: 'Bookmarks Bar',
  folderPath: 'Bookmarks Bar',
  isSpecialRoot: true,
  isBookmarksBar: true,
  folderKind: 'bar',
});

const other = folder({
  id: '2',
  parentId: '0',
  title: '其他书签',
  folderPath: '其他书签',
  isSpecialRoot: true,
  isInbox: true,
  folderKind: 'other',
});

const engineering = folder({
  id: 'eng',
  parentId: '2',
  title: 'Engineering',
  folderPath: '其他书签 / Engineering',
});

const inbox = folder({
  id: 'inbox',
  parentId: '2',
  title: 'iNbOx',
  folderPath: '其他书签 / iNbOx',
  isInbox: true,
});

describe('inboxBookmarks', () => {
  test('inbox tray vs nested Other folder', () => {
    const loose = bookmark({
      id: 'loose',
      parentId: '2',
      title: 'Loose',
      folderPath: '其他书签',
      isInbox: true,
    });
    const inboxItem = bookmark({
      id: 'inbox-item',
      parentId: 'inbox',
      title: 'Inbox item',
      folderPath: '其他书签 / iNbOx',
      isInbox: true,
    });
    const nested = bookmark({
      id: 'nested',
      parentId: 'eng',
      title: 'Nested',
      folderPath: '其他书签 / Engineering',
      isInbox: true,
    });
    const filed = bookmark({
      id: 'filed',
      parentId: 'eng',
      title: 'Filed',
      folderPath: '其他书签 / Engineering',
    });

    expect(inboxBookmarks([loose, inboxItem, nested, filed], [other, engineering, inbox]).map((item) => item.id))
      .toEqual(['loose', 'inbox-item']);
  });
});

describe('buildBookmarkForest', () => {
  test('nest folder → bookmark', () => {
    const work = folder({
      id: 'work',
      parentId: '1',
      title: 'Work',
      folderPath: 'Bookmarks Bar / Work',
    });
    const doc = bookmark({
      id: 'doc',
      parentId: 'work',
      title: 'Doc',
      folderPath: 'Bookmarks Bar / Work',
      isBookmarksBar: true,
    });

    expect(buildBookmarkForest([bar, work], [doc])).toEqual([
      {
        kind: 'folder',
        folder: bar,
        count: 1,
        children: [
          {
            kind: 'folder',
            folder: work,
            count: 1,
            children: [{ kind: 'bookmark', bookmark: doc }],
          },
        ],
      },
    ]);
  });

  test('inbox tray vs nested Other folder', () => {
    const loose = bookmark({
      id: 'loose',
      parentId: '2',
      title: 'Loose',
      folderPath: '其他书签',
      isInbox: true,
    });
    const nested = bookmark({
      id: 'nested',
      parentId: 'eng',
      title: 'Nested',
      folderPath: '其他书签 / Engineering',
      isInbox: true,
    });

    const forest = buildBookmarkForest([other, engineering], [loose, nested]);

    expect(forest.map((node) => node.kind === 'folder' ? node.folder.id : node.bookmark.id)).toEqual(['eng']);
    expect(forest[0]).toMatchObject({
      kind: 'folder',
      folder: engineering,
      count: 1,
      children: [{ kind: 'bookmark', bookmark: nested }],
    });
  });

  test('does not promote a nested bar-kind folder to a second root', () => {
    const nestedBar = folder({
      id: 'nested-bar',
      parentId: '1',
      title: 'Bookmarks Bar',
      folderPath: 'Bookmarks Bar / Bookmarks Bar',
      folderKind: 'bar',
      isBookmarksBar: true,
      isSpecialRoot: true,
    });
    const forest = buildBookmarkForest([bar, nestedBar], []);
    expect(forest.map((node) => node.kind === 'folder' ? node.folder.id : node.bookmark.id)).toEqual(['1']);
    expect(forest[0].kind === 'folder' && forest[0].children.map((node) => node.kind === 'folder' ? node.folder.id : node.bookmark.id)).toEqual(['nested-bar']);
  });

  test('Bookmarks Bar appears as a root', () => {
    const pinned = bookmark({
      id: 'pinned',
      parentId: '1',
      title: 'Pinned',
      folderPath: 'Bookmarks Bar',
      isBookmarksBar: true,
    });

    const forest = buildBookmarkForest([bar, other], [pinned]);

    expect(forest).toHaveLength(1);
    expect(forest[0]).toMatchObject({
      kind: 'folder',
      folder: bar,
      count: 1,
      children: [{ kind: 'bookmark', bookmark: pinned }],
    });
  });

  test('Other special root is not itself a forest root', () => {
    const forest = buildBookmarkForest([other, engineering], []);

    expect(forest.map((node) => node.kind === 'folder' ? node.folder.id : node.bookmark.id)).toEqual(['eng']);
    expect(forest.some((node) => node.kind === 'folder' && node.folder.id === '2')).toBe(false);
  });

  test('empty folder still appears', () => {
    const empty = folder({
      id: 'empty',
      parentId: '2',
      title: 'Empty',
      folderPath: '其他书签 / Empty',
    });

    expect(buildBookmarkForest([other, empty], [])).toEqual([
      { kind: 'folder', folder: empty, children: [], count: 0 },
    ]);
  });

  test('count includes nested bookmarks', () => {
    const parent = folder({
      id: 'parent',
      parentId: '2',
      title: 'Parent',
      folderPath: '其他书签 / Parent',
    });
    const child = folder({
      id: 'child',
      parentId: 'parent',
      title: 'Child',
      folderPath: '其他书签 / Parent / Child',
      index: 1,
    });
    const deep = bookmark({
      id: 'deep',
      parentId: 'child',
      title: 'Deep',
      folderPath: '其他书签 / Parent / Child',
    });
    const sibling = bookmark({
      id: 'sibling',
      parentId: 'parent',
      title: 'Sibling',
      folderPath: '其他书签 / Parent',
      index: 0,
    });

    const forest = buildBookmarkForest([other, parent, child], [deep, sibling]);

    expect(forest).toHaveLength(1);
    expect(forest[0]).toMatchObject({
      kind: 'folder',
      folder: parent,
      count: 2,
    });
    const nestedFolder = forest[0].kind === 'folder'
      ? forest[0].children.find((node) => node.kind === 'folder')
      : undefined;
    expect(nestedFolder).toMatchObject({ kind: 'folder', folder: child, count: 1 });
  });

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
});

describe('flattenVisibleBookmarkRows', () => {
  test('omits children of collapsed folders and keeps inbox rows', () => {
    const work = folder({
      id: 'work',
      parentId: '1',
      title: 'Work',
      folderPath: 'Bookmarks Bar / Work',
    });
    const doc = bookmark({
      id: 'doc',
      parentId: 'work',
      title: 'Doc',
      folderPath: 'Bookmarks Bar / Work',
      isBookmarksBar: true,
    });
    const loose = bookmark({
      id: 'loose',
      parentId: '2',
      title: 'Loose',
      folderPath: '其他书签',
      isInbox: true,
    });
    const forest = buildBookmarkForest([bar, work], [doc]);

    expect(flattenVisibleBookmarkRows({
      forest,
      collapsedFolderIds: new Set(['1']),
      inbox: [loose],
      includeInbox: true,
    }).map((row) => `${row.kind}:${row.kind === 'folder' ? row.folder.id : row.kind === 'bookmark' ? row.bookmark.id : 'count' in row ? row.count : ''}`)).toEqual([
      'inbox:1',
      'bookmark:loose',
      'folder:1',
    ]);

    expect(flattenVisibleBookmarkRows({
      forest,
      collapsedFolderIds: new Set(),
      inbox: [loose],
      includeInbox: true,
    }).map((row) => row.kind === 'folder' ? row.folder.id : row.kind === 'bookmark' ? row.bookmark.id : row.kind)).toEqual([
      'inbox',
      'loose',
      '1',
      'work',
      'doc',
    ]);
  });

  test('search results skip the tree and inbox', () => {
    const hit = bookmark({ id: 'hit', parentId: '1', title: 'Hit' });
    expect(flattenVisibleBookmarkRows({
      forest: [],
      collapsedFolderIds: new Set(),
      inbox: [hit],
      includeInbox: true,
      searching: true,
      searchHits: [hit],
    }).map((row) => row.kind)).toEqual(['search', 'bookmark']);
  });

  test('hides inbox children when the inbox group is collapsed', () => {
    const loose = bookmark({
      id: 'loose',
      parentId: '2',
      title: 'Loose',
      folderPath: '其他书签',
      isInbox: true,
    });
    expect(flattenVisibleBookmarkRows({
      forest: [],
      collapsedFolderIds: new Set([INBOX_COLLAPSE_ID]),
      inbox: [loose],
      includeInbox: true,
    }).map((row) => row.kind === 'inbox' ? `inbox:${row.collapsed}` : row.kind)).toEqual(['inbox:true']);
  });

  test('emits empty-slot row for expanded folders with 0 children', () => {
    const empty = folder({
      id: 'empty',
      parentId: '1',
      title: 'Empty Folder',
      folderPath: 'Bookmarks Bar / Empty Folder',
    });
    const forest = buildBookmarkForest([bar, empty], []);
    const rows = flattenVisibleBookmarkRows({
      forest,
      collapsedFolderIds: new Set(),
      inbox: [],
      includeInbox: false,
    });
    expect(rows).toEqual([
      { kind: 'folder', folder: bar, count: 0, depth: 0, collapsed: false },
      { kind: 'folder', folder: empty, count: 0, depth: 1, collapsed: false },
      { kind: 'empty-slot', folderId: 'empty', depth: 2 },
    ]);
  });
});
