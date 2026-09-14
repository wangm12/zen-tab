import { BookmarkFolderRecord, BookmarkRecord } from './types';

type ExportNode =
  | { kind: 'folder'; folder: BookmarkFolderRecord; children: ExportNode[] }
  | { kind: 'bookmark'; bookmark: BookmarkRecord };

function nodeIndex(node: ExportNode): number {
  return node.kind === 'folder' ? node.folder.index : node.bookmark.index;
}

function nodeId(node: ExportNode): string {
  return node.kind === 'folder' ? node.folder.id : node.bookmark.id;
}

function compareExportNodes(left: ExportNode, right: ExportNode): number {
  return nodeIndex(left) - nodeIndex(right) || nodeId(left).localeCompare(nodeId(right));
}

function isMissingParent(parentId: string | undefined, folderIds: Set<string>): boolean {
  return !parentId || parentId === '0' || !folderIds.has(parentId);
}

function subtreeHasBookmark(node: ExportNode): boolean {
  if (node.kind === 'bookmark') return true;
  return node.children.some(subtreeHasBookmark);
}

function buildExportForest(folders: BookmarkFolderRecord[], bookmarks: BookmarkRecord[]): ExportNode[] {
  const folderIds = new Set(folders.map((folder) => folder.id));
  const childFolders = new Map<string, BookmarkFolderRecord[]>();
  const childBookmarks = new Map<string, BookmarkRecord[]>();
  const rootFolders: BookmarkFolderRecord[] = [];
  const rootBookmarks: BookmarkRecord[] = [];

  const push = <T,>(map: Map<string, T[]>, parentId: string, value: T) => {
    const list = map.get(parentId) ?? [];
    list.push(value);
    map.set(parentId, list);
  };

  for (const folder of folders) {
    if (isMissingParent(folder.parentId, folderIds)) rootFolders.push(folder);
    else push(childFolders, folder.parentId as string, folder);
  }
  for (const bookmark of bookmarks) {
    if (isMissingParent(bookmark.parentId, folderIds)) rootBookmarks.push(bookmark);
    else push(childBookmarks, bookmark.parentId, bookmark);
  }

  const buildFolder = (folder: BookmarkFolderRecord): ExportNode => {
    const children: ExportNode[] = [
      ...(childFolders.get(folder.id) ?? []).map(buildFolder),
      ...(childBookmarks.get(folder.id) ?? []).map((bookmark) => ({ kind: 'bookmark' as const, bookmark })),
    ].sort(compareExportNodes);
    return { kind: 'folder', folder, children };
  };

  return [
    ...rootFolders.map(buildFolder),
    ...rootBookmarks.map((bookmark) => ({ kind: 'bookmark' as const, bookmark })),
  ].sort(compareExportNodes);
}

function escapeMarkdownLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
}

function escapeMarkdownUrl(value: string): string {
  return value.replace(/[()]/g, (char) => encodeURIComponent(char));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function decodeEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, '')).trim();
}

function writeMarkdown(nodes: ExportNode[], depth: number, lines: string[]): void {
  for (const node of nodes) {
    if (node.kind === 'bookmark') {
      lines.push(`- [${escapeMarkdownLabel(node.bookmark.title)}](${escapeMarkdownUrl(node.bookmark.url)})`);
      continue;
    }
    if (!subtreeHasBookmark(node)) continue;
    if (node.folder.isSpecialRoot) {
      writeMarkdown(node.children, depth, lines);
      continue;
    }
    lines.push(`${'#'.repeat(Math.min(depth + 1, 6))} ${node.folder.title}`);
    writeMarkdown(node.children, depth + 1, lines);
  }
}

function writeNetscape(nodes: ExportNode[], indent: string): string[] {
  const lines: string[] = [];
  for (const node of nodes) {
    if (node.kind === 'bookmark') {
      lines.push(`${indent}<DT><A HREF="${escapeHtml(node.bookmark.url)}">${escapeHtml(node.bookmark.title)}</A>`);
      continue;
    }
    if (!subtreeHasBookmark(node)) continue;
    lines.push(`${indent}<DT><H3>${escapeHtml(node.folder.title)}</H3>`);
    lines.push(`${indent}<DL><p>`);
    lines.push(...writeNetscape(node.children, `${indent}    `));
    lines.push(`${indent}</DL><p>`);
  }
  return lines;
}

export function bookmarksToMarkdown(folders: BookmarkFolderRecord[], bookmarks: BookmarkRecord[]): string {
  const lines: string[] = [];
  writeMarkdown(buildExportForest(folders, bookmarks), 1, lines);
  return lines.join('\n');
}

