import {
  BookmarkDuplicateGroup,
  BookmarkFolderKind,
  BookmarkFolderRecord,
  BookmarkFolderSuggestion,
  BookmarkRecord,
  ProjectMemoryRule,
} from './types';
import { canonicalizeUrl, extractProjectTokens, getHostname } from './url';

const OTHER_ROOT_TITLES = new Set(['other bookmarks', '其他书签']);
const BAR_ROOT_TITLES = new Set(['bookmarks bar', '书签栏']);
const MOBILE_ROOT_TITLES = new Set(['mobile bookmarks', '移动设备书签']);
type BookmarkTreeNodeWithFolderType = chrome.bookmarks.BookmarkTreeNode & {
  folderType?: 'bookmarks-bar' | 'other' | 'mobile' | 'managed';
  unmodifiable?: 'managed';
};

export type BookmarkFileMove = {
  id: string;
  fromParentId: string;
  fromIndex: number;
  toParentId: string;
};

export type BookmarkIndexMove = {
  id: string;
  fromParentId: string;
  fromIndex: number;
  toParentId: string;
  toIndex: number;
};

export function shouldRestoreMovedBookmark(
  move: BookmarkIndexMove,
  liveNode: { parentId?: string; index?: number } | undefined,
): boolean {
  if (!liveNode) return false;
  const leftDestination = liveNode.parentId !== move.fromParentId || liveNode.index !== move.fromIndex;
  return leftDestination
    && liveNode.parentId === move.toParentId
    && liveNode.index === move.toIndex;
}

export function shouldRestoreFiledBookmark(
  move: BookmarkFileMove,
  liveNode: chrome.bookmarks.BookmarkTreeNode | undefined,
): boolean {
  return Boolean(liveNode && liveNode.parentId !== move.fromParentId && liveNode.parentId === move.toParentId);
}

export function otherBookmarksRootId(folders: BookmarkFolderRecord[]): string | undefined {
  return folders.find((folder) => folder.folderKind === 'other')?.id;
}

export function canMutateBookmarkNode(node: {
  folderKind: BookmarkFolderKind;
  unmodifiable?: 'managed';
}): boolean {
  return node.folderKind !== 'bar'
    && node.folderKind !== 'other'
    && node.folderKind !== 'mobile'
    && node.folderKind !== 'managed'
    && node.unmodifiable !== 'managed';
}

export function isManagedBookmarkNode(id: string, folders: BookmarkFolderRecord[]): boolean {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  let current = byId.get(id);
  while (current) {
    if (current.folderKind === 'managed' || current.unmodifiable === 'managed') return true;
    if (!current.parentId) break;
    current = byId.get(current.parentId);
  }
  return false;
}

export function canFileIntoBookmarkParent(parentId: string, folders: BookmarkFolderRecord[]): boolean {
  if (isManagedBookmarkNode(parentId, folders)) return false;
  const dest = folders.find((folder) => folder.id === parentId);
  if (!dest) return false;
  return dest.folderKind === 'bar' || dest.folderKind === 'other' || dest.folderKind === 'folder';
}

export function filingDestinationFolders(folders: BookmarkFolderRecord[]): BookmarkFolderRecord[] {
  return folders.filter((folder) => (
    !folder.isSpecialRoot && !folder.isInbox && canFileIntoBookmarkParent(folder.id, folders)
  ));
}

export function folderCreateParentFolders(folders: BookmarkFolderRecord[]): BookmarkFolderRecord[] {
  return folders.filter((folder) => !folder.isInbox && canFileIntoBookmarkParent(folder.id, folders));
}

export function assertFileableBookmarkParent(parentId: string, folders: BookmarkFolderRecord[]): void {
  if (!canFileIntoBookmarkParent(parentId, folders)) {
    throw new Error('That bookmark cannot be changed.');
  }
}

