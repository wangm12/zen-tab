import { describe, expect, test } from 'vitest';
import {
  canRestoreBookmarkIntoParent,
  existingCanonicalUrlsInBookmarkParent,
  findBookmarkDuplicateGroups,
  flattenBookmarkTree,
  planBookmarkCreates,
  shouldRestoreFiledBookmark,
  suggestBookmarkFolder,
  validateBookmarkDedupGroups,
} from './bookmarks';
import { ProjectMemoryRule } from './types';

type Node = chrome.bookmarks.BookmarkTreeNode & {
  folderType?: 'bookmarks-bar' | 'other' | 'mobile';
  children?: Node[];
};

function tree(children: Node[]): Node[] {
  return [{
    id: '0',
    title: '',
    children: [
      { id: '1', parentId: '0', title: 'Bookmarks Bar', folderType: 'bookmarks-bar', children: [] },
      { id: '2', parentId: '0', title: 'Other Bookmarks', folderType: 'other', children },
      { id: '3', parentId: '0', title: 'Mobile Bookmarks', folderType: 'mobile', children: [] },
    ],
  }];
}

describe('flattenBookmarkTree', () => {
  test('marks direct Other Bookmarks items and Inbox children as inbox', () => {
    const result = flattenBookmarkTree(tree([
      { id: 'a', parentId: '2', title: 'Direct', url: 'https://direct.example' },
      {
        id: 'inbox',
        parentId: '2',
        title: 'iNbOx',
        children: [{ id: 'b', parentId: 'inbox', title: 'Nested', url: 'https://nested.example' }],
      },
    ]));

    expect(result.bookmarks.map(({ id, folderPath, isInbox }) => ({ id, folderPath, isInbox }))).toEqual([
      { id: 'a', folderPath: 'Other Bookmarks', isInbox: true },
      { id: 'b', folderPath: 'Other Bookmarks / iNbOx', isInbox: true },
    ]);
  });

  test('does not mark Bookmarks Bar root items as inbox', () => {
    const roots = tree([]);
    roots[0].children?.[0].children?.push({
      id: 'bar-item',
      parentId: '1',
      title: 'Pinned',
      url: 'https://pinned.example',
    });

    expect(flattenBookmarkTree(roots).bookmarks[0].isInbox).toBe(false);
    expect(flattenBookmarkTree(roots).bookmarks[0].isBookmarksBar).toBe(true);
  });

  test('falls back to localized root titles when folderType is absent', () => {
    const roots: Node[] = [{
      id: '0',
      title: '',
      children: [{
        id: 'other',
        parentId: '0',
        title: '其他书签',
        children: [{ id: 'item', parentId: 'other', title: '条目', url: 'https://example.cn' }],
      }],
    }];

    const result = flattenBookmarkTree(roots);
    expect(result.bookmarks[0].isInbox).toBe(true);
    expect(result.folders.find((folder) => folder.id === 'other')?.isSpecialRoot).toBe(true);
  });

  test('identifies Chromium root ids without folderType in non-English locales', () => {
    const roots: Node[] = [{
      id: '0',
      title: '',
      children: [
        { id: '1', parentId: '0', title: 'Lesezeichenleiste', children: [{ id: 'bar-item', parentId: '1', title: 'Bar', url: 'https://bar.example' }] },
        { id: '2', parentId: '0', title: 'Weitere Lesezeichen', children: [{ id: 'other-item', parentId: '2', title: 'Other', url: 'https://other.example' }] },
        { id: '3', parentId: '0', title: 'Mobile Lesezeichen', children: [] },
      ],
    }];

    const result = flattenBookmarkTree(roots);
    expect(result.bookmarks.find((bookmark) => bookmark.id === 'bar-item')?.isBookmarksBar).toBe(true);
    expect(result.bookmarks.find((bookmark) => bookmark.id === 'other-item')?.isInbox).toBe(true);
    expect(result.folders.filter((folder) => ['1', '2', '3'].includes(folder.id)).every((folder) => folder.isSpecialRoot)).toBe(true);
  });

  test('marks an unknown direct child of the invisible root as special and ineligible for filing', () => {
    const roots: Node[] = [{
      id: 'root',
      title: '',
      children: [{ id: 'unknown-root', parentId: 'root', title: 'Unbekannter Stamm', children: [] }],
    }];
    const flattened = flattenBookmarkTree(roots);
    const unknownRoot = flattened.folders.find((folder) => folder.id === 'unknown-root');
    const bookmark = {
      id: 'new',
      parentId: '2',
      title: 'Unbekannter Stamm guide',
      url: 'https://example.com',
      folderPath: 'Other',
      isInbox: true,
      isBookmarksBar: false,
    };

    expect(unknownRoot?.isSpecialRoot).toBe(true);
    expect(suggestBookmarkFolder(bookmark, [], flattened.folders, [])).toBeNull();
  });
});