export function bookmarksToNetscapeHtml(folders: BookmarkFolderRecord[], bookmarks: BookmarkRecord[]): string {
  const body = writeNetscape(buildExportForest(folders, bookmarks), '    ');
  return [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; CHARSET=UTF-8">',
    '<TITLE>Bookmarks</TITLE>',
    '<H1>Bookmarks</H1>',
    '<DL><p>',
    ...body,
    '</DL><p>',
    '',
  ].join('\n');
}

function findOpenTag(html: string, from: number, name: string): { start: number; end: number; attrs: string } | null {
  const match = new RegExp(`<${name}\\b([^>]*)>`, 'ig');
  match.lastIndex = from;
  const found = match.exec(html);
  if (!found) return null;
  return { start: found.index, end: found.index + found[0].length, attrs: found[1] ?? '' };
}

function findMatchingClose(html: string, from: number, name: string): { innerEnd: number; end: number } | null {
  const openRe = new RegExp(`<${name}\\b[^>]*>`, 'ig');
  const closeRe = new RegExp(`</${name}\\s*>`, 'ig');
  let depth = 1;
  let cursor = from;
  while (cursor < html.length) {
    openRe.lastIndex = cursor;
    closeRe.lastIndex = cursor;
    const open = openRe.exec(html);
    const close = closeRe.exec(html);
    if (!close) return null;
    if (open && open.index < close.index) {
      depth += 1;
      cursor = open.index + open[0].length;
      continue;
    }
    depth -= 1;
    if (depth === 0) return { innerEnd: close.index, end: close.index + close[0].length };
    cursor = close.index + close[0].length;
  }
  return null;
}

function extractElement(html: string, from: number, name: string): { attrs: string; inner: string; end: number } | null {
  const open = findOpenTag(html, from, name);
  if (!open) return null;
  const close = findMatchingClose(html, open.end, name);
  if (!close) return { attrs: open.attrs, inner: '', end: open.end };
  return { attrs: open.attrs, inner: html.slice(open.end, close.innerEnd), end: close.end };
}

function readAttr(attrs: string, name: string): string {
  const match = attrs.match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return decodeEntities(match?.[2] ?? match?.[3] ?? match?.[4] ?? '');
}

function skipNoise(html: string, from: number): number {
  let cursor = from;
  while (cursor < html.length) {
    const rest = html.slice(cursor);
    const space = rest.match(/^\s+/);
    if (space) {
      cursor += space[0].length;
      continue;
    }
    if (/^<!--/.test(rest)) {
      const end = html.indexOf('-->', cursor + 4);
      cursor = end < 0 ? html.length : end + 3;
      continue;
    }
    if (/^<\/?p\b/i.test(rest)) {
      const end = html.indexOf('>', cursor);
      cursor = end < 0 ? html.length : end + 1;
      continue;
    }
    break;
  }
  return cursor;
}

function parseDlChildren(
  body: string,
  parentId: string,
  nextId: () => string,
): chrome.bookmarks.BookmarkTreeNode[] {
  const nodes: chrome.bookmarks.BookmarkTreeNode[] = [];
  let cursor = 0;
  let index = 0;
  while (cursor < body.length) {
    const dt = findOpenTag(body, cursor, 'DT');
    if (!dt) break;
    cursor = skipNoise(body, dt.end);
    if (findOpenTag(body, cursor, 'H3')?.start === cursor) {
      const heading = extractElement(body, cursor, 'H3');
      if (!heading) break;
      cursor = skipNoise(body, heading.end);
      const id = nextId();
      let children: chrome.bookmarks.BookmarkTreeNode[] = [];
      if (findOpenTag(body, cursor, 'DL')?.start === cursor) {
        const nested = extractElement(body, cursor, 'DL');
        if (nested) {
          children = parseDlChildren(nested.inner, id, nextId);
          cursor = nested.end;
        }
      }
      nodes.push({
        id,
        parentId,
        title: stripTags(heading.inner),
        index,
        children,
      });
      index += 1;
      continue;
    }
    if (findOpenTag(body, cursor, 'A')?.start === cursor) {
      const link = extractElement(body, cursor, 'A');
      if (!link) break;
      cursor = link.end;
      nodes.push({
        id: nextId(),
        parentId,
        title: stripTags(link.inner),
        url: readAttr(link.attrs, 'HREF'),
        index,
      });
      index += 1;
      continue;
    }
    cursor = dt.end + 1;
  }
  return nodes;
}

export function parseNetscapeBookmarkHtml(html: string): chrome.bookmarks.BookmarkTreeNode[] {
  let next = 1;
  const nextId = () => String(next++);
  const firstDl = extractElement(html, 0, 'DL');
  return [{
    id: '0',
    title: '',
    children: firstDl ? parseDlChildren(firstDl.inner, '0', nextId) : [],
  }];
}
