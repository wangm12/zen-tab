import { TabRecord, WindowSnapshot } from '../shared/types';
import { Translator } from './i18n';

export type PaletteEntry = {
  id: string;
  label: string;
  detail?: string;
  commandId: string;
  tab?: TabRecord;
  windowId?: number;
  favIconUrl?: string;
};

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function buildPaletteEntries(windows: WindowSnapshot[], query: string, t: Translator): PaletteEntry[] {
  const staticCommands: PaletteEntry[] = [
    { id: 'group', label: t('cmdGroup'), commandId: 'group' },
    { id: 'cleanup', label: t('cmdCleanup'), commandId: 'cleanup' },
    { id: 'stash-window', label: t('cmdStashWindow'), commandId: 'stash-window' },
    { id: 'stash-all', label: t('cmdStashAll'), commandId: 'stash-all' },
    { id: 'stash-library', label: t('cmdStashLibrary'), commandId: 'stash-library' },
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
  return [...staticCommands, ...windowCommands, ...tabs]
    .filter((item) => !haystack || `${item.label} ${item.detail ?? ''}`.toLowerCase().includes(haystack))
    .slice(0, 40);
}
