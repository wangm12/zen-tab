import { searchBookmarks } from '../shared/bookmark-search';
import { BookmarkRecord, StashRecord, TabRecord, WindowSnapshot } from '../shared/types';
import { Translator } from './i18n';

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
};

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function matchesHaystack(item: Pick<PaletteEntry, 'label' | 'detail'>, haystack: string): boolean {
  return `${item.label} ${item.detail ?? ''}`.toLowerCase().includes(haystack);
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
): PaletteEntry[] {
  const staticCommands: PaletteEntry[] = [
    { id: 'group', label: t('cmdGroup'), commandId: 'group' },
    { id: 'cleanup', label: t('cmdCleanup'), commandId: 'cleanup' },
    { id: 'stash-window', label: t('cmdStashWindow'), commandId: 'stash-window' },
    { id: 'stash-all', label: t('cmdStashAll'), commandId: 'stash-all' },
    { id: 'stash-library', label: t('cmdStashLibrary'), commandId: 'stash-library' },
    { id: 'bookmarks', label: t('cmdBookmarks'), commandId: 'bookmarks' },
    { id: 'export-window', label: t('cmdExportWindow'), commandId: 'export-window' },
    { id: 'settings', label: t('cmdSettings'), commandId: 'settings' },
    { id: 'search', label: t('cmdFocusSearch'), commandId: 'search' },
    { id: 'undo', label: t('cmdUndo'), commandId: 'undo' },
  ];
  const windowCommands = windows.map((windowSnapshot, index) => ({
    id: `window-${windowSnapshot.windowId}`,
    label: windowSnapshot.incognito ? t('privateWindow') : t('window', { index: index + 1 }),
    detail: t('cmdSwitchWindow'),
    commandId: 'switch-window',
    windowId: windowSnapshot.windowId,
  }));
  const tabs = windows.flatMap((windowSnapshot) => windowSnapshot.tabs.map((tab) => {
    const host = hostLabel(tab.url);
    return {
      id: `tab-${tab.tabId}`,
      label: tab.title || t('untitledTab'),
      detail: host ? `${host} · ${t('cmdJumpTab')}` : t('cmdJumpTab'),
      commandId: 'jump-tab',
      tab,
      favIconUrl: tab.favIconUrl,
    };
  }));
  const haystack = query.trim().toLowerCase();
  if (!haystack) return [...staticCommands, ...windowCommands, ...tabs].slice(0, 40);

  const matchingTabs = tabs.filter((item) => matchesHaystack(item, haystack));
  const bookmarkEntries = searchBookmarks(bookmarks, query).map(({ bookmark }) => ({
    id: `bookmark-${bookmark.id}`,
    label: bookmark.title || bookmark.url,
    detail: [hostLabel(bookmark.url), bookmark.folderPath.split(' / ').at(-1)].filter(Boolean).join(' · '),
    commandId: 'jump-bookmark',
    url: bookmark.url,
  }));
  const stashEntries = stashes.filter((stash) => stashMatches(stash, haystack)).map((stash) => ({
    id: `stash-${stash.id}`,
    label: stash.name,
    detail: `${stash.tabs.length} · ${t('cmdJumpStash')}`,
    commandId: 'jump-stash',
    stashId: stash.id,
  }));
  const matchingCommands = [...staticCommands, ...windowCommands].filter((item) => matchesHaystack(item, haystack));
  return [...matchingTabs, ...bookmarkEntries, ...stashEntries, ...matchingCommands].slice(0, 40);
}
