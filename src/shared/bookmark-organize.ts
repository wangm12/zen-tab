import { BookmarkFilingCreate, BookmarkFilingMove } from './bookmark-filing';
import { canFileIntoBookmarkParent, canMutateBookmarkNode, filingDestinationFolders, isManagedBookmarkNode, otherBookmarksRootId } from './bookmarks';
import { BookmarkFolderRecord, BookmarkOrganizeScope, BookmarkOrganizeSnapshot, BookmarkOrganizeSnapshotSummary, BookmarkRecord, Language } from './types';
import { getHostname, rootDomainFromHost } from './url';
import {
  cleanBookmarkTitle,
  extractTitleKeywords,
  formatKeywordFolderTitle,
  titleFolderMatchScore,
} from './bookmark-title';

const GENERIC_LABELS = new Set([
  'www', 'com', 'org', 'net', 'edu', 'gov', 'io', 'co', 'app', 'dev', 'ai', 'so', 'me', 'info', 'xyz',
]);

export const BRAND_NAMES: Record<string, string> = {
  'google.com': 'Google',
  'github.com': 'GitHub',
  'youtube.com': 'YouTube',
  'bilibili.com': 'Bilibili',
  'zhihu.com': 'Zhihu',
  'juejin.cn': '掘金',
  'stackoverflow.com': 'Stack Overflow',
  'reddit.com': 'Reddit',
  'twitter.com': 'X / Twitter',
  'x.com': 'X / Twitter',
  'notion.so': 'Notion',
  'figma.com': 'Figma',
  'slack.com': 'Slack',
  'discord.com': 'Discord',
  'medium.com': 'Medium',
  'wikipedia.org': 'Wikipedia',
  'live.com': 'Microsoft',
  'office.com': 'Microsoft',
  'microsoft.com': 'Microsoft',
  'apple.com': 'Apple',
  'amazon.com': 'Amazon',
  'aliyun.com': '阿里云',
  'tencent.com': '腾讯云',
  'taobao.com': '淘宝',
  'jd.com': '京东',
  'weibo.com': '微博',
};

export type BookmarkOrganizeCluster = {
  key: string;
  folderTitle: string;
  folderId?: string;
  clientId?: string;
  bookmarkIds: string[];
  create: boolean;
  reason: string;
};

export type BookmarkOrganizeProposal = {
  creates: BookmarkFilingCreate[];
  moves: BookmarkFilingMove[];
  clusters: BookmarkOrganizeCluster[];
  claimedBookmarkIds?: string[];
};

export const BOOKMARK_ORGANIZE_SNAPSHOT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const BOOKMARK_ORGANIZE_SNAPSHOT_LIMIT = 3;
export const BOOKMARK_ORGANIZE_SNAPSHOTS_JSON_LIMIT = 500_000;

export function pruneBookmarkOrganizeSnapshots(
  snapshots: BookmarkOrganizeSnapshot[],
  now: number,
  jsonLimit = BOOKMARK_ORGANIZE_SNAPSHOTS_JSON_LIMIT,
): BookmarkOrganizeSnapshot[] {
  const live = snapshots
    .filter((item) => item.expiresAt > now)
    .sort((left, right) => left.createdAt - right.createdAt);
  let next = live.length > BOOKMARK_ORGANIZE_SNAPSHOT_LIMIT
    ? live.slice(live.length - BOOKMARK_ORGANIZE_SNAPSHOT_LIMIT)
    : live;
  while (next.length && JSON.stringify(next).length > jsonLimit) next = next.slice(1);
  return next;
}

export function toBookmarkOrganizeSnapshotSummary(
  snapshot: BookmarkOrganizeSnapshot,
): BookmarkOrganizeSnapshotSummary {
  return { id: snapshot.id, createdAt: snapshot.createdAt, expiresAt: snapshot.expiresAt, moveCount: snapshot.moveCount };
}

export function organizeSnapshotDaysLeft(expiresAt: number, now: number): number {
  return Math.ceil((expiresAt - now) / 86_400_000);
}

export function visibleBookmarkOrganizeSnapshots(
  snapshots: BookmarkOrganizeSnapshotSummary[],
  now: number,
): Array<BookmarkOrganizeSnapshotSummary & { daysLeft: number }> {
  return snapshots.flatMap((snapshot) => {
    const daysLeft = organizeSnapshotDaysLeft(snapshot.expiresAt, now);
    if (snapshot.expiresAt > now && daysLeft >= 1) return [{ ...snapshot, daysLeft }];
    return [];
  });
}