export function assertMutableBookmarkNode(
  live: { id: string; url?: string; unmodifiable?: string; parentId?: string },
  folders: BookmarkFolderRecord[],
): void {
  if (live.unmodifiable === 'managed') {
    throw new Error('That bookmark cannot be changed.');
  }
  if (isManagedBookmarkNode(live.id, folders) || (live.parentId && isManagedBookmarkNode(live.parentId, folders))) {
    throw new Error('That bookmark cannot be changed.');
  }
  const folder = folders.find((item) => item.id === live.id);
  if (folder) {
    if (!canMutateBookmarkNode(folder)) {
      throw new Error('That bookmark cannot be changed.');
    }
    return;
  }
  if (!live.url) {
    throw new Error('That bookmark is no longer available.');
  }
}

export function bookmarkMoveIndex(input: {
  fromIndex: number;
  targetIndex: number;
  placement: 'before' | 'after';
  sameParent?: boolean;
}): number {
  return input.placement === 'after' ? input.targetIndex + 1 : input.targetIndex;
}

export function isBookmarkMoveCycle(
  movingFolderId: string,
  destParentId: string,
  folders: BookmarkFolderRecord[],
): boolean {
  if (destParentId === movingFolderId) return true;
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  let current = byId.get(destParentId);
  while (current) {
    if (current.id === movingFolderId) return true;
    if (!current.parentId) break;
    current = byId.get(current.parentId);
  }
  return false;
}

export function canRestoreBookmarkIntoParent(
  parentId: string,
  liveNode: chrome.bookmarks.BookmarkTreeNode | undefined,
): boolean {
  return Boolean(liveNode && liveNode.id === parentId && !liveNode.url);
}

function isSingleSegmentPath(path: string): boolean {
  return Boolean(path) && !path.includes(' / ');
}

export function isOtherBookmarksRootChild(
  bookmark: BookmarkRecord,
  folders: BookmarkFolderRecord[],
): boolean {
  if (bookmark.parentId === '2') return true;
  if (!bookmark.isInbox) return false;
  const parent = folders.find((folder) => folder.id === bookmark.parentId);
  if (!parent) return isSingleSegmentPath(bookmark.folderPath);
  const specialRootOther = parent.isSpecialRoot && (
    parent.id === '2' || OTHER_ROOT_TITLES.has(normalizedTitle(parent.title))
  );
  return specialRootOther || isSingleSegmentPath(parent.folderPath);
}

export function existingCanonicalUrlsInBookmarkParent(
  bookmarks: BookmarkRecord[],
  folders: BookmarkFolderRecord[],
  parentId?: string,
): Set<string> {
  const matches = parentId
    ? bookmarks.filter((bookmark) => bookmark.parentId === parentId)
    : bookmarks.filter((bookmark) => isOtherBookmarksRootChild(bookmark, folders));
  const urls = new Set<string>();
  for (const bookmark of matches) {
    const canonical = canonicalizeUrl(bookmark.url);
    if (canonical) urls.add(canonical);
  }
  return urls;
}

export function planBookmarkCreates(
  tabs: Array<{ title: string; url: string }>,
  existingCanonicals: Set<string>,
): { toCreate: Array<{ title: string; url: string }>; skipped: number } {
  const toCreate: Array<{ title: string; url: string }> = [];
  const seen = new Set(existingCanonicals);
  let skipped = 0;
  for (const tab of tabs) {
    const canonical = canonicalizeUrl(tab.url);
    if (!canonical || seen.has(canonical)) {
      skipped += 1;
      continue;
    }
    seen.add(canonical);
    toCreate.push(tab);
  }
  return { toCreate, skipped };
}

function normalizedTitle(title: string): string {
  return title.trim().toLocaleLowerCase();
}

function rootKind(
  node: BookmarkTreeNodeWithFolderType,
  isDirectRootChild: boolean,
): 'bar' | 'other' | 'mobile' | 'managed' | null {
  if (node.id === '1') return 'bar';
  if (node.id === '2') return 'other';
  if (node.id === '3') return 'mobile';
  if (node.folderType === 'bookmarks-bar') return 'bar';
  if (node.folderType === 'other') return 'other';
  if (node.folderType === 'mobile') return 'mobile';
  if (node.folderType === 'managed' || node.unmodifiable === 'managed') return 'managed';
  if (!isDirectRootChild) return null;
  const title = normalizedTitle(node.title);
  if (BAR_ROOT_TITLES.has(title)) return 'bar';
  if (OTHER_ROOT_TITLES.has(title)) return 'other';
  if (MOBILE_ROOT_TITLES.has(title)) return 'mobile';
  return null;
}