describe('suggestBookmarkFolder', () => {
  const flattened = flattenBookmarkTree(tree([
    { id: 'new', parentId: '2', title: 'React query guide', url: 'https://dev.example/react-query' },
    { id: 'inbox', parentId: '2', title: 'Inbox', children: [] },
    {
      id: 'dev',
      parentId: '2',
      title: 'Development',
      children: [
        { id: 'one', parentId: 'dev', title: 'React docs', url: 'https://dev.example/react' },
        { id: 'two', parentId: 'dev', title: 'TypeScript', url: 'https://dev.example/typescript' },
      ],
    },
    {
      id: 'other-folder',
      parentId: '2',
      title: 'Reading',
      children: [{ id: 'three', parentId: 'other-folder', title: 'Article', url: 'https://else.example/post' }],
    },
  ]));

  test('returns high confidence for a majority same-host folder with at least two matches', () => {
    const bookmark = flattened.bookmarks.find((item) => item.id === 'new')!;
    expect(suggestBookmarkFolder(bookmark, flattened.bookmarks, flattened.folders, [])).toMatchObject({
      folderId: 'dev',
      folderTitle: 'Development',
      confidence: 'high',
    });
  });

  test('returns high confidence for a project-memory match', () => {
    const bookmark = { ...flattened.bookmarks.find((item) => item.id === 'new')!, url: 'https://unrelated.example/react-query' };
    const memory: ProjectMemoryRule[] = [{
      id: 'rule',
      projectName: 'Development',
      tokens: ['react', 'query', 'typescript'],
      createdAt: 1,
      updatedAt: 1,
      useCount: 1,
    }];
    expect(suggestBookmarkFolder(bookmark, [], flattened.folders, memory)).toMatchObject({
      folderId: 'dev',
      confidence: 'high',
    });
  });

  test('returns medium confidence for folder-name token overlap', () => {
    const bookmark = { ...flattened.bookmarks[0], title: 'Development workflow', url: 'https://unrelated.example' };
    expect(suggestBookmarkFolder(bookmark, [], flattened.folders, [])).toMatchObject({
      folderId: 'dev',
      confidence: 'medium',
    });
  });

  test('returns null without a meaningful match and never targets special or inbox folders', () => {
    const bookmark = { ...flattened.bookmarks[0], title: 'Cooking recipes', url: 'https://food.example' };
    expect(suggestBookmarkFolder(bookmark, [], flattened.folders, [])).toBeNull();
    const specialRootMatch = { ...bookmark, title: 'Bookmarks Bar' };
    const inboxMatch = { ...bookmark, title: 'Inbox' };
    expect(suggestBookmarkFolder(specialRootMatch, [], flattened.folders, [])?.folderId).not.toBe('1');
    expect(suggestBookmarkFolder(inboxMatch, [], flattened.folders, [])?.folderId).not.toBe('inbox');
  });
});

describe('findBookmarkDuplicateGroups', () => {
  test('canonicalizes URLs and prefers non-inbox, then bookmarks bar, then latest', () => {
    const roots = tree([
      { id: 'inbox-copy', parentId: '2', title: 'Inbox copy', url: 'https://example.com/page?utm_source=x', dateAdded: 500 },
      {
        id: 'saved',
        parentId: '2',
        title: 'Saved',
        children: [
          { id: 'regular-old', parentId: 'saved', title: 'Old', url: 'https://example.com/page/', dateAdded: 100 },
          { id: 'regular-new', parentId: 'saved', title: 'New', url: 'https://example.com/page', dateAdded: 200 },
        ],
      },
    ]);
    roots[0].children?.[0].children?.push({
      id: 'bar-copy',
      parentId: '1',
      title: 'Bar',
      url: 'https://example.com/page#section',
      dateAdded: 50,
    });

    expect(findBookmarkDuplicateGroups(flattenBookmarkTree(roots).bookmarks)).toEqual([{
      canonicalUrl: 'https://example.com/page',
      keepId: 'bar-copy',
      removeIds: ['regular-new', 'regular-old', 'inbox-copy'],
    }]);
  });
});

describe('validateBookmarkDedupGroups', () => {
  test('keeps only live removals that still match the live keep URL', () => {
    const live = [
      { id: 'keep', parentId: 'folder', title: 'Keep', url: 'https://example.com/page?utm_source=x', folderPath: 'Saved', isInbox: false, isBookmarksBar: false },
      { id: 'same', parentId: 'folder', title: 'Same', url: 'https://example.com/page#section', folderPath: 'Saved', isInbox: false, isBookmarksBar: false },
      { id: 'changed', parentId: 'folder', title: 'Changed', url: 'https://different.example', folderPath: 'Saved', isInbox: false, isBookmarksBar: false },
    ];

    expect(validateBookmarkDedupGroups(live, [{
      keepId: 'keep',
      removeIds: ['same', 'changed', 'missing'],
    }])).toEqual([{ keepId: 'keep', removeIds: ['same'] }]);
  });

  test('drops a group whose keep bookmark is missing while retaining valid groups', () => {
    const live = [
      { id: 'keep-2', parentId: 'folder', title: 'Keep 2', url: 'https://two.example', folderPath: 'Saved', isInbox: false, isBookmarksBar: false },
      { id: 'remove-2', parentId: 'folder', title: 'Remove 2', url: 'https://two.example/', folderPath: 'Saved', isInbox: false, isBookmarksBar: false },
    ];

    expect(validateBookmarkDedupGroups(live, [
      { keepId: 'missing', removeIds: ['remove-2'] },
      { keepId: 'keep-2', removeIds: ['remove-2'] },
    ])).toEqual([{ keepId: 'keep-2', removeIds: ['remove-2'] }]);
  });
});

