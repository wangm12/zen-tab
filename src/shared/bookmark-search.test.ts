import { describe, expect, test } from 'vitest';
import { searchBookmarks } from './bookmark-search';
import { BookmarkRecord } from './types';

const bookmarks: BookmarkRecord[] = [
  {
    id: 'title',
    parentId: 'folder',
    title: 'TypeScript handbook',
    url: 'https://example.com/language',
    folderPath: 'Reading',
    isInbox: false,
    isBookmarksBar: false,
    folderKind: 'folder',
    index: 0,
  },
  {
    id: 'url',
    parentId: 'folder',
    title: 'Reference',
    url: 'https://developer.mozilla.org/en-US/docs/Web/API',
    folderPath: 'Reading',
    isInbox: false,
    isBookmarksBar: false,
    folderKind: 'folder',
    index: 0,
  },
  {
    id: 'folder',
    parentId: 'folder',
    title: 'Architecture notes',
    url: 'https://example.com/notes',
    folderPath: 'Work / Zen Tab',
    isInbox: false,
    isBookmarksBar: false,
    folderKind: 'folder',
    index: 0,
  },
  {
    id: 'summary',
    parentId: 'folder',
    title: 'Saved article',
    url: 'https://example.com/article',
    folderPath: 'Reading',
    summary: 'Accessible keyboard navigation patterns',
    isInbox: false,
    isBookmarksBar: false,
    folderKind: 'folder',
    index: 0,
  },
];

describe('searchBookmarks', () => {
  test.each([
    ['typescript', 'title'],
    ['mozilla web api', 'url'],
    ['zen tab', 'folder'],
    ['keyboard navigation', 'summary'],
  ])('ranks fuzzy %s matches from bookmark metadata', (query, expectedId) => {
    expect(searchBookmarks(bookmarks, query)[0]?.bookmark.id).toBe(expectedId);
    expect(searchBookmarks(bookmarks, query)[0]?.score).toBeGreaterThan(0);
  });

  test('returns no results for an empty query', () => {
    expect(searchBookmarks(bookmarks, '   ')).toEqual([]);
  });
});