export function flattenBookmarkTree(nodes: chrome.bookmarks.BookmarkTreeNode[]): {
  bookmarks: BookmarkRecord[];
  folders: BookmarkFolderRecord[];
} {
  const bookmarks: BookmarkRecord[] = [];
  const folders: BookmarkFolderRecord[] = [];

  const visit = (
    node: chrome.bookmarks.BookmarkTreeNode,
    path: string[],
    inheritedKind: ReturnType<typeof rootKind>,
    immediateParentKind: ReturnType<typeof rootKind>,
    insideInbox: boolean,
    parentIsInvisibleRoot: boolean,
  ) => {
    if (node.url) {
      bookmarks.push({
        id: node.id,
        parentId: node.parentId ?? '',
        title: node.title,
        url: node.url,
        dateAdded: node.dateAdded,
        folderPath: path.join(' / '),
        isInbox: immediateParentKind === 'other' || insideInbox,
        isBookmarksBar: inheritedKind === 'bar',
        folderKind: inheritedKind ?? 'folder',
        index: node.index ?? 0,
        ...(node.unmodifiable === 'managed' ? { unmodifiable: 'managed' as const } : {}),
      });
      return;
    }

    const isInvisibleRoot = node.parentId == null && !node.title;
    const isDirectRootChild = node.parentId === '0' || parentIsInvisibleRoot;
    const ownKind = rootKind(node, isDirectRootChild);
    const childKind = ownKind ?? inheritedKind;
    const nextPath = isInvisibleRoot ? path : [...path, node.title];
    const nodeIsInbox = insideInbox || normalizedTitle(node.title) === 'inbox';
    if (!isInvisibleRoot) {
      folders.push({
        id: node.id,
        parentId: node.parentId,
        title: node.title,
        folderPath: nextPath.join(' / '),
        isInbox: nodeIsInbox,
        isSpecialRoot: ownKind !== null
          || isDirectRootChild
          || (node as BookmarkTreeNodeWithFolderType).folderType === 'managed',
        isBookmarksBar: ownKind === 'bar',
        folderKind: ownKind ?? (node.unmodifiable === 'managed' ? 'managed' : 'folder'),
        index: node.index ?? 0,
        ...(node.unmodifiable === 'managed' ? { unmodifiable: 'managed' as const } : {}),
      });
    }
    for (const child of node.children ?? []) visit(child, nextPath, childKind, ownKind, nodeIsInbox, isInvisibleRoot);
  };

  for (const node of nodes) visit(node, [], null, null, false, false);
  return { bookmarks, folders };
}

function eligibleFolders(folders: BookmarkFolderRecord[]): BookmarkFolderRecord[] {
  return filingDestinationFolders(folders);
}

function tokenOverlap(left: Iterable<string>, right: Iterable<string>): number {
  const rightSet = new Set(right);
  let count = 0;
  for (const token of left) if (rightSet.has(token)) count += 1;
  return count;
}

