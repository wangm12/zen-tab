import { BookmarkRecord, BookmarkSearchResult } from './types';
import { extractProjectTokens } from './url';

function fieldScore(value: string, query: string, queryTokens: string[], weight: number): number {
  const normalized = value.toLocaleLowerCase();
  const valueTokens = new Set(extractProjectTokens({ title: value, url: '' }));
  const matches = queryTokens.filter((token) => valueTokens.has(token)).length;
  return (normalized.includes(query) ? weight * 2 : 0)
    + (queryTokens.length ? weight * matches / queryTokens.length : 0);
}

export function searchBookmarks(bookmarks: BookmarkRecord[], rawQuery: string): BookmarkSearchResult[] {
  const query = rawQuery.trim().toLocaleLowerCase();
  if (!query) return [];
  const queryTokens = extractProjectTokens({ title: query, url: '' });

  return bookmarks
    .map((bookmark) => ({
      bookmark,
      score: fieldScore(bookmark.title, query, queryTokens, 4)
        + fieldScore(bookmark.url, query, queryTokens, 3)
        + fieldScore(bookmark.folderPath, query, queryTokens, 2)
        + fieldScore(bookmark.summary ?? '', query, queryTokens, 1),
    }))
    .filter((result) => result.score > 0)
    .sort((left, right) => right.score - left.score
      || (right.bookmark.dateAdded ?? 0) - (left.bookmark.dateAdded ?? 0)
      || left.bookmark.id.localeCompare(right.bookmark.id));
}
