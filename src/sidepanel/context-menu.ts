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
    { id: 'discard', label: t('discardTab') },
    { id: 'close', label: t('close'), danger: true },
  ];
}

export function buildGroupContextSpecs({ t, synthetic }: { t: Translator; synthetic: boolean }): ContextMenuSpec[] {
  if (synthetic) {
    return [
      { id: 'stash', label: t('stash') },
      { id: 'select-all', label: t('selectAll') },
      { id: 'group-tabs', label: t('groupSelected') },
      { id: 'close-all', label: t('closeAll'), danger: true },
    ];
  }
  return [
    { id: 'rename', label: t('renameGroup') },
    { id: 'colors', label: t('changeGroupColor'), kind: 'swatches' },
    { id: 'stash', label: t('stash') },
    { id: 'select-all', label: t('selectAll') },
    { id: 'close-all', label: t('closeAll'), danger: true },
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

export function buildBookmarkRowContextSpecs({ t, isInbox, canMutate }: {
  t: Translator;
  isInbox: boolean;
  canMutate: boolean;
}): ContextMenuSpec[] {
  const items: ContextMenuSpec[] = [{ id: 'open', label: t('openBookmark') }];
  if (isInbox) items.push({ id: 'file', label: t('fileBookmark') });
  if (canMutate) {
    items.push({ id: 'edit', label: t('editBookmark') });
    items.push({ id: 'delete', label: t('deleteBookmark'), danger: true });
  }
  return items;
}

export function buildBookmarkGroupContextSpecs({ t, collapsed, canMutate, isSpecialRoot }: {
  t: Translator;
  collapsed: boolean;
  canMutate: boolean;
  isSpecialRoot: boolean;
}): ContextMenuSpec[] {
  const items: ContextMenuSpec[] = [
    collapsed
      ? { id: 'expand', label: t('expandFolder') }
      : { id: 'collapse', label: t('collapseFolder') },
    { id: 'open-all', label: t('openAllBookmarks') },
  ];
  if (canMutate && !isSpecialRoot) {
    items.push({ id: 'new-folder', label: t('newBookmarkFolder') });
    items.push({ id: 'rename', label: t('renameBookmarkFolder') });
    items.push({ id: 'delete', label: t('deleteBookmarkFolder'), danger: true });
  }
  return items;
}
