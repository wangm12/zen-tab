import { BookmarkFolderRecord, BookmarkRecord } from './types';

export type BookmarkForestNode =
  | { kind: 'folder'; folder: BookmarkFolderRecord; children: BookmarkForestNode[]; count: number }
  | { kind: 'bookmark'; bookmark: BookmarkRecord };

const INBOX_TITLE = /^inbox$/i;

function foldersById(folders: BookmarkFolderRecord[]): Map<string, BookmarkFolderRecord> {
  return new Map(folders.map((folder) => [folder.id, folder]));
}

function hasSinglePathSegment(folderPath: string): boolean {
  return folderPath.split(' / ').filter(Boolean).length === 1;
}

function isInboxParent(folder: BookmarkFolderRecord): boolean {
  return (folder.isSpecialRoot && folder.isInbox)
    || INBOX_TITLE.test(folder.title)
    || hasSinglePathSegment(folder.folderPath);
}

function isSkippedSpecialRoot(folder: BookmarkFolderRecord): boolean {
  return folder.isSpecialRoot && !folder.isBookmarksBar;
}

function compareTitle(left: { title: string }, right: { title: string }): number {
  return left.title.localeCompare(right.title);
}

export function inboxBookmarks(bookmarks: BookmarkRecord[], folders: BookmarkFolderRecord[]): BookmarkRecord[] {
  const lookup = foldersById(folders);
  return bookmarks.filter((bookmark) => {
    if (!bookmark.isInbox) return false;
    const parent = lookup.get(bookmark.parentId);
    return Boolean(parent && isInboxParent(parent));
  });
}

function buildFolderNode(
  folder: BookmarkFolderRecord,
  childFolders: Map<string, BookmarkFolderRecord[]>,
  childBookmarks: Map<string, BookmarkRecord[]>,
): BookmarkForestNode {
  const folders = [...(childFolders.get(folder.id) ?? [])].sort(compareTitle);
  const bookmarks = [...(childBookmarks.get(folder.id) ?? [])].sort(compareTitle);
  const children: BookmarkForestNode[] = [
    ...folders.map((child) => buildFolderNode(child, childFolders, childBookmarks)),
    ...bookmarks.map((bookmark) => ({ kind: 'bookmark' as const, bookmark })),
  ];
  const count = children.reduce((total, child) => total + (child.kind === 'folder' ? child.count : 1), 0);
  return { kind: 'folder', folder, children, count };
}

export function buildBookmarkForest(folders: BookmarkFolderRecord[], bookmarks: BookmarkRecord[]): BookmarkForestNode[] {
  const lookup = foldersById(folders);
  const trayIds = new Set(inboxBookmarks(bookmarks, folders).map((bookmark) => bookmark.id));
  const childFolders = new Map<string, BookmarkFolderRecord[]>();
  const childBookmarks = new Map<string, BookmarkRecord[]>();

  const push = <T,>(map: Map<string, T[]>, parentId: string | undefined, value: T) => {
    if (!parentId) return;
    const list = map.get(parentId) ?? [];
    list.push(value);
    map.set(parentId, list);
  };

  for (const folder of folders) {
    if (isSkippedSpecialRoot(folder)) continue;
    push(childFolders, folder.parentId, folder);
  }

  for (const bookmark of bookmarks) {
    if (trayIds.has(bookmark.id)) continue;
    const parent = lookup.get(bookmark.parentId);
    if (!parent || isSkippedSpecialRoot(parent)) continue;
    push(childBookmarks, bookmark.parentId, bookmark);
  }

  const roots = folders.filter((folder) => {
    if (isSkippedSpecialRoot(folder)) return false;
    if (folder.isBookmarksBar) return true;
    const parent = folder.parentId ? lookup.get(folder.parentId) : undefined;
    return !parent || isSkippedSpecialRoot(parent);
  }).sort(compareTitle);

  return roots.map((folder) => buildFolderNode(folder, childFolders, childBookmarks));
}