export function formatOrganizeSnapshotTime(createdAt: number, language: Language): string {
  return new Date(createdAt).toLocaleString(language === 'zh' ? 'zh-CN' : 'en');
}

function titleCase(label: string): string {
  if (!label) return '';
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function clusterHostFromUrl(url: string): string {
  return rootDomainFromHost(getHostname(url));
}

export function folderTitleFromHost(host: string): string {
  const cleanHost = host.trim().toLowerCase().replace(/^www\./, '');
  if (BRAND_NAMES[cleanHost]) return BRAND_NAMES[cleanHost];
  const rootDomain = rootDomainFromHost(cleanHost);
  if (rootDomain && BRAND_NAMES[rootDomain]) return BRAND_NAMES[rootDomain];
  const parts = cleanHost.split('.').filter(Boolean);
  return titleCase(parts[0] ?? cleanHost);
}

export function normalizeOrganizeName(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, '');
}

function hostLabels(host: string): string[] {
  return host.replace(/^www\./, '').split('.').filter((part) => part.length >= 3 && !GENERIC_LABELS.has(part));
}

export function folderHostMatchScore(folderTitle: string, host: string, suggestedTitle: string): number {
  const name = normalizeOrganizeName(folderTitle);
  if (!name) return 0;
  const bare = host.replace(/^www\./, '');
  const labels = hostLabels(host);
  if (name === normalizeOrganizeName(suggestedTitle)) return 4;
  if (name === bare) return 3;
  if (labels.some((label) => name === label)) return 2;
  if (labels.some((label) => label.length >= 4 && (name.includes(label) || label.includes(name)))) return 1;
  return 0;
}

function folderHasKindAncestor(
  id: string,
  folders: BookmarkFolderRecord[],
  kind: BookmarkFolderRecord['folderKind'],
): boolean {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  let current = byId.get(id);
  while (current) {
    if (current.folderKind === kind) return true;
    if (!current.parentId) break;
    current = byId.get(current.parentId);
  }
  return false;
}

export function folderHasBarAncestor(id: string, folders: BookmarkFolderRecord[]): boolean {
  return folderHasKindAncestor(id, folders, 'bar');
}

export function canOrganizeBookmark(
  bookmark: BookmarkRecord,
  folders: BookmarkFolderRecord[],
  foldersById?: Map<string, BookmarkFolderRecord>,
  scope: BookmarkOrganizeScope = 'unfiled',
): boolean {
  if (!bookmark.url || !clusterHostFromUrl(bookmark.url)) return false;
  if (bookmark.unmodifiable === 'managed') return false;
  if (bookmark.folderKind === 'managed' || bookmark.folderKind === 'mobile') return false;
  if (isManagedBookmarkNode(bookmark.parentId, folders)) return false;

  const byId = foldersById ?? new Map(folders.map((folder) => [folder.id, folder]));
  const parent = byId.get(bookmark.parentId);
  if (!parent) return false;
  if (parent.folderKind === 'managed' || parent.unmodifiable === 'managed') return false;
  if (parent.folderKind === 'mobile' || folderHasKindAncestor(parent.id, folders, 'mobile')) return false;

  const isBar = parent.folderKind === 'bar' || folderHasBarAncestor(parent.id, folders) || Boolean(bookmark.isBookmarksBar);
  const isOther = !isBar && (parent.folderKind === 'other' || folderHasKindAncestor(parent.id, folders, 'other'));

  if (scope === 'bar') {
    return isBar;
  }

  if (scope === 'other') {
    return isOther;
  }

  if (scope === 'unfiled') {
    if (!isBar && !isOther) return false;
    const isDirectRoot = bookmark.parentId === '1'
      || bookmark.parentId === '2'
      || Boolean(parent.isInbox)
      || Boolean(bookmark.isInbox)
      || (parent.isSpecialRoot && (parent.folderKind === 'bar' || parent.folderKind === 'other'));
    const isRootOrInboxParent = Boolean(parent.isSpecialRoot || parent.isInbox);
    return isDirectRoot && isRootOrInboxParent;
  }

  if (scope === 'all') {
    return isBar || isOther;
  }

  return false;
}