describe('existingCanonicalUrlsInBookmarkParent', () => {
  test('without parentId uses Other-root children only, including localized Other', () => {
    const standard = flattenBookmarkTree(tree([
      { id: 'a', parentId: '2', title: 'Direct', url: 'https://direct.example/path?utm_source=x' },
      {
        id: 'inbox',
        parentId: '2',
        title: 'Inbox',
        children: [{ id: 'b', parentId: 'inbox', title: 'Nested', url: 'https://nested.example' }],
      },
    ]));
    const barRoots = tree([]);
    barRoots[0].children?.[0].children?.push({
      id: 'bar-item',
      parentId: '1',
      title: 'Pinned',
      url: 'https://pinned.example',
    });
    const withBar = flattenBookmarkTree(barRoots);
    const localized = flattenBookmarkTree([{
      id: '0',
      title: '',
      children: [{
        id: 'other',
        parentId: '0',
        title: '其他书签',
        children: [{ id: 'item', parentId: 'other', title: '条目', url: 'https://example.cn/page' }],
      }],
    }]);

    expect([...existingCanonicalUrlsInBookmarkParent(standard.bookmarks, standard.folders)]).toEqual(['https://direct.example/path']);
    expect(existingCanonicalUrlsInBookmarkParent(withBar.bookmarks, withBar.folders).has('https://pinned.example')).toBe(false);
    expect([...existingCanonicalUrlsInBookmarkParent(localized.bookmarks, localized.folders)]).toEqual(['https://example.cn/page']);
  });

  test('with parentId only compares siblings in that folder', () => {
    const flattened = flattenBookmarkTree(tree([
      { id: 'a', parentId: '2', title: 'Direct', url: 'https://direct.example' },
      {
        id: 'dev',
        parentId: '2',
        title: 'Development',
        children: [{ id: 'one', parentId: 'dev', title: 'React', url: 'https://dev.example/react' }],
      },
    ]));

    expect([...existingCanonicalUrlsInBookmarkParent(flattened.bookmarks, flattened.folders, 'dev')]).toEqual(['https://dev.example/react']);
    expect(existingCanonicalUrlsInBookmarkParent(flattened.bookmarks, flattened.folders, 'dev').has('https://direct.example')).toBe(false);
  });
});

describe('planBookmarkCreates', () => {
  test('skips existing canonicals, special urls, and intra-batch duplicates', () => {
    expect(planBookmarkCreates([
      { title: 'Keep', url: 'https://new.example/a' },
      { title: 'Exists', url: 'https://direct.example/path?utm_medium=email' },
      { title: 'Settings', url: 'chrome://settings' },
      { title: 'Dup', url: 'https://new.example/a#hash' },
    ], new Set(['https://direct.example/path']))).toEqual({
      toCreate: [{ title: 'Keep', url: 'https://new.example/a' }],
      skipped: 3,
    });
  });
});

describe('bookmark undo safety', () => {
  const move = {
    id: 'bookmark',
    fromParentId: 'inbox',
    fromIndex: 2,
    toParentId: 'filed',
  };

  test('restores a filed bookmark only while it remains in the filing destination', () => {
    expect(shouldRestoreFiledBookmark(move, { id: 'bookmark', parentId: 'filed', title: 'Saved', url: 'https://example.com' })).toBe(true);
    expect(shouldRestoreFiledBookmark(move, { id: 'bookmark', parentId: 'inbox', title: 'Saved', url: 'https://example.com' })).toBe(false);
    expect(shouldRestoreFiledBookmark(move, { id: 'bookmark', parentId: 'user-folder', title: 'Saved', url: 'https://example.com' })).toBe(false);
    expect(shouldRestoreFiledBookmark(move, undefined)).toBe(false);
  });

  test('restores a removed bookmark only into a live folder', () => {
    expect(canRestoreBookmarkIntoParent('filed', { id: 'filed', title: 'Filed' })).toBe(true);
    expect(canRestoreBookmarkIntoParent('filed', { id: 'filed', title: 'Not a folder', url: 'https://example.com' })).toBe(false);
    expect(canRestoreBookmarkIntoParent('filed', { id: 'other', title: 'Other' })).toBe(false);
    expect(canRestoreBookmarkIntoParent('filed', undefined)).toBe(false);
  });
});