export function suggestBookmarkFolder(
  bookmark: BookmarkRecord,
  bookmarks: BookmarkRecord[],
  folders: BookmarkFolderRecord[],
  memory: ProjectMemoryRule[],
): BookmarkFolderSuggestion | null {
  const candidates = eligibleFolders(folders);
  if (!candidates.length) return null;

  const host = getHostname(bookmark.url);
  if (host) {
    const sameHost = bookmarks.filter((item) => item.id !== bookmark.id && getHostname(item.url) === host);
    const counts = new Map<string, number>();
    for (const item of sameHost) counts.set(item.parentId, (counts.get(item.parentId) ?? 0) + 1);
    const hostMatch = candidates
      .map((folder) => ({ folder, count: counts.get(folder.id) ?? 0 }))
      .filter(({ count }) => count >= 2 && count > sameHost.length / 2)
      .sort((left, right) => right.count - left.count || left.folder.folderPath.localeCompare(right.folder.folderPath))[0];
    if (hostMatch) {
      return {
        folderId: hostMatch.folder.id,
        folderTitle: hostMatch.folder.title,
        confidence: 'high',
        reason: `${hostMatch.count} bookmarks from ${host} are already filed here.`,
      };
    }
  }

  const bookmarkTokens = new Set(extractProjectTokens({ title: bookmark.title, url: bookmark.url, summary: bookmark.summary }));
  for (const rule of memory) {
    if (!rule.tokens.length || tokenOverlap(rule.tokens, bookmarkTokens) / new Set(rule.tokens).size < 0.6) continue;
    const folder = candidates.find((item) => normalizedTitle(item.title) === normalizedTitle(rule.projectName));
    if (folder) {
      return {
        folderId: folder.id,
        folderTitle: folder.title,
        confidence: 'high',
        reason: `Matches the saved project rule for ${rule.projectName}.`,
      };
    }
  }

  const tokenMatch = candidates
    .map((folder) => ({
      folder,
      overlap: tokenOverlap(
        extractProjectTokens({ title: folder.title, url: '' }),
        bookmarkTokens,
      ),
    }))
    .filter(({ overlap }) => overlap > 0)
    .sort((left, right) => right.overlap - left.overlap || left.folder.folderPath.localeCompare(right.folder.folderPath))[0];
  return tokenMatch
    ? {
        folderId: tokenMatch.folder.id,
        folderTitle: tokenMatch.folder.title,
        confidence: 'medium',
        reason: `Bookmark text matches the folder name ${tokenMatch.folder.title}.`,
      }
    : null;
}

function keepPriority(bookmark: BookmarkRecord): [number, number, number] {
  return [bookmark.isInbox ? 0 : 1, bookmark.isBookmarksBar ? 1 : 0, bookmark.dateAdded ?? 0];
}

function compareKeepPriority(left: BookmarkRecord, right: BookmarkRecord): number {
  const a = keepPriority(left);
  const b = keepPriority(right);
  return b[0] - a[0] || b[1] - a[1] || b[2] - a[2] || left.id.localeCompare(right.id);
}

export function findBookmarkDuplicateGroups(bookmarks: BookmarkRecord[]): BookmarkDuplicateGroup[] {
  const byCanonical = new Map<string, BookmarkRecord[]>();
  for (const bookmark of bookmarks) {
    const canonical = canonicalizeUrl(bookmark.url);
    if (!canonical) continue;
    const group = byCanonical.get(canonical) ?? [];
    group.push(bookmark);
    byCanonical.set(canonical, group);
  }
  return [...byCanonical.entries()]
    .filter(([, group]) => group.length >= 2)
    .map(([canonicalUrl, group]) => {
      const ordered = [...group].sort(compareKeepPriority);
      return {
        canonicalUrl,
        keepId: ordered[0].id,
        removeIds: ordered.slice(1).map((bookmark) => bookmark.id),
      };
    })
    .sort((left, right) => left.canonicalUrl.localeCompare(right.canonicalUrl));
}

export function validateBookmarkDedupGroups(
  liveBookmarks: BookmarkRecord[],
  requestedGroups: Array<{ keepId: string; removeIds: string[] }>,
): Array<{ keepId: string; removeIds: string[] }> {
  const liveById = new Map(liveBookmarks.map((bookmark) => [bookmark.id, bookmark]));
  return requestedGroups.flatMap((group) => {
    const keep = liveById.get(group.keepId);
    const canonical = keep ? canonicalizeUrl(keep.url) : null;
    if (!canonical) return [];
    const removeIds = [...new Set(group.removeIds)].filter((id) => {
      if (id === group.keepId) return false;
      const remove = liveById.get(id);
      return Boolean(remove && canonicalizeUrl(remove.url) === canonical);
    });
    return removeIds.length ? [{ keepId: group.keepId, removeIds }] : [];
  });
}
