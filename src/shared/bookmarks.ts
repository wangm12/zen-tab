import {
  BookmarkDuplicateGroup,
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
};

export type BookmarkFileMove = {
  id: string;
  fromParentId: string;
  fromIndex: number;
  toParentId: string;
};

export function shouldRestoreFiledBookmark(
  move: BookmarkFileMove,
  liveNode: chrome.bookmarks.BookmarkTreeNode | undefined,
): boolean {
  return Boolean(liveNode && liveNode.parentId !== move.fromParentId && liveNode.parentId === move.toParentId);
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

function rootKind(node: BookmarkTreeNodeWithFolderType): 'bar' | 'other' | 'mobile' | null {
  if (node.id === '1') return 'bar';
  if (node.id === '2') return 'other';
  if (node.id === '3') return 'mobile';
  if (node.folderType === 'bookmarks-bar') return 'bar';
  if (node.folderType === 'other') return 'other';
  if (node.folderType === 'mobile') return 'mobile';
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
    parentKind: ReturnType<typeof rootKind>,
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
        index: node.index,
        folderPath: path.join(' / '),
        isInbox: parentKind === 'other' || insideInbox,
        isBookmarksBar: parentKind === 'bar',
      });
      return;
    }

    const kind = rootKind(node);
    const isInvisibleRoot = node.parentId == null && !node.title;
    const isDirectRootChild = node.parentId === '0' || parentIsInvisibleRoot;
    const nextPath = isInvisibleRoot ? path : [...path, node.title];
    const nodeIsInbox = insideInbox || normalizedTitle(node.title) === 'inbox';
    if (!isInvisibleRoot) {
      folders.push({
        id: node.id,
        parentId: node.parentId,
        title: node.title,
        folderPath: nextPath.join(' / '),
        isInbox: nodeIsInbox,
        isSpecialRoot: kind !== null
          || isDirectRootChild
          || (node as BookmarkTreeNodeWithFolderType).folderType === 'managed',
        isBookmarksBar: kind === 'bar',
      });
    }
    for (const child of node.children ?? []) visit(child, nextPath, kind, nodeIsInbox, isInvisibleRoot);
  };

  for (const node of nodes) visit(node, [], null, false, false);
  return { bookmarks, folders };
}

function eligibleFolders(folders: BookmarkFolderRecord[]): BookmarkFolderRecord[] {
  return folders.filter((folder) => !folder.isSpecialRoot && !folder.isInbox);
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
