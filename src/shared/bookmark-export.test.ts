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

describe('bookmark-export', () => {
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
});
