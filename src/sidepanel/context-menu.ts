import { Translator } from './i18n';

export type ContextMenuSpec = {
  id: string;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  kind?: 'item' | 'swatches';
};

export function clampMenuPosition(
  x: number,
  y: number,
  menuWidth: number,
  menuHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  inset = 8,
): { x: number; y: number } {
  const maxX = Math.max(inset, viewportWidth - menuWidth - inset);
  const maxY = Math.max(inset, viewportHeight - menuHeight - inset);
  return {
    x: Math.min(Math.max(inset, x), maxX),
    y: Math.min(Math.max(inset, y), maxY),
  };
}

export function resolveTabContextTargets(clickedTabId: number, selectedTabIds: ReadonlySet<number>): number[] {
  return selectedTabIds.has(clickedTabId) ? [...selectedTabIds] : [clickedTabId];
}

export function buildTabContextSpecs({ t, muted, pinned }: { t: Translator; muted: boolean; pinned: boolean }): ContextMenuSpec[] {
  return [
    { id: 'activate', label: t('activate') },
    { id: 'stash', label: t('stash') },
    { id: 'mute', label: muted ? t('unmute') : t('mute') },
    { id: 'pin', label: pinned ? t('unpin') : t('pin') },
    { id: 'discard', label: t('discarded') },
    { id: 'close', label: t('close'), danger: true },
  ];
}

export function buildGroupContextSpecs({ t, synthetic }: { t: Translator; synthetic: boolean }): ContextMenuSpec[] {
  if (synthetic) return [{ id: 'stash', label: t('stash') }];
  return [
    { id: 'rename', label: t('renameGroup') },
    { id: 'colors', label: t('changeGroupColor'), kind: 'swatches' },
    { id: 'stash', label: t('stash') },
    { id: 'ungroup', label: t('ungroup'), danger: true },
  ];
}

export function buildEmptyCanvasContextSpecs(t: Translator): ContextMenuSpec[] {
  return [
    { id: 'group-tabs', label: t('groupTabs') },
    { id: 'cleanup', label: t('cleanUp') },
    { id: 'stash-window', label: t('stashWindow') },
    { id: 'export-window', label: t('exportWindow') },
  ];
}

export function buildBookmarkRowContextSpecs({ t, isInbox }: { t: Translator; isInbox: boolean }): ContextMenuSpec[] {
  const items: ContextMenuSpec[] = [{ id: 'open', label: t('openBookmark') }];
  if (isInbox) items.push({ id: 'file', label: t('fileBookmark') });
  return items;
}

export function buildBookmarkGroupContextSpecs({ t, collapsed }: { t: Translator; collapsed: boolean }): ContextMenuSpec[] {
  return collapsed
    ? [{ id: 'expand', label: t('expandFolder') }]
    : [{ id: 'collapse', label: t('collapseFolder') }];
}