export function organizeDestinationFolders(
  folders: BookmarkFolderRecord[],
  scope: BookmarkOrganizeScope = 'unfiled',
): BookmarkFolderRecord[] {
  const allowBar = scope !== 'other';
  return filingDestinationFolders(folders).filter((folder) => (
    (allowBar || !folderHasBarAncestor(folder.id, folders))
    && !folderHasKindAncestor(folder.id, folders, 'mobile')
    && normalizeOrganizeName(folder.title) !== 'inbox'
  ));
}

function isAlreadyHome(
  bookmark: BookmarkRecord,
  host: string,
  suggestedTitle: string,
  foldersById: Map<string, BookmarkFolderRecord>,
): boolean {
  const parent = foldersById.get(bookmark.parentId);
  if (!parent || parent.isSpecialRoot || parent.isInbox) return false;
  return folderHostMatchScore(parent.title, host, suggestedTitle) > 0;
}

function resolveClusterDestination(
  host: string,
  suggestedTitle: string,
  destinations: BookmarkFolderRecord[],
  pagesByParent: Map<string, BookmarkRecord[]>,
): BookmarkFolderRecord | undefined {
  const named = destinations
    .map((folder) => ({ folder, score: folderHostMatchScore(folder.title, host, suggestedTitle) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.folder.folderPath.localeCompare(right.folder.folderPath))[0];
  if (named) return named.folder;

  return destinations
    .map((folder) => {
      const children = pagesByParent.get(folder.id) ?? [];
      const count = children.filter((bookmark) => clusterHostFromUrl(bookmark.url) === host).length;
      return { folder, count, purity: children.length ? count / children.length : 0 };
    })
    .filter((item) => item.purity >= 0.7 && item.count >= 2)
    .sort((left, right) => right.count - left.count || left.folder.folderPath.localeCompare(right.folder.folderPath))[0]
    ?.folder;
}

function clientIdForHost(host: string, used: Set<string>): string {
  const base = `organize-${host.replace(/[^a-z0-9]+/g, '-')}`;
  let id = base;
  let suffix = 2;
  while (used.has(id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  used.add(id);
  return id;
}

function topicClientId(title: string, used: Set<string>): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'topic';
  const base = `organize-topic-${slug}`;
  let id = base;
  let suffix = 2;
  while (used.has(id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  used.add(id);
  return id;
}

function getClusterCreateRoot(
  scope: BookmarkOrganizeScope,
  items: BookmarkRecord[],
  foldersById: Map<string, BookmarkFolderRecord>,
  barRoot: string,
  otherRoot: string | undefined,
): string | undefined {
  if (scope === 'bar') return barRoot;
  if (scope === 'other') return otherRoot;
  if (scope === 'unfiled') {
    const isBar = items.some((item) => {
      if (item.parentId === '1' || item.parentId === barRoot) return true;
      const parent = foldersById.get(item.parentId);
      return parent?.folderKind === 'bar';
    });
    return isBar ? barRoot : otherRoot;
  }
  const isBar = items.some((item) => {
    if (item.parentId === '1' || item.parentId === barRoot) return true;
    const parent = foldersById.get(item.parentId);
    return parent?.folderKind === 'bar';
  });
  return isBar ? barRoot : otherRoot;
}

export function proposeBookmarkOrganize(input: {
  bookmarks: BookmarkRecord[];
  folders: BookmarkFolderRecord[];
  scope?: BookmarkOrganizeScope;
}): BookmarkOrganizeProposal {
  const scope = input.scope ?? 'unfiled';
  const foldersById = new Map(input.folders.map((folder) => [folder.id, folder]));
  const destinations = organizeDestinationFolders(input.folders, scope);
  const barRoot = input.folders.find((folder) => folder.folderKind === 'bar')?.id ?? '1';
  const otherRoot = otherBookmarksRootId(input.folders);

  const pagesByParent = new Map<string, BookmarkRecord[]>();
  for (const bookmark of input.bookmarks) {
    if (!clusterHostFromUrl(bookmark.url)) continue;
    const siblings = pagesByParent.get(bookmark.parentId) ?? [];
    siblings.push(bookmark);
    pagesByParent.set(bookmark.parentId, siblings);
  }

  const candidates: Array<{
    bookmark: BookmarkRecord;
    cleanTitle: string;
    keywords: string[];
    host: string;
  }> = [];

  for (const bookmark of input.bookmarks) {
    if (!canOrganizeBookmark(bookmark, input.folders, foldersById, scope)) continue;
    const host = clusterHostFromUrl(bookmark.url);
    const cleanTitle = cleanBookmarkTitle(bookmark.title, bookmark.url);
    const keywords = extractTitleKeywords(cleanTitle);
    candidates.push({ bookmark, cleanTitle, keywords, host });
  }

  const creates: BookmarkFilingCreate[] = [];
  const moves: BookmarkFilingMove[] = [];
  const clusters: BookmarkOrganizeCluster[] = [];
  const assigned = new Set<string>();
  const usedClientIds = new Set<string>();
  const createdByTitle = new Map<string, string>(); // normalizeOrganizeName(title) -> clientId

  // Priority 1: Match existing folders using Title keywords
  const titleMatchesByFolder = new Map<string, { folder: BookmarkFolderRecord; bookmarks: BookmarkRecord[] }>();

  for (const item of candidates) {
    const parent = foldersById.get(item.bookmark.parentId);
    // If bookmark is already in a non-root folder that matches its title:
    if (parent && !parent.isSpecialRoot && !parent.isInbox && titleFolderMatchScore(item.cleanTitle, item.keywords, parent.title) > 0) {
      assigned.add(item.bookmark.id);
      continue;
    }

    const matches = destinations
      .map((folder) => ({
        folder,
        score: titleFolderMatchScore(item.cleanTitle, item.keywords, folder.title),
      }))
      .filter((m) => m.score > 0)
      .sort((a, b) => b.score - a.score || a.folder.folderPath.localeCompare(b.folder.folderPath));

    if (!matches.length) continue;

    const best = matches[0].folder;
    if (item.bookmark.parentId === best.id) {
      assigned.add(item.bookmark.id);
      continue;
    }

    const entry = titleMatchesByFolder.get(best.id) ?? { folder: best, bookmarks: [] };
    entry.bookmarks.push(item.bookmark);
    titleMatchesByFolder.set(best.id, entry);
    assigned.add(item.bookmark.id);
  }

  for (const [folderId, entry] of titleMatchesByFolder.entries()) {
    if (!entry.bookmarks.length) continue;
    moves.push(...entry.bookmarks.map((b) => ({ bookmarkId: b.id, folderId })));
    clusters.push({
      key: folderId,
      folderTitle: entry.folder.title,
      folderId,
      bookmarkIds: entry.bookmarks.map((b) => b.id),
      create: false,
      reason: `${entry.bookmarks.length} bookmarks for ${entry.folder.title}`,
    });
  }

  // Priority 2: Title keyword clustering (>= 2 bookmarks)
  const unfiled = candidates.filter((item) => !assigned.has(item.bookmark.id));
  const keywordMap = new Map<string, Array<typeof candidates[0]>>();
  for (const item of unfiled) {
    for (const kw of item.keywords) {
      const list = keywordMap.get(kw) ?? [];
      list.push(item);
      keywordMap.set(kw, list);
    }
  }

  const sortedKeywords = [...keywordMap.entries()]
    .filter(([_, items]) => items.length >= 2)
    .sort((a, b) => (
      b[1].length - a[1].length ||
      b[0].length - a[0].length ||
      a[0].localeCompare(b[0])
    ));

  for (const [kw, items] of sortedKeywords) {
    const available = items.filter((item) => !assigned.has(item.bookmark.id));
    const clusterCreateRoot = getClusterCreateRoot(
      scope,
      available.map((item) => item.bookmark),
      foldersById,
      barRoot,
      otherRoot,
    );
    if (available.length < 2 || !clusterCreateRoot) continue;

    const folderTitle = formatKeywordFolderTitle(kw, available.map((item) => item.bookmark.title));
    const normTitle = normalizeOrganizeName(folderTitle);

    const existingDest = destinations.find((d) => normalizeOrganizeName(d.title) === normTitle);
    if (existingDest) {
      moves.push(...available.map((item) => ({ bookmarkId: item.bookmark.id, folderId: existingDest.id })));
      const existingCluster = clusters.find((c) => c.folderId === existingDest.id);
      if (existingCluster) {
        existingCluster.bookmarkIds.push(...available.map((item) => item.bookmark.id));
        existingCluster.reason = `${existingCluster.bookmarkIds.length} bookmarks for ${existingDest.title}`;
      } else {
        clusters.push({
          key: existingDest.id,
          folderTitle: existingDest.title,
          folderId: existingDest.id,
          bookmarkIds: available.map((item) => item.bookmark.id),
          create: false,
          reason: `${available.length} bookmarks for ${existingDest.title}`,
        });
      }
      available.forEach((item) => assigned.add(item.bookmark.id));
      continue;
    }

    let clientId = createdByTitle.get(normTitle);
    let isNewCreate = false;
    if (!clientId) {
      clientId = topicClientId(folderTitle, usedClientIds);
      createdByTitle.set(normTitle, clientId);
      creates.push({ clientId, parentId: clusterCreateRoot, title: folderTitle });
      isNewCreate = true;
    }

    moves.push(...available.map((item) => ({ bookmarkId: item.bookmark.id, folderId: clientId! })));
    const existingCluster = clusters.find((c) => c.clientId === clientId);
    if (existingCluster) {
      existingCluster.bookmarkIds.push(...available.map((item) => item.bookmark.id));
      existingCluster.reason = `${existingCluster.bookmarkIds.length} bookmarks about "${folderTitle}"`;
    } else {
      clusters.push({
        key: clientId,
        folderTitle,
        clientId,
        bookmarkIds: available.map((item) => item.bookmark.id),
        create: isNewCreate,
        reason: `${available.length} bookmarks about "${folderTitle}"`,
      });
    }
    available.forEach((item) => assigned.add(item.bookmark.id));
  }

  // Priority 3: Host / domain clustering fallback
  const remaining = candidates.filter((item) => !assigned.has(item.bookmark.id));
  const byHost = new Map<string, BookmarkRecord[]>();
  for (const item of remaining) {
    const group = byHost.get(item.host) ?? [];
    group.push(item.bookmark);
    byHost.set(item.host, group);
  }

  const hosts = [...byHost.entries()].sort((left, right) => (
    right[1].length - left[1].length || left[0].localeCompare(right[0])
  ));

  for (const [host, group] of hosts) {
    const suggestedTitle = folderTitleFromHost(host);
    const destination = resolveClusterDestination(host, suggestedTitle, destinations, pagesByParent);
    const toMove = group.filter((bookmark) => (
      bookmark.parentId !== destination?.id
      && !isAlreadyHome(bookmark, host, suggestedTitle, foldersById)
    ));

    if (destination) {
      if (!toMove.length) continue;
      moves.push(...toMove.map((bookmark) => ({ bookmarkId: bookmark.id, folderId: destination.id })));
      const existingCluster = clusters.find((c) => c.folderId === destination.id);
      if (existingCluster) {
        existingCluster.bookmarkIds.push(...toMove.map((b) => b.id));
        existingCluster.reason = `${existingCluster.bookmarkIds.length} bookmarks for ${destination.title}`;
      } else {
        clusters.push({
          key: host,
          folderTitle: destination.title,
          folderId: destination.id,
          bookmarkIds: toMove.map((bookmark) => bookmark.id),
          create: false,
          reason: `${toMove.length} bookmarks from ${host}`,
        });
      }
      toMove.forEach((b) => assigned.add(b.id));
      continue;
    }

    const clusterCreateRoot = getClusterCreateRoot(
      scope,
      toMove,
      foldersById,
      barRoot,
      otherRoot,
    );
    if (toMove.length < 2 || !clusterCreateRoot) continue;

    const normTitle = normalizeOrganizeName(suggestedTitle);
    let clientId = createdByTitle.get(normTitle);
    let isNewCreate = false;
    if (!clientId) {
      clientId = clientIdForHost(host, usedClientIds);
      createdByTitle.set(normTitle, clientId);
      creates.push({ clientId, parentId: clusterCreateRoot, title: suggestedTitle });
      isNewCreate = true;
    }

    moves.push(...toMove.map((bookmark) => ({ bookmarkId: bookmark.id, folderId: clientId! })));
    const existingCluster = clusters.find((c) => c.clientId === clientId);
    if (existingCluster) {
      existingCluster.bookmarkIds.push(...toMove.map((b) => b.id));
      existingCluster.reason = `${existingCluster.bookmarkIds.length} bookmarks from ${host}`;
    } else {
      clusters.push({
        key: host,
        folderTitle: suggestedTitle,
        clientId,
        bookmarkIds: toMove.map((bookmark) => bookmark.id),
        create: isNewCreate,
        reason: `${toMove.length} bookmarks from ${host}`,
      });
    }
    toMove.forEach((b) => assigned.add(b.id));
  }

  creates.sort((left, right) => left.title.localeCompare(right.title));
  moves.sort((left, right) => left.bookmarkId.localeCompare(right.bookmarkId));
  clusters.sort((left, right) => left.folderTitle.localeCompare(right.folderTitle));
  return { creates, moves, clusters };
}

function isTopicAlreadyHome(
  bookmark: BookmarkRecord,
  topicName: string,
  foldersById: Map<string, BookmarkFolderRecord>,
): boolean {
  const parent = foldersById.get(bookmark.parentId);
  return Boolean(parent && normalizeOrganizeName(parent.title) === normalizeOrganizeName(topicName));
}

function resolveTopicDestination(
  name: string,
  folderId: unknown,
  destinations: BookmarkFolderRecord[],
): BookmarkFolderRecord | undefined {
  if (typeof folderId === 'string') {
    const dest = destinations.find((folder) => folder.id === folderId);
    if (dest) return dest;
  }
  const topicName = normalizeOrganizeName(name);
  return destinations
    .filter((folder) => normalizeOrganizeName(folder.title) === topicName)
    .sort((left, right) => left.folderPath.localeCompare(right.folderPath))[0];
}

export function sanitizeBookmarkTopicProposal(
  raw: unknown,
  bookmarks: BookmarkRecord[],
  folders: BookmarkFolderRecord[],
  scope: BookmarkOrganizeScope = 'unfiled',
): BookmarkOrganizeProposal {
  const groups = raw && typeof raw === 'object' && Array.isArray((raw as { groups?: unknown }).groups)
    ? (raw as { groups: unknown[] }).groups
    : [];
  const bookmarksById = new Map(bookmarks.map((bookmark) => [bookmark.id, bookmark]));
  const foldersById = new Map(folders.map((folder) => [folder.id, folder]));
  const destinations = organizeDestinationFolders(folders, scope);
  const otherRoot = otherBookmarksRootId(folders);
  const barRoot = folders.find((folder) => folder.folderKind === 'bar')?.id ?? '1';
  const creates: BookmarkFilingCreate[] = [];
  const moves: BookmarkFilingMove[] = [];
  const clusters: BookmarkOrganizeCluster[] = [];
  const claimedBookmarkIds: string[] = [];
  const seen = new Set<string>();
  const usedClientIds = new Set<string>();

  for (const group of groups) {
    if (!group || typeof group !== 'object') continue;
    const record = group as { name?: unknown; bookmarkIds?: unknown; folderId?: unknown };
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    if (!name || name.length > 80 || normalizeOrganizeName(name) === 'inbox') continue;
    if (!Array.isArray(record.bookmarkIds)) continue;

    const members: BookmarkRecord[] = [];
    for (const id of record.bookmarkIds) {
      if (typeof id !== 'string' || seen.has(id)) continue;
      const bookmark = bookmarksById.get(id);
      if (!bookmark || !canOrganizeBookmark(bookmark, folders, foldersById, scope)) continue;
      seen.add(id);
      members.push(bookmark);
    }

    const dest = resolveTopicDestination(name, record.folderId, destinations);
    const toMove = members.filter((bookmark) => (
      bookmark.parentId !== dest?.id
      && !isTopicAlreadyHome(bookmark, name, foldersById)
    ));
    const alreadyHomeIds = members
      .filter((bookmark) => !toMove.includes(bookmark))
      .map((bookmark) => bookmark.id);

    if (dest) {
      claimedBookmarkIds.push(...alreadyHomeIds);
      if (!toMove.length) continue;
      moves.push(...toMove.map((bookmark) => ({ bookmarkId: bookmark.id, folderId: dest.id })));
      clusters.push({
        key: dest.id,
        folderTitle: dest.title,
        folderId: dest.id,
        bookmarkIds: toMove.map((bookmark) => bookmark.id),
        create: false,
        reason: `${toMove.length} bookmarks for ${dest.title}`,
      });
      continue;
    }

    const clusterCreateRoot = getClusterCreateRoot(scope, toMove, foldersById, barRoot, otherRoot);
    if (toMove.length < 2 || !clusterCreateRoot) continue;
    claimedBookmarkIds.push(...alreadyHomeIds);
    const clientId = topicClientId(name, usedClientIds);
    creates.push({ clientId, parentId: clusterCreateRoot, title: name });
    moves.push(...toMove.map((bookmark) => ({ bookmarkId: bookmark.id, folderId: clientId })));
    clusters.push({
      key: clientId,
      folderTitle: name,
      clientId,
      bookmarkIds: toMove.map((bookmark) => bookmark.id),
      create: true,
      reason: `${toMove.length} bookmarks for ${name}`,
    });
  }

  return { creates, moves, clusters, claimedBookmarkIds };
}

export function mergeTopicWithHostOrganize(
  topic: BookmarkOrganizeProposal,
  bookmarks: BookmarkRecord[],
  folders: BookmarkFolderRecord[],
  scope?: BookmarkOrganizeScope,
): BookmarkOrganizeProposal {
  const claimed = new Set([
    ...topic.moves.map((move) => move.bookmarkId),
    ...(topic.claimedBookmarkIds ?? []),
    ...topic.clusters.flatMap((cluster) => cluster.bookmarkIds),
  ]);
  const host = proposeBookmarkOrganize({ bookmarks, folders, scope });
  const leftoverClusters = host.clusters.flatMap((cluster) => {
    const bookmarkIds = cluster.bookmarkIds.filter((id) => !claimed.has(id));
    if (!bookmarkIds.length) return [];
    if (cluster.create && bookmarkIds.length < 2) return [];
    return [{ ...cluster, bookmarkIds }];
  });
  const leftoverIds = new Set(leftoverClusters.flatMap((cluster) => cluster.bookmarkIds));
  const leftoverClientIds = new Set(
    leftoverClusters.flatMap((cluster) => (cluster.clientId ? [cluster.clientId] : [])),
  );
  const topicCreateByName = new Map(
    topic.creates.map((create) => [normalizeOrganizeName(create.title), create.clientId]),
  );
  const remap = new Map<string, string>();
  const leftoverCreates = host.creates.flatMap((create) => {
    if (!leftoverClientIds.has(create.clientId)) return [];
    const existing = topicCreateByName.get(normalizeOrganizeName(create.title));
    if (existing) {
      remap.set(create.clientId, existing);
      return [];
    }
    return [create];
  });
  const retarget = (folderId: string) => remap.get(folderId) ?? folderId;
  return {
    creates: [...topic.creates, ...leftoverCreates],
    moves: [
      ...topic.moves,
      ...host.moves
        .filter((move) => leftoverIds.has(move.bookmarkId))
        .map((move) => ({ ...move, folderId: retarget(move.folderId) })),
    ],
    clusters: [
      ...topic.clusters,
      ...leftoverClusters.map((cluster) => {
        if (!cluster.clientId) return cluster;
        const clientId = retarget(cluster.clientId);
        return clientId === cluster.clientId ? cluster : { ...cluster, clientId };
      }),
    ],
  };
}

export function finalizeOrganizeSnapshot(
  snapshot: BookmarkOrganizeSnapshot,
  createdFolderIds: string[],
  moveCount: number,
): BookmarkOrganizeSnapshot | null {
  if (createdFolderIds.length === 0 && moveCount === 0) return null;
  return { ...snapshot, createdFolderIds, moveCount };
}

export function insertOrganizeSnapshot(
  existing: BookmarkOrganizeSnapshot[],
  incoming: BookmarkOrganizeSnapshot,
  now: number,
): { next: BookmarkOrganizeSnapshot[]; evicted: BookmarkOrganizeSnapshot[] } {
  const live = pruneBookmarkOrganizeSnapshots(existing, now);
  const next = pruneBookmarkOrganizeSnapshots([...live, incoming], now);
  const nextIds = new Set(next.map((snapshot) => snapshot.id));
  return { next, evicted: live.filter((snapshot) => !nextIds.has(snapshot.id)) };
}

export function commitInsertedOrganizeSnapshot(
  stored: BookmarkOrganizeSnapshot[],
  incomingId: string,
  finalized: BookmarkOrganizeSnapshot | null,
  evicted: BookmarkOrganizeSnapshot[],
  now: number,
): BookmarkOrganizeSnapshot[] {
  const withoutIncoming = stored.filter((snapshot) => snapshot.id !== incomingId);
  if (finalized) return pruneBookmarkOrganizeSnapshots([...withoutIncoming, finalized], now);
  return pruneBookmarkOrganizeSnapshots([...evicted, ...withoutIncoming], now);
}

export function organizeApplyFinalizeInput(
  result: { moved: number; created: Array<{ clientId: string; id: string }> } | undefined,
  progress: { moved: number; created: Array<{ clientId: string; id: string }> },
): { createdFolderIds: string[]; moveCount: number } {
  const source = result ?? progress;
  return {
    createdFolderIds: source.created.map((item) => item.id),
    moveCount: source.moved,
  };
}

export function constrainOrganizePlan(
  plan: { creates: BookmarkFilingCreate[]; moves: BookmarkFilingMove[] },
  bookmarks: BookmarkRecord[],
  folders: BookmarkFolderRecord[],
  scope: BookmarkOrganizeScope = 'unfiled',
): { creates: BookmarkFilingCreate[]; moves: BookmarkFilingMove[] } {
  const bookmarksById = new Map(bookmarks.map((bookmark) => [bookmark.id, bookmark]));
  const foldersById = new Map(folders.map((folder) => [folder.id, folder]));
  const destIds = new Set(organizeDestinationFolders(folders, scope).map((folder) => folder.id));
  const otherRoot = otherBookmarksRootId(folders);
  const barRoot = folders.find((folder) => folder.folderKind === 'bar')?.id ?? '1';
  const allowBarCreate = scope === 'bar' || scope === 'all' || scope === 'unfiled';
  const legalCreates = plan.creates.filter((create) => (
    (create.parentId === otherRoot || (allowBarCreate && (create.parentId === barRoot || create.parentId === '1')))
    && normalizeOrganizeName(create.title) !== 'inbox'
  ));
  const clientIds = new Set(legalCreates.map((create) => create.clientId));
  const moves = plan.moves.filter((move) => {
    const bookmark = bookmarksById.get(move.bookmarkId);
    if (!bookmark || !canOrganizeBookmark(bookmark, folders, foldersById, scope)) return false;
    return destIds.has(move.folderId) || clientIds.has(move.folderId);
  });
  const targetedIds = new Set(moves.map((move) => move.folderId));
  const creates = legalCreates.filter((create) => targetedIds.has(create.clientId));
  return { creates, moves };
}

export type BookmarkOrganizeRestorePlan = {
  moves: Array<{ id: string; parentId: string; index: number }>;
  deleteFolderIds: string[];
  skipped: number;
};

export function planBookmarkOrganizeRestore(
  snapshot: BookmarkOrganizeSnapshot,
  liveBookmarks: BookmarkRecord[],
  liveFolders: BookmarkFolderRecord[],
  folderChildCounts: Map<string, number>,
): BookmarkOrganizeRestorePlan {
  const liveById = new Map(liveBookmarks.map((bookmark) => [bookmark.id, bookmark]));
  const moves: BookmarkOrganizeRestorePlan['moves'] = [];
  let skipped = 0;

  for (const node of snapshot.nodes) {
    if (!liveById.has(node.id) || !canFileIntoBookmarkParent(node.parentId, liveFolders)) {
      skipped += 1;
      continue;
    }
    moves.push({ id: node.id, parentId: node.parentId, index: node.index });
  }

  moves.sort((left, right) => left.parentId.localeCompare(right.parentId) || left.index - right.index);

  return {
    moves,
    deleteFolderIds: emptyCreatedOrganizeFolders(snapshot.createdFolderIds, liveFolders, folderChildCounts),
    skipped,
  };
}

export function emptyCreatedOrganizeFolders(
  createdFolderIds: string[],
  liveFolders: BookmarkFolderRecord[],
  folderChildCounts: Map<string, number>,
): string[] {
  const foldersById = new Map(liveFolders.map((folder) => [folder.id, folder]));
  return createdFolderIds.filter((id) => {
    const folder = foldersById.get(id);
    return Boolean(folder && canMutateBookmarkNode(folder) && folderChildCounts.get(id) === 0);
  });
}
