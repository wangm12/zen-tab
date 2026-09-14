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

function isHiddenRoot(folder: BookmarkFolderRecord): boolean {
  return folder.folderKind === 'other';
}

function nodeIndex(node: BookmarkForestNode): number {
  return node.kind === 'folder' ? node.folder.index : node.bookmark.index;
}

function nodeId(node: BookmarkForestNode): string {
  return node.kind === 'folder' ? node.folder.id : node.bookmark.id;
}

function compareIndexThenId(left: BookmarkForestNode, right: BookmarkForestNode): number {
  return nodeIndex(left) - nodeIndex(right) || nodeId(left).localeCompare(nodeId(right));
}

function rootRank(folder: BookmarkFolderRecord): number {
  if (folder.folderKind === 'bar' || folder.isBookmarksBar) return 0;
  if (folder.folderKind === 'mobile') return 2;
  if (folder.folderKind === 'managed') return 3;
  return 1;
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
  const mixed: BookmarkForestNode[] = [
    ...(childFolders.get(folder.id) ?? []).map((child) => buildFolderNode(child, childFolders, childBookmarks)),
    ...(childBookmarks.get(folder.id) ?? []).map((item) => ({ kind: 'bookmark' as const, bookmark: item })),
  ].sort(compareIndexThenId);
  const count = mixed.reduce((total, child) => total + (child.kind === 'folder' ? child.count : 1), 0);
  return { kind: 'folder', folder, children: mixed, count };
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
    if (isHiddenRoot(folder)) continue;
    push(childFolders, folder.parentId, folder);
  }

  for (const bookmark of bookmarks) {
    if (trayIds.has(bookmark.id)) continue;
    const parent = lookup.get(bookmark.parentId);
    if (!parent || isHiddenRoot(parent)) continue;
    push(childBookmarks, bookmark.parentId, bookmark);
  }

  const roots = folders.filter((folder) => {
    if (isHiddenRoot(folder)) return false;
    const parent = folder.parentId ? lookup.get(folder.parentId) : undefined;
    return !parent || isHiddenRoot(parent);
  }).sort((left, right) => (
    rootRank(left) - rootRank(right)
    || left.index - right.index
    || left.id.localeCompare(right.id)
  ));

  return roots.map((folder) => buildFolderNode(folder, childFolders, childBookmarks));
}

export const INBOX_COLLAPSE_ID = '__inbox__';

export type VisibleBookmarkRow =
  | { kind: 'inbox'; count: number; collapsed: boolean }
  | { kind: 'search'; count: number }
  | { kind: 'folder'; folder: BookmarkFolderRecord; count: number; depth: number; collapsed: boolean }
  | { kind: 'bookmark'; bookmark: BookmarkRecord; depth: number; inbox: boolean }
  | { kind: 'empty-slot'; folderId: string; depth: number };

export function flattenVisibleBookmarkRows(input: {
  forest: BookmarkForestNode[];
  collapsedFolderIds: ReadonlySet<string>;
  inbox: BookmarkRecord[];
  includeInbox?: boolean;
  searching?: boolean;
  searchHits?: BookmarkRecord[];
}): VisibleBookmarkRow[] {
  if (input.searching) {
    const hits = input.searchHits ?? [];
    if (!hits.length) return [];
    return [
      { kind: 'search', count: hits.length },
      ...hits.map((bookmark) => ({ kind: 'bookmark' as const, bookmark, depth: 0, inbox: false })),
    ];
  }

  const rows: VisibleBookmarkRow[] = [];
  if (input.includeInbox !== false) {
    const collapsed = input.collapsedFolderIds.has(INBOX_COLLAPSE_ID);
    rows.push({ kind: 'inbox', count: input.inbox.length, collapsed });
    if (!collapsed) {
      for (const bookmark of input.inbox) {
        rows.push({ kind: 'bookmark', bookmark, depth: 1, inbox: true });
      }
    }
  }

  const walk = (nodes: BookmarkForestNode[], depth: number) => {
    for (const node of nodes) {
      if (node.kind === 'bookmark') {
        rows.push({ kind: 'bookmark', bookmark: node.bookmark, depth, inbox: false });
        continue;
      }
      const collapsed = input.collapsedFolderIds.has(node.folder.id);
      rows.push({
        kind: 'folder',
        folder: node.folder,
        count: node.count,
        depth,
        collapsed,
      });
      if (!collapsed) {
        if (node.children.length === 0) {
          rows.push({ kind: 'empty-slot', folderId: node.folder.id, depth: depth + 1 });
        } else {
          walk(node.children, depth + 1);
        }
      }
    }
  };
  walk(input.forest, 0);
  return rows;
}
