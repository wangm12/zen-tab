import { chromeFaviconUrl, resolveBookmarkFavicon } from '../shared/bookmark-favicon';
import { searchBookmarks } from '../shared/bookmark-search';
import { BookmarkRecord, StashRecord, TabRecord, WindowSnapshot } from '../shared/types';
import { Translator } from './i18n';

export type PaletteEntryKind = 'active-tab' | 'tab' | 'bookmark' | 'stash' | 'window' | 'command';

export type PaletteEntry = {
  id: string;
  label: string;
  detail?: string;
  commandId: string;
  tab?: TabRecord;
  windowId?: number;
  favIconUrl?: string;
  url?: string;
  stashId?: string;
  kind?: PaletteEntryKind;
  badge?: string;
  isActive?: boolean;
};

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function matchesHaystack(item: PaletteEntry, haystack: string, activeKeywords: string[] = []): boolean {
  const searchable = `${item.label} ${item.detail ?? ''} ${item.url ?? ''} ${item.tab?.url ?? ''} ${item.badge ?? ''}`.toLowerCase();
  if (searchable.includes(haystack)) return true;
  if (item.isActive && activeKeywords.some((keyword) => keyword && (haystack.includes(keyword) || keyword.includes(haystack)))) {
    return true;
  }
  return false;
}

function stashMatches(stash: StashRecord, haystack: string): boolean {
  if (stash.name.toLowerCase().includes(haystack)) return true;
  return stash.tabs.some((tab) => tab.title.toLowerCase().includes(haystack) || tab.url.toLowerCase().includes(haystack));
}

export function buildPaletteEntries(
  windows: WindowSnapshot[],
  query: string,
  t: Translator,
  bookmarks: BookmarkRecord[] = [],
  stashes: StashRecord[] = [],
  faviconGranted: boolean = false,
): PaletteEntry[] {
  const staticCommands: PaletteEntry[] = [
    { id: 'group', label: t('cmdGroup'), commandId: 'group', kind: 'command', badge: t('paletteBadgeCommand') },
    { id: 'cleanup', label: t('cmdCleanup'), commandId: 'cleanup', kind: 'command', badge: t('paletteBadgeCommand') },
    { id: 'stash-window', label: t('cmdStashWindow'), commandId: 'stash-window', kind: 'command', badge: t('paletteBadgeCommand') },
    { id: 'stash-all', label: t('cmdStashAll'), commandId: 'stash-all', kind: 'command', badge: t('paletteBadgeCommand') },
    { id: 'stash-library', label: t('cmdStashLibrary'), commandId: 'stash-library', kind: 'command', badge: t('paletteBadgeCommand') },
    { id: 'bookmarks', label: t('cmdBookmarks'), commandId: 'bookmarks', kind: 'command', badge: t('paletteBadgeCommand') },
    { id: 'export-window', label: t('cmdExportWindow'), commandId: 'export-window', kind: 'command', badge: t('paletteBadgeCommand') },
    { id: 'settings', label: t('cmdSettings'), commandId: 'settings', kind: 'command', badge: t('paletteBadgeCommand') },
    { id: 'search', label: t('cmdFocusSearch'), commandId: 'search', kind: 'command', badge: t('paletteBadgeCommand') },
    { id: 'undo', label: t('cmdUndo'), commandId: 'undo', kind: 'command', badge: t('paletteBadgeCommand') },
  ];
  const windowCommands: PaletteEntry[] = windows.map((windowSnapshot, index) => ({
    id: `window-${windowSnapshot.windowId}`,
    label: windowSnapshot.incognito ? t('privateWindow') : t('window', { index: index + 1 }),
    detail: t('cmdSwitchWindow'),
    commandId: 'switch-window',
    windowId: windowSnapshot.windowId,
    kind: 'window',
    badge: t('paletteBadgeWindow'),
  }));
  const openTabs = windows.flatMap((windowSnapshot) => windowSnapshot.tabs);
  const tabs: PaletteEntry[] = openTabs.map((tab) => {
    const host = hostLabel(tab.url);
    const isCurrent = Boolean(tab.active);
    return {
      id: `tab-${tab.tabId}`,
      label: tab.title || t('untitledTab'),
      detail: host ? `${host} · ${t('cmdJumpTab')}` : t('cmdJumpTab'),
      commandId: 'jump-tab',
      tab,
      url: tab.url,
      favIconUrl: tab.favIconUrl,
      kind: isCurrent ? 'active-tab' : 'tab',
      badge: isCurrent ? t('paletteBadgeActive') : t('paletteBadgeTab'),
      isActive: isCurrent,
    };
  });
  const sortedTabs = [...tabs].sort((a, b) => (b.isActive ? 1 : 0) - (a.isActive ? 1 : 0));
  const haystack = query.trim().toLowerCase();
  if (!haystack) return [...staticCommands, ...windowCommands, ...sortedTabs].slice(0, 40);

  const activeKeywords = ['active', 'current', t('paletteBadgeActive').toLowerCase(), t('activeTab').toLowerCase()].filter(Boolean);
  const matchingTabs = sortedTabs.filter((item) => matchesHaystack(item, haystack, activeKeywords));

  let chromeFaviconGetter: ((pageUrl: string) => string) | undefined;
  if (faviconGranted && typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
    chromeFaviconGetter = (pageUrl: string) => chromeFaviconUrl(pageUrl, (path) => chrome.runtime.getURL(path));
  }

  const bookmarkEntries: PaletteEntry[] = searchBookmarks(bookmarks, query).map(({ bookmark }) => ({
    id: `bookmark-${bookmark.id}`,
    label: bookmark.title || bookmark.url,
    detail: [hostLabel(bookmark.url), bookmark.folderPath.split(' / ').at(-1)].filter(Boolean).join(' · '),
    commandId: 'jump-bookmark',
    url: bookmark.url,
    favIconUrl: resolveBookmarkFavicon(
      bookmark.url,
      openTabs,
      chromeFaviconGetter ? chromeFaviconGetter(bookmark.url) : undefined,
    ),
    kind: 'bookmark',
    badge: t('paletteBadgeBookmark'),
  }));
  const stashEntries: PaletteEntry[] = stashes.filter((stash) => stashMatches(stash, haystack)).map((stash) => ({
    id: `stash-${stash.id}`,
    label: stash.name,
    detail: `${stash.tabs.length} · ${t('cmdJumpStash')}`,
    commandId: 'jump-stash',
    stashId: stash.id,
    kind: 'stash',
    badge: t('paletteBadgeStash'),
  }));
  const matchingCommands = [...staticCommands, ...windowCommands].filter((item) => matchesHaystack(item, haystack));
  return [...matchingTabs, ...bookmarkEntries, ...stashEntries, ...matchingCommands].slice(0, 40);
}
