import { describe, expect, test } from 'vitest';
import { BookmarkFolderRecord, BookmarkRecord } from './types';
import { buildBookmarkForest, inboxBookmarks } from './bookmark-tree';

function folder(overrides: Partial<BookmarkFolderRecord> & Pick<BookmarkFolderRecord, 'id' | 'title'>): BookmarkFolderRecord {
  return {
    folderPath: overrides.title,
    isInbox: false,
    isSpecialRoot: false,
    isBookmarksBar: false,
    ...overrides,
  };
}

function bookmark(overrides: Partial<BookmarkRecord> & Pick<BookmarkRecord, 'id' | 'parentId' | 'title'>): BookmarkRecord {
  return {
    url: `https://example.com/${overrides.id}`,
    folderPath: overrides.title,
    isInbox: false,
    isBookmarksBar: false,
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
});

const other = folder({
  id: '2',
  parentId: '0',
  title: '其他书签',
  folderPath: '其他书签',
  isSpecialRoot: true,
  isInbox: true,
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
});
