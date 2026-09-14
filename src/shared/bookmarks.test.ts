import { describe, expect, test } from 'vitest';
import {
  assertMutableBookmarkNode,
  bookmarkMoveIndex,
  canFileIntoBookmarkParent,
  canMutateBookmarkNode,
  canRestoreBookmarkIntoParent,
  existingCanonicalUrlsInBookmarkParent,
  filingDestinationFolders,
  findBookmarkDuplicateGroups,
  flattenBookmarkTree,
  folderCreateParentFolders,
  isBookmarkMoveCycle,
  isManagedBookmarkNode,
  otherBookmarksRootId,
  planBookmarkCreates,
  shouldRestoreFiledBookmark,
  shouldRestoreMovedBookmark,
  suggestBookmarkFolder,
  validateBookmarkDedupGroups,
} from './bookmarks';
import { ProjectMemoryRule } from './types';

type Node = chrome.bookmarks.BookmarkTreeNode & {
  folderType?: 'bookmarks-bar' | 'other' | 'mobile' | 'managed';
  unmodifiable?: 'managed';
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
      folderKind: 'other' as const,
      index: 0,
    };

    expect(unknownRoot?.isSpecialRoot).toBe(true);
    expect(suggestBookmarkFolder(bookmark, [], flattened.folders, [])).toBeNull();
  });

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

  test('does not treat a nested folder titled Bookmarks Bar as a special root', () => {
    const roots = tree([]);
    roots[0].children?.[0].children?.push({
      id: 'nested-bar',
      parentId: '1',
      title: 'Bookmarks Bar',
      children: [],
    });

    const nested = flattenBookmarkTree(roots).folders.find((folder) => folder.id === 'nested-bar');
    expect(nested).toMatchObject({
      folderKind: 'folder',
      isSpecialRoot: false,
      isBookmarksBar: false,
    });
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
      { id: 'keep', parentId: 'folder', title: 'Keep', url: 'https://example.com/page?utm_source=x', folderPath: 'Saved', isInbox: false, isBookmarksBar: false, folderKind: 'folder' as const, index: 0 },
      { id: 'same', parentId: 'folder', title: 'Same', url: 'https://example.com/page#section', folderPath: 'Saved', isInbox: false, isBookmarksBar: false, folderKind: 'folder' as const, index: 1 },
      { id: 'changed', parentId: 'folder', title: 'Changed', url: 'https://different.example', folderPath: 'Saved', isInbox: false, isBookmarksBar: false, folderKind: 'folder' as const, index: 2 },
    ];

    expect(validateBookmarkDedupGroups(live, [{
      keepId: 'keep',
      removeIds: ['same', 'changed', 'missing'],
    }])).toEqual([{ keepId: 'keep', removeIds: ['same'] }]);
  });

  test('drops a group whose keep bookmark is missing while retaining valid groups', () => {
    const live = [
      { id: 'keep-2', parentId: 'folder', title: 'Keep 2', url: 'https://two.example', folderPath: 'Saved', isInbox: false, isBookmarksBar: false, folderKind: 'folder' as const, index: 0 },
      { id: 'remove-2', parentId: 'folder', title: 'Remove 2', url: 'https://two.example/', folderPath: 'Saved', isInbox: false, isBookmarksBar: false, folderKind: 'folder' as const, index: 1 },
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

describe('assertMutableBookmarkNode', () => {
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

  test('rejects nodes under a managed ancestor', () => {
    const folders = [
      { id: '99', folderKind: 'managed' as const, title: 'Managed', folderPath: 'Managed', isInbox: false, isSpecialRoot: true, isBookmarksBar: false, index: 3, unmodifiable: 'managed' as const },
      { id: 'policy-folder', parentId: '99', folderKind: 'folder' as const, title: 'Policy', folderPath: 'Managed / Policy', isInbox: false, isSpecialRoot: false, isBookmarksBar: false, index: 0 },
    ];
    expect(() => assertMutableBookmarkNode({ id: 'policy-folder' }, folders)).toThrow();
    expect(() => assertMutableBookmarkNode({
      id: 'item',
      url: 'https://x.example',
      parentId: 'policy-folder',
    }, folders)).toThrow();
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

describe('canFileIntoBookmarkParent', () => {
  const folders = [
    { id: '1', folderKind: 'bar' as const, title: 'Bar', folderPath: 'Bar', isInbox: false, isSpecialRoot: true, isBookmarksBar: true, index: 0 },
    { id: '2', folderKind: 'other' as const, title: 'Other', folderPath: 'Other', isInbox: false, isSpecialRoot: true, isBookmarksBar: false, index: 1 },
    { id: '3', folderKind: 'mobile' as const, title: 'Mobile', folderPath: 'Mobile', isInbox: false, isSpecialRoot: true, isBookmarksBar: false, index: 2 },
    { id: '99', folderKind: 'managed' as const, title: 'Managed', folderPath: 'Managed', isInbox: false, isSpecialRoot: true, isBookmarksBar: false, index: 3, unmodifiable: 'managed' as const },
    { id: 'eng', parentId: '2', folderKind: 'folder' as const, title: 'Eng', folderPath: 'Other / Eng', isInbox: false, isSpecialRoot: false, isBookmarksBar: false, index: 0 },
    { id: 'policy', parentId: '99', folderKind: 'folder' as const, title: 'Policy', folderPath: 'Managed / Policy', isInbox: false, isSpecialRoot: false, isBookmarksBar: false, index: 0 },
  ];

  test('allows bar, Other, and regular folders; rejects mobile and managed', () => {
    expect(canFileIntoBookmarkParent('1', folders)).toBe(true);
    expect(canFileIntoBookmarkParent('2', folders)).toBe(true);
    expect(canFileIntoBookmarkParent('eng', folders)).toBe(true);
    expect(canFileIntoBookmarkParent('3', folders)).toBe(false);
    expect(canFileIntoBookmarkParent('99', folders)).toBe(false);
    expect(canFileIntoBookmarkParent('policy', folders)).toBe(false);
    expect(canFileIntoBookmarkParent('missing', folders)).toBe(false);
  });
});

describe('filingDestinationFolders', () => {
  test('keeps bar out of organize dests and also drops managed descendants', () => {
    const folders = [
      { id: '1', folderKind: 'bar' as const, title: 'Bar', folderPath: 'Bar', isInbox: false, isSpecialRoot: true, isBookmarksBar: true, index: 0 },
      { id: '2', folderKind: 'other' as const, title: 'Other', folderPath: 'Other', isInbox: false, isSpecialRoot: true, isBookmarksBar: false, index: 1 },
      { id: 'eng', parentId: '2', folderKind: 'folder' as const, title: 'Eng', folderPath: 'Other / Eng', isInbox: false, isSpecialRoot: false, isBookmarksBar: false, index: 0 },
      { id: 'inbox', parentId: '2', folderKind: 'folder' as const, title: 'Inbox', folderPath: 'Other / Inbox', isInbox: true, isSpecialRoot: false, isBookmarksBar: false, index: 1 },
      { id: '99', folderKind: 'managed' as const, title: 'Managed', folderPath: 'Managed', isInbox: false, isSpecialRoot: true, isBookmarksBar: false, index: 3, unmodifiable: 'managed' as const },
      { id: 'policy', parentId: '99', folderKind: 'folder' as const, title: 'Policy', folderPath: 'Managed / Policy', isInbox: false, isSpecialRoot: false, isBookmarksBar: false, index: 0 },
    ];
    expect(filingDestinationFolders(folders).map((folder) => folder.id)).toEqual(['eng']);
    expect(folderCreateParentFolders(folders).map((folder) => folder.id)).toEqual(['1', '2', 'eng']);
  });
});

describe('isManagedBookmarkNode', () => {
  test('walks ancestors for managed root or unmodifiable', () => {
    const folders = [
      { id: '99', folderKind: 'managed' as const, title: 'Managed', folderPath: 'Managed', isInbox: false, isSpecialRoot: true, isBookmarksBar: false, index: 3, unmodifiable: 'managed' as const },
      { id: 'policy-folder', parentId: '99', folderKind: 'folder' as const, title: 'Policy', folderPath: 'Managed / Policy', isInbox: false, isSpecialRoot: false, isBookmarksBar: false, index: 0 },
      { id: 'locked', parentId: '2', folderKind: 'folder' as const, title: 'Locked', folderPath: 'Other / Locked', isInbox: false, isSpecialRoot: false, isBookmarksBar: false, index: 0, unmodifiable: 'managed' as const },
      { id: 'eng', parentId: '2', folderKind: 'folder' as const, title: 'Eng', folderPath: 'Other / Eng', isInbox: false, isSpecialRoot: false, isBookmarksBar: false, index: 0 },
    ];
    expect(isManagedBookmarkNode('99', folders)).toBe(true);
    expect(isManagedBookmarkNode('policy-folder', folders)).toBe(true);
    expect(isManagedBookmarkNode('locked', folders)).toBe(true);
    expect(isManagedBookmarkNode('eng', folders)).toBe(false);
  });
});

describe('bookmarkMoveIndex', () => {
  test('returns target index for before and targetIndex + 1 for after (matching Chrome BookmarkModel::Move)', () => {
    expect(bookmarkMoveIndex({ fromIndex: 1, targetIndex: 3, placement: 'after', sameParent: true })).toBe(4);
    expect(bookmarkMoveIndex({ fromIndex: 1, targetIndex: 3, placement: 'before', sameParent: true })).toBe(3);
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

  test('restores a removed bookmark only into a live folder', () => {
    expect(canRestoreBookmarkIntoParent('filed', { id: 'filed', title: 'Filed' })).toBe(true);
    expect(canRestoreBookmarkIntoParent('filed', { id: 'filed', title: 'Not a folder', url: 'https://example.com' })).toBe(false);
    expect(canRestoreBookmarkIntoParent('filed', { id: 'other', title: 'Other' })).toBe(false);
    expect(canRestoreBookmarkIntoParent('filed', undefined)).toBe(false);
  });
});
