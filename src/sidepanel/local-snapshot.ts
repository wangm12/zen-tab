import { loadWorkerBootstrap } from '../shared/storage';
import { ChromeGroupInput, ChromeTabInput, snapshotFromChromeWindow } from '../shared/tab-record';
import { ZenTabSnapshot } from '../shared/types';

export type LocalSnapshotChrome = {
  windows: {
    getCurrent: () => Promise<{ id?: number; incognito?: boolean }>;
  };
  tabs: {
    query: (query: { windowId: number }) => Promise<ChromeTabInput[]>;
  };
  tabGroups: {
    query: (query: { windowId: number }) => Promise<ChromeGroupInput[]>;
  };
  storage: {
    local: {
      get: (keys: string[]) => Promise<Record<string, unknown>>;
    };
  };
};

export function shouldFetchPaletteBookmarks(section: 'tabs' | 'stashes' | 'bookmarks', search: string, paletteOpen: boolean): boolean {
  if (section === 'bookmarks') return false;
  return paletteOpen || Boolean(search.trim());
}

export async function readLocalSnapshot(api: LocalSnapshotChrome = chrome): Promise<ZenTabSnapshot> {
  const current = await api.windows.getCurrent();
  const windowId = current.id;
  if (windowId == null) throw new Error('No current window.');
  const [tabs, groups, bootstrap] = await Promise.all([
    api.tabs.query({ windowId }),
    api.tabGroups.query({ windowId }).catch(() => []),
    loadWorkerBootstrap((keys) => api.storage.local.get(keys)),
  ]);
  return snapshotFromChromeWindow({
    windowId,
    incognito: Boolean(current.incognito),
    tabs,
    groups,
    settings: bootstrap.settings,
    stashes: bootstrap.stashes,
    projectMemory: bootstrap.projectMemory,
    hasCloudApiKey: Boolean(bootstrap.cloudApiKey),
    lastAction: bootstrap.lastAction,
  });
}
