import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Archive, Bookmark, Check, ChevronDown, ChevronRight, Globe2, Layers3, ListFilter, LockKeyhole, MicOff, MoreHorizontal, Palette, Pencil, Pin, Sparkles, Trash2, Ungroup, Volume2,
} from 'lucide-react';
import { pickFaviconStack, groupSurfaceColor, firstViewportIndex, resolveStickyGroup, stickyHeaderHasScrolledAway } from '../shared/atmosphere';
import { displayHostname } from '../shared/url';
import { resolveTabMoveIndex, sortGroupsByStripOrder } from '../shared/tab-ops';
import { coerceTabDragHit, formatTabDragId, hitTestTabDragTarget, placeVisualPlaceholder, rememberTabDragHit, rememberTabPlacement, type DragSurface } from '../shared/tab-dnd';
import { GroupColor, TabRecord, WindowSnapshot, ZenTabMessage } from '../shared/types';
import { ContextMenu, ContextMenuItem } from './ContextMenu';
import {
  buildEmptyCanvasContextSpecs,
  buildGroupContextSpecs,
  buildTabContextSpecs,
  resolveTabContextTargets,
} from './context-menu';
import { DragPreviewOverlay } from './DragPreviewOverlay';
import { DroppableSurface } from './dnd-surfaces';
import { FaviconStack } from './FaviconStack';
import { Translator } from './i18n';
import { setTabDragOverId } from './tab-drag-over';
import { usePointerDragSession } from './use-pointer-drag-session';

export type TabDragCommitEvent = {
  canceled: boolean;
  operation: { source?: { id: string | number } | null; target?: { id: string | number } | null };
};

type TreeRow =
  | { kind: 'group'; id: number; name: string; color: string; count: number; collapsed: boolean; synthetic?: boolean; icons: string[] }
  | { kind: 'tab'; tab: TabRecord; groupColor: GroupColor | 'none' }
  | { kind: 'placeholder' };

export function TabTree({ windowSnapshot, search, t, onTabDragEnd, onToggleGroup, onStashGroup, onStashUngrouped, onStashTabs, onCloseTabs, onGroupTabs, onAnalyzeTabs, onFileTabs, onAnalyzeWindow, onCleanupWindow, onStashWindow, onExportWindow, onAction }: {
  windowSnapshot?: WindowSnapshot;
  search: string;
  t: Translator;
  onTabDragEnd: (event: TabDragCommitEvent) => void;
  onToggleGroup: (groupId: number, collapsed: boolean) => void;
  onStashGroup: (groupId: number) => void;
  onStashUngrouped: () => void;
  onStashTabs: (tabIds: number[]) => Promise<boolean>;
  onCloseTabs: (tabIds: number[]) => Promise<boolean>;
  onGroupTabs: (tabIds: number[]) => Promise<boolean>;
  onAnalyzeTabs: (tabIds: number[]) => Promise<boolean>;
  onFileTabs: (tabIds: number[]) => Promise<boolean>;
  onAnalyzeWindow: () => void;
  onCleanupWindow: () => void;
  onStashWindow: () => void;
  onExportWindow: () => void;
  onAction: (message: ZenTabMessage) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [syntheticCollapsed, setSyntheticCollapsed] = useState<Set<number>>(new Set());
  const [visualRows, setVisualRows] = useState<TreeRow[] | null>(null);
  const [selectedTabIds, setSelectedTabIds] = useState<Set<number>>(new Set());
  const [selectionAnchorId, setSelectionAnchorId] = useState<number | null>(null);
  const normalizedSearch = search.trim().toLowerCase();
  const rows = useMemo<TreeRow[]>(() => {
    if (!windowSnapshot) return [];
    const matches = (tab: TabRecord) => !normalizedSearch || `${tab.title} ${tab.url}`.toLowerCase().includes(normalizedSearch);
    const next: TreeRow[] = [];
    const groups = new Map<number, TabRecord[]>();
    const ungrouped: TabRecord[] = [];
    for (const tab of windowSnapshot.tabs) {
      if (tab.groupId === -1) ungrouped.push(tab); else groups.set(tab.groupId, [...(groups.get(tab.groupId) ?? []), tab]);
    }
    for (const group of sortGroupsByStripOrder([...windowSnapshot.groups], windowSnapshot.tabs)) {
      const tabs = (groups.get(group.groupId) ?? []).filter(matches);
      if (normalizedSearch && tabs.length === 0) continue;
      next.push({
        kind: 'group',
        id: group.groupId,
        name: group.title || t('untitledGroup'),
        color: group.color,
        count: tabs.length,
        collapsed: group.collapsed,
        icons: pickFaviconStack(tabs.map((tab) => tab.favIconUrl)),
      });
      if (!group.collapsed) tabs.forEach((tab) => next.push({ kind: 'tab', tab, groupColor: group.color }));
    }
    const matchingUngrouped = ungrouped.filter(matches);
    if (matchingUngrouped.length || !normalizedSearch) {
      const syntheticId = -windowSnapshot.windowId;
      const collapsed = syntheticCollapsed.has(syntheticId);
      next.push({ kind: 'group', id: syntheticId, name: t('ungrouped'), color: 'none', count: matchingUngrouped.length, collapsed, synthetic: true, icons: pickFaviconStack(matchingUngrouped.map((tab) => tab.favIconUrl)) });
      if (!collapsed) matchingUngrouped.forEach((tab) => next.push({ kind: 'tab', tab, groupColor: 'none' }));
    }
    return next;
  }, [normalizedSearch, syntheticCollapsed, t, windowSnapshot]);

  const displayRows = visualRows ?? rows;
  const sortableEnabled = !normalizedSearch;
  const visibleTabIds = useMemo(() => displayRows.filter((row): row is Extract<TreeRow, { kind: 'tab' }> => row.kind === 'tab').map((row) => row.tab.tabId), [displayRows]);

  useEffect(() => {
    const availableIds = new Set(windowSnapshot?.tabs.map((tab) => tab.tabId) ?? []);
    setSelectedTabIds((previous) => {
      const next = new Set([...previous].filter((tabId) => availableIds.has(tabId)));
      return next.size === previous.size ? previous : next;
    });
    setSelectionAnchorId((previous) => previous != null && availableIds.has(previous) ? previous : null);
  }, [windowSnapshot]);

  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const snapshotRef = useRef(windowSnapshot);
  snapshotRef.current = windowSnapshot;
  const dragHitRef = useRef<{
    overId: string | null;
    lastHit: { surface: DragSurface; placement?: 'before' | 'after' } | null;
  }>({ overId: null, lastHit: null });

  const { overlay, source: draggedTabId, onPointerDown: onHandlePointerDown, consumeSuppressedClick } = usePointerDragSession<number>({
    enabled: sortableEnabled,
    scrollerRef: scrollRef,
    onActivate: (tabId) => {
      dragHitRef.current = { overId: null, lastHit: null };
      setVisualRows(placeVisualPlaceholder(rowsRef.current, tabId, { type: 'origin' }));
    },
    onDrag: (tabId, point) => {
      const scroller = scrollRef.current;
      const rawHit = hitTestTabDragTarget(point.x, point.y, (x, y) => document.elementFromPoint(x, y));
      const scrollerRect = scroller?.getBoundingClientRect();
      const lastTabBottom = scroller
        ? [...scroller.querySelectorAll('[data-tab-drop^="tab-"]')].reduce((bottom, node) => Math.max(bottom, node.getBoundingClientRect().bottom), 0) || null
        : null;
      const measured = coerceTabDragHit(rawHit, {
        draggedTabId: tabId,
        clientY: point.y,
        lastTabBottom,
        scrollerTop: scrollerRect?.top ?? 0,
        scrollerBottom: scrollerRect?.bottom ?? 0,
        windowId: snapshotRef.current?.windowId ?? 0,
      });
      const inList = Boolean(scrollerRect && point.y >= scrollerRect.top && point.y <= scrollerRect.bottom);
      const hit = rememberTabDragHit(dragHitRef.current.lastHit, measured, inList);
      dragHitRef.current.lastHit = hit;
      const overId = hit ? formatTabDragId(hit.surface) : null;
      dragHitRef.current.overId = overId;
      setTabDragOverId(overId);
      if (!hit) return;
      if (hit.surface.kind === 'list-end') {
        rememberTabPlacement('after');
        setVisualRows(placeVisualPlaceholder(rowsRef.current, tabId, { type: 'end' }));
        return;
      }
      if (hit.surface.kind === 'group' || hit.surface.kind === 'sticky-group') {
        setVisualRows(placeVisualPlaceholder(rowsRef.current, tabId, { type: 'after-group', groupId: hit.surface.groupId }));
        return;
      }
      if (hit.surface.kind === 'ungrouped' || hit.surface.kind === 'sticky-ungrouped') {
        const ungrouped = rowsRef.current.find((row): row is Extract<TreeRow, { kind: 'group' }> => row.kind === 'group' && Boolean(row.synthetic));
        if (ungrouped) setVisualRows(placeVisualPlaceholder(rowsRef.current, tabId, { type: 'after-group', groupId: ungrouped.id }));
        return;
      }
      if (hit.surface.kind !== 'tab' || !hit.placement) return;
      const overTabId = hit.surface.tabId;
      const placement = hit.placement;
      rememberTabPlacement(placement);
      const live = snapshotRef.current;
      const draggedTab = live?.tabs.find((tab) => tab.tabId === tabId);
      const overTab = live?.tabs.find((tab) => tab.tabId === overTabId);
      if (!draggedTab || !overTab || !live) return;
      if (resolveTabMoveIndex(draggedTab.index, { type: placement, targetIndex: overTab.index }, {
        pinnedCount: live.tabs.filter((tab) => tab.pinned).length,
        tabCount: live.tabs.length,
        pinned: draggedTab.pinned,
      }) == null) return;
      setVisualRows(placeVisualPlaceholder(rowsRef.current, tabId, { type: placement, tabId: overTabId }));
    },
    onFinish: (tabId, canceled) => {
      const overId = dragHitRef.current.overId;
      dragHitRef.current = { overId: null, lastHit: null };
      setTabDragOverId(null);
      const sourceId = formatTabDragId({ kind: 'tab', tabId });
      if (canceled || !overId) {
        setVisualRows(null);
        onTabDragEnd({ canceled, operation: { source: { id: sourceId }, target: null } });
        return;
      }
      const draggedRow = rowsRef.current.find((row) => row.kind === 'tab' && row.tab.tabId === tabId);
      setVisualRows((current) => current && draggedRow
        ? current.map((row) => row.kind === 'placeholder' ? draggedRow : row)
        : null);
      onTabDragEnd({
        canceled: false,
        operation: {
          source: { id: sourceId },
          target: { id: overId },
        },
      });
    },
  });

  const draggingRef = useRef(false);
  draggingRef.current = draggedTabId != null;
  useEffect(() => {
    if (draggingRef.current) return;
    setVisualRows(null);
  }, [rows]);

  const clearSelection = useCallback(() => {
    setSelectedTabIds(new Set());
    setSelectionAnchorId(null);
  }, []);

  const selectTab = useCallback((tabId: number, event: React.MouseEvent, forceToggle = false) => {
    const targetIndex = visibleTabIds.indexOf(tabId);
    if (targetIndex < 0) return;
    setSelectedTabIds((previous) => {
      if (event.shiftKey && selectionAnchorId != null) {
        const anchorIndex = visibleTabIds.indexOf(selectionAnchorId);
        if (anchorIndex >= 0) {
          const start = Math.min(anchorIndex, targetIndex);
          const end = Math.max(anchorIndex, targetIndex);
          return new Set(visibleTabIds.slice(start, end + 1));
        }
      }
      if (forceToggle || event.metaKey || event.ctrlKey) {
        const next = new Set(previous);
        if (next.has(tabId)) next.delete(tabId); else next.add(tabId);
        return next;
      }
      return new Set([tabId]);
    });
    setSelectionAnchorId(tabId);
  }, [selectionAnchorId, visibleTabIds]);

  const handleTreeKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      setSelectedTabIds(new Set(visibleTabIds));
      setSelectionAnchorId(visibleTabIds[0] ?? null);
    } else if (event.key === 'Escape' && selectedTabIds.size > 0) {
      event.preventDefault();
      clearSelection();
    }
  }, [clearSelection, selectedTabIds.size, visibleTabIds]);

  useEffect(() => {
    const handleSelectAllShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'a' || event.shiftKey) return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable)) return;
      if (!scrollRef.current?.contains(document.activeElement)) return;
      event.preventDefault();
      setSelectedTabIds(new Set(visibleTabIds));
      setSelectionAnchorId(visibleTabIds[0] ?? null);
    };
    window.addEventListener('keydown', handleSelectAllShortcut);
    return () => window.removeEventListener('keydown', handleSelectAllShortcut);
  }, [visibleTabIds]);

  const virtualizer = useVirtualizer({ count: displayRows.length, getScrollElement: () => scrollRef.current, estimateSize: (index) => displayRows[index].kind === 'group' ? 52 : 54, overscan: 10 });
  const activeTabId = windowSnapshot?.tabs.find((tab) => tab.active)?.tabId ?? null;
  const lastScrolledActiveTabId = useRef<number | null>(null);

  useEffect(() => {
    if (activeTabId == null || activeTabId === lastScrolledActiveTabId.current) return;
    const activeRowIndex = displayRows.findIndex((row) => row.kind === 'tab' && row.tab.tabId === activeTabId);
    if (activeRowIndex < 0) return;
    lastScrolledActiveTabId.current = activeTabId;
    const frame = window.requestAnimationFrame(() => virtualizer.scrollToIndex(activeRowIndex, { align: 'auto' }));
    return () => window.cancelAnimationFrame(frame);
  }, [activeTabId, displayRows, virtualizer]);

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; label: string; items: ContextMenuItem[] } | null>(null);
  const [overflowCloseToken, setOverflowCloseToken] = useState(0);
  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  const openContextMenu = useCallback((event: React.MouseEvent, items: ContextMenuItem[], label: string) => {
    event.preventDefault();
    event.stopPropagation();
    setOverflowCloseToken((token) => token + 1);
    setContextMenu({ x: event.clientX, y: event.clientY, items, label });
  }, []);
  const onOpenOverflow = useCallback(() => setContextMenu(null), []);
  const canvasMenuItems = useMemo<ContextMenuItem[]>(() => {
    const icons: Record<string, React.ReactNode> = {
      'group-tabs': <Sparkles size={14} />,
      cleanup: <ListFilter size={14} />,
      'stash-window': <Archive size={14} />,
      'export-window': <Archive size={14} />,
    };
    const actions: Record<string, () => void> = {
      'group-tabs': onAnalyzeWindow,
      cleanup: onCleanupWindow,
      'stash-window': onStashWindow,
      'export-window': onExportWindow,
    };
    return buildEmptyCanvasContextSpecs(t).map((spec) => ({ ...spec, icon: icons[spec.id], onSelect: actions[spec.id] }));
  }, [onAnalyzeWindow, onCleanupWindow, onExportWindow, onStashWindow, t]);
  const openCanvasMenu = useCallback((event: React.MouseEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('.tab-row, .group-row-shell')) return;
    openContextMenu(event, canvasMenuItems, t('organizeMenu'));
  }, [canvasMenuItems, openContextMenu, t]);
  const openTabContextMenu = useCallback((event: React.MouseEvent, tab: TabRecord) => {
    const bulkIds = resolveTabContextTargets(tab.tabId, selectedTabIds);
    const selected = selectedTabIds.has(tab.tabId);
    openContextMenu(event, buildTabContextSpecs({ t, muted: tab.muted, pinned: tab.pinned }).map((spec) => ({
      ...spec,
      icon: tabContextIcon(spec.id, tab),
      onSelect: () => {
        if (spec.id === 'activate') onAction({ type: 'UPDATE_TAB', tabId: tab.tabId, windowId: tab.windowId, action: 'activate' });
        else if (spec.id === 'stash') {
          onStashTabs(bulkIds);
          if (selected) clearSelection();
        } else if (spec.id === 'mute') onAction({ type: 'UPDATE_TAB', tabId: tab.tabId, action: tab.muted ? 'unmute' : 'mute' });
        else if (spec.id === 'pin') onAction({ type: 'UPDATE_TAB', tabId: tab.tabId, action: tab.pinned ? 'unpin' : 'pin' });
        else if (spec.id === 'discard') onAction({ type: 'UPDATE_TAB', tabId: tab.tabId, action: 'discard' });
        else if (spec.id === 'close') void onCloseTabs(bulkIds).then((ok) => { if (ok && selected) clearSelection(); });
      },
    })), t('actionsFor', { title: tab.title }));
  }, [clearSelection, onAction, onCloseTabs, onStashTabs, openContextMenu, selectedTabIds, t]);
  const contextMenuNode = <ContextMenu open={Boolean(contextMenu)} x={contextMenu?.x ?? 0} y={contextMenu?.y ?? 0} items={contextMenu?.items ?? []} label={contextMenu?.label ?? t('tabActions')} onClose={closeContextMenu} />;

  if (!windowSnapshot || rows.length === 0) return <>
    <div className="empty-state" onContextMenu={openCanvasMenu}><div className="empty-orbit"><Globe2 size={22} /></div><strong>{search ? t('noMatchingTabs') : t('clearWindow')}</strong><p>{search ? t('tryShorterTitle') : t('openTabToAppear')}</p></div>
    {contextMenuNode}
  </>;

  const selectedIds = [...selectedTabIds];
  const selectionMode = selectedIds.length > 0;
  const draggedTab = draggedTabId == null ? undefined : windowSnapshot.tabs.find((tab) => tab.tabId === draggedTabId);
  const closeSelected = async () => {
    if (await onCloseTabs(selectedIds)) clearSelection();
  };
  const virtualItems = virtualizer.getVirtualItems();
  const scrollOffset = virtualizer.scrollOffset ?? 0;
  const firstVisibleIndex = firstViewportIndex(virtualItems, scrollOffset);
  const stickyCandidate = resolveStickyGroup(displayRows, firstVisibleIndex);
  const stickyItem = stickyCandidate
    ? virtualItems.find((item) => item.index === displayRows.indexOf(stickyCandidate))
    : undefined;
  const stickyGroup = stickyCandidate
    && stickyCandidate.kind === 'group'
    && (!stickyItem || stickyHeaderHasScrolledAway(stickyItem.start, stickyItem.size, scrollOffset))
    ? stickyCandidate
    : null;
  const renderGroupRow = (row: Extract<TreeRow, { kind: 'group' }>, sticky = false) => {
    const groupTabIds = windowSnapshot.tabs.filter((tab) => row.synthetic ? tab.groupId === -1 : tab.groupId === row.id).map((tab) => tab.tabId);
    const droppable = row.synthetic
      ? sticky
        ? { kind: 'sticky-ungrouped' as const, windowId: windowSnapshot.windowId }
        : { kind: 'ungrouped' as const, windowId: windowSnapshot.windowId }
      : sticky
        ? { kind: 'sticky-group' as const, groupId: row.id }
        : { kind: 'group' as const, groupId: row.id };
    return <GroupRow row={row} droppable={droppable} t={t} overflowCloseToken={overflowCloseToken} onOpenOverflow={onOpenOverflow} onOpenContextMenu={openContextMenu} onToggle={() => {
      if (row.synthetic) setSyntheticCollapsed((previous) => {
        const next = new Set(previous);
        if (next.has(row.id)) next.delete(row.id); else next.add(row.id);
        return next;
      });
      else onToggleGroup(row.id, !row.collapsed);
    }} onStash={row.synthetic ? onStashUngrouped : () => onStashGroup(row.id)} onSelectAll={() => {
      setSelectedTabIds(new Set(groupTabIds));
      setSelectionAnchorId(groupTabIds[0] ?? null);
    }} onCloseAll={() => { void onCloseTabs(groupTabIds); }} onGroupThese={() => { void onGroupTabs(groupTabIds); }} onAction={onAction} />;
  };

  return <>
    {selectionMode && <div className="selection-bar" role="toolbar" aria-label={t('selected')}><span className="selection-summary"><strong>{selectedIds.length}</strong> {t('selected')} <span className="selection-mode-label">{t('selectionMode')}</span></span><div className="selection-actions"><button className="selection-action" onClick={() => void onGroupTabs(selectedIds).then((ok) => { if (ok) clearSelection(); })}><Layers3 size={14} /> {t('groupSelected')}</button><button className="selection-action" onClick={() => void onAnalyzeTabs(selectedIds).then((ok) => { if (ok) clearSelection(); })}><Sparkles size={14} /> {t('analyzeSelection')}</button><button className="selection-action" onClick={() => void onFileTabs(selectedIds).then((ok) => { if (ok) clearSelection(); })}><Bookmark size={14} /> {t('fileToBookmarks')}</button><button className="selection-action" onClick={() => void onStashTabs(selectedIds).then((ok) => { if (ok) clearSelection(); })}><Archive size={14} /> {t('stash')}</button><button className="selection-action" onClick={() => void closeSelected()}><Trash2 size={14} /> {t('close')}</button><button className="selection-clear" onClick={clearSelection} aria-label={t('exitSelection')}>{t('done')}</button></div></div>}
    <div className={draggedTabId != null ? 'tree-scroller is-dragging' : 'tree-scroller'} ref={scrollRef} tabIndex={0} aria-label={t('liveTabs')} onKeyDown={handleTreeKeyDown} onContextMenu={openCanvasMenu}>
      {stickyGroup && <div className="sticky-group-header" key={stickyGroup.id}>{renderGroupRow(stickyGroup, true)}</div>}
      <div className={draggedTabId != null ? 'tree-canvas is-sorting' : 'tree-canvas'} style={{ height: virtualizer.getTotalSize() }}>{virtualItems.map((virtualRow) => {
        const row = displayRows[virtualRow.index];
        if (!row) return null;
        const rowKey = row.kind === 'group' ? `group-${row.id}` : row.kind === 'placeholder' ? 'placeholder' : `tab-${row.tab.tabId}`;
        return <div key={rowKey} ref={virtualizer.measureElement} data-index={virtualRow.index} className="tree-position" style={{ top: virtualRow.start }}>
          {row.kind === 'group' ? renderGroupRow(row) : row.kind === 'placeholder' ? <div className="tab-drop-placeholder" aria-hidden="true" /> : <TabRow tab={row.tab} dragging={draggedTabId === row.tab.tabId} dragEnabled={sortableEnabled} groupColor={row.groupColor} t={t} selected={selectedTabIds.has(row.tab.tabId)} selectionMode={selectionMode} overflowCloseToken={overflowCloseToken} onOpenOverflow={onOpenOverflow} onRowContextMenu={(event) => openTabContextMenu(event, row.tab)} onSelect={(event, forceToggle) => selectTab(row.tab.tabId, event, forceToggle)} onClearSelection={clearSelection} onStash={() => { void onStashTabs([row.tab.tabId]); }} onAction={onAction} onHandlePointerDown={onHandlePointerDown} consumeSuppressedClick={consumeSuppressedClick} />}
        </div>;
      })}</div>
      {draggedTabId != null && <div className="tree-list-end" data-tab-drop={formatTabDragId({ kind: 'list-end', windowId: windowSnapshot.windowId })} aria-hidden="true" />}
    </div>
    {contextMenuNode}
    {overlay && draggedTab && <DragPreviewOverlay
      x={overlay.x}
      y={overlay.y}
      icon={draggedTab.favIconUrl ? <img src={draggedTab.favIconUrl} alt="" /> : <Globe2 size={14} />}
      title={draggedTab.title || t('untitledTab')}
    />}
  </>;
}

function GroupRow({ row, droppable, t, overflowCloseToken, onOpenOverflow, onOpenContextMenu, onToggle, onStash, onSelectAll, onCloseAll, onGroupThese, onAction }: { row: Extract<TreeRow, { kind: 'group' }>; droppable: { kind: 'group'; groupId: number } | { kind: 'ungrouped'; windowId: number } | { kind: 'sticky-group'; groupId: number } | { kind: 'sticky-ungrouped'; windowId: number }; t: Translator; overflowCloseToken: number; onOpenOverflow: () => void; onOpenContextMenu: (event: React.MouseEvent, items: ContextMenuItem[], label: string) => void; onToggle: () => void; onStash: () => void; onSelectAll: () => void; onCloseAll: () => void; onGroupThese: () => void; onAction: (message: ZenTabMessage) => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(row.name === t('untitledGroup') ? '' : row.name);
  const colors: GroupColor[] = ['grey', 'blue', 'cyan', 'green', 'yellow', 'orange', 'red', 'pink', 'purple'];
  const colorLabels: Record<GroupColor, string> = { grey: t('groupColorGrey'), blue: t('groupColorBlue'), cyan: t('groupColorCyan'), green: t('groupColorGreen'), yellow: t('groupColorYellow'), orange: t('groupColorOrange'), red: t('groupColorRed'), pink: t('groupColorPink'), purple: t('groupColorPurple') };
  useEffect(() => { setMenuOpen(false); }, [overflowCloseToken]);
  useEffect(() => {
    if (!renaming) setName(row.name === t('untitledGroup') ? '' : row.name);
  }, [renaming, row.name, t]);
  useEffect(() => {
    if (!menuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false); };
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest('.group-row-shell')) setMenuOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
    };
  }, [menuOpen]);
  const submitRename = () => {
    onAction({ type: 'UPDATE_GROUP', groupId: row.id, action: 'rename', title: name });
    setRenaming(false);
    setMenuOpen(false);
  };
  const openGroupContextMenu = (event: React.MouseEvent) => {
    onOpenContextMenu(event, buildGroupContextSpecs({ t, synthetic: Boolean(row.synthetic) }).map((spec) => ({
      ...spec,
      icon: spec.id === 'rename' ? <Pencil size={14} /> : spec.id === 'stash' ? <Archive size={14} /> : spec.id === 'ungroup' ? <Ungroup size={14} /> : spec.id === 'select-all' ? <Check size={14} /> : spec.id === 'close-all' ? <Trash2 size={14} /> : spec.id === 'group-tabs' ? <Layers3 size={14} /> : undefined,
      swatches: spec.kind === 'swatches' ? {
        colors,
        selected: row.color,
        labels: colorLabels,
        onSelectColor: (color) => onAction({ type: 'UPDATE_GROUP', groupId: row.id, action: 'color', color }),
      } : undefined,
      onSelect: () => {
        if (spec.id === 'rename') {
          setRenaming(true);
          setMenuOpen(true);
          return;
        }
        if (spec.id === 'stash') onStash();
        if (spec.id === 'select-all') onSelectAll();
        if (spec.id === 'group-tabs') onGroupThese();
        if (spec.id === 'close-all') onCloseAll();
        if (spec.id === 'ungroup') onAction({ type: 'UNGROUP_GROUP', groupId: row.id });
      },
    })), t('tabActions'));
  };
  const surface = groupSurfaceColor(row.synthetic ? 'none' : row.color as GroupColor);
  return <DroppableSurface
    surface={droppable}
    className={row.synthetic ? 'group-row-shell' : 'group-row-shell has-rail'}
    style={{ '--group-wash': surface.wash, '--group-dot': surface.dot } as React.CSSProperties}
    onContextMenu={openGroupContextMenu}
  >
    <button className="group-row" onClick={onToggle} aria-expanded={!row.collapsed}>
      <span className="group-chevron">{row.collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}</span>
      {row.synthetic && <span className="group-dot neutral" />}
      <span className="group-name">{row.name}</span>
      <span className="group-count">{row.count}</span>
      <FaviconStack icons={row.icons} />
    </button>
    <button className="group-menu-button" onClick={(event) => { event.stopPropagation(); onOpenOverflow(); setMenuOpen((open) => !open); }} aria-label={`${t('tabActions')} ${row.name}`} aria-expanded={menuOpen} aria-haspopup="menu"><MoreHorizontal size={15} /></button>
    {menuOpen && <div className="group-popover" role="menu">
      <button role="menuitem" onClick={() => { onStash(); setMenuOpen(false); }}><Archive size={14} /> {t('stash')}</button>
      <button role="menuitem" onClick={() => { onSelectAll(); setMenuOpen(false); }}><Check size={14} /> {t('selectAll')}</button>
      {row.synthetic && <button role="menuitem" onClick={() => { onGroupThese(); setMenuOpen(false); }}><Layers3 size={14} /> {t('groupSelected')}</button>}
      {!row.synthetic && (renaming ? <form className="group-rename-form" onSubmit={(event) => { event.preventDefault(); submitRename(); }}><input autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={42} aria-label={t('renameGroup')} /><button className="icon-button subtle" type="submit" aria-label={t('done')}><Check size={14} /></button></form> : <button role="menuitem" onClick={() => setRenaming(true)}><Pencil size={14} /> {t('renameGroup')}</button>)}
      {!row.synthetic && <div className="group-color-menu" role="group" aria-label={t('changeGroupColor')}>{colors.map((color) => <button key={color} className={`group-color-swatch ${color}${row.color === color ? ' selected' : ''}`} onClick={() => { onAction({ type: 'UPDATE_GROUP', groupId: row.id, action: 'color', color }); setMenuOpen(false); }} aria-label={`${t('changeGroupColor')}: ${colorLabels[color]}`} title={colorLabels[color]}><Palette size={11} /></button>)}</div>}
      <button role="menuitem" className="danger" onClick={() => { onCloseAll(); setMenuOpen(false); }}><Trash2 size={14} /> {t('closeAll')}</button>
      {!row.synthetic && <button role="menuitem" className="danger" onClick={() => { onAction({ type: 'UNGROUP_GROUP', groupId: row.id }); setMenuOpen(false); }}><Ungroup size={14} /> {t('ungroup')}</button>}
    </div>}
  </DroppableSurface>;
}

const TabRow = memo(function TabRow({ tab, dragging, dragEnabled, groupColor, t, selected, selectionMode, overflowCloseToken, onOpenOverflow, onRowContextMenu, onSelect, onClearSelection, onStash, onAction, onHandlePointerDown, consumeSuppressedClick }: { tab: TabRecord; dragging: boolean; dragEnabled: boolean; groupColor: GroupColor | 'none'; t: Translator; selected: boolean; selectionMode: boolean; overflowCloseToken: number; onOpenOverflow: () => void; onRowContextMenu: (event: React.MouseEvent<HTMLDivElement>) => void; onSelect: (event: React.MouseEvent, forceToggle?: boolean) => void; onClearSelection: () => void; onStash: () => void; onAction: (message: ZenTabMessage) => void; onHandlePointerDown: (tabId: number, event: React.PointerEvent<HTMLElement>) => void; consumeSuppressedClick: () => boolean }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPlacement, setMenuPlacement] = useState<'up' | 'down'>('down');
  const favicon = tab.favIconUrl;
  useEffect(() => { setMenuOpen(false); }, [overflowCloseToken]);
  useEffect(() => {
    if (!menuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false); };
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest('.tab-row')) setMenuOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
    };
  }, [menuOpen]);
  const toggleMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
    onOpenOverflow();
    if (menuOpen) {
      setMenuOpen(false);
      return;
    }
    const row = event.currentTarget.closest('.tab-row');
    const rowBottom = row?.getBoundingClientRect().bottom ?? 0;
    setMenuPlacement(rowBottom + 186 > window.innerHeight - 8 ? 'up' : 'down');
    setMenuOpen(true);
  };
  const grouped = groupColor !== 'none';
  const rowClass = ['tab-row', 'is-card', grouped ? 'has-group-ink' : '', tab.active ? 'active' : '', selectionMode ? 'selection-mode' : '', selected ? 'selected' : '', dragging ? 'dragging' : ''].filter(Boolean).join(' ');
  return <div data-tab-drop={formatTabDragId({ kind: 'tab', tabId: tab.tabId })} className={rowClass} style={grouped ? { '--group-dot': groupSurfaceColor(groupColor).dot } as React.CSSProperties : undefined} onContextMenu={onRowContextMenu}>
    <button className={selected ? 'tab-select selected' : 'tab-select'} type="button" onClick={(event) => { event.stopPropagation(); onSelect(event, true); }} aria-pressed={selected} aria-label={selected ? t('deselectTab', { title: tab.title }) : t('selectTab', { title: tab.title })}><span className="selection-box">{selected && <Check size={11} />}</span></button>
    <div
      className="tab-main"
      role="button"
      tabIndex={0}
      title={selectionMode ? t('clickToSelect') : (tab.url || tab.title)}
      onPointerDown={(event) => { if (dragEnabled) onHandlePointerDown(tab.tabId, event); }}
      onClick={(event) => { if (consumeSuppressedClick()) { event.preventDefault(); event.stopPropagation(); return; } if (selectionMode) { event.preventDefault(); event.stopPropagation(); onSelect(event, true); return; } if (event.metaKey || event.ctrlKey || event.shiftKey) { event.preventDefault(); onSelect(event); return; } setMenuOpen(false); onClearSelection(); onAction({ type: 'UPDATE_TAB', tabId: tab.tabId, windowId: tab.windowId, action: 'activate' }); }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        if (selectionMode) return;
        setMenuOpen(false);
        onClearSelection();
        onAction({ type: 'UPDATE_TAB', tabId: tab.tabId, windowId: tab.windowId, action: 'activate' });
      }}
    >
      <span className="favicon-wrap">{favicon ? <img src={favicon} alt="" className="favicon" draggable={false} /> : <Globe2 size={15} />}</span>
      <span className="tab-copy"><span className="tab-title">{tab.title || t('untitledTab')}</span><span className="tab-host">{displayHostname(tab.url)}</span></span>
      <span className="tab-state" aria-label={tab.discarded ? t('discarded') : tab.audible ? t('playingAudio') : tab.pinned ? t('pinned') : undefined}>{tab.discarded ? <LockKeyhole size={13} /> : tab.audible ? <Volume2 size={13} /> : tab.pinned ? <Pin size={13} /> : null}</span>
    </div>
    <button className="row-menu" onClick={toggleMenu} aria-label={t('actionsFor', { title: tab.title })} aria-expanded={menuOpen} aria-haspopup="menu"><MoreHorizontal size={16} /></button>
    {menuOpen && <div className={menuPlacement === 'up' ? 'row-popover up' : 'row-popover'} role="menu">
      <button role="menuitem" onClick={() => { onStash(); setMenuOpen(false); }}><Archive size={14} /> {t('stash')}</button>
      <button role="menuitem" onClick={() => { onAction({ type: 'UPDATE_TAB', tabId: tab.tabId, action: tab.muted ? 'unmute' : 'mute' }); setMenuOpen(false); }}>{tab.muted ? <Volume2 size={14} /> : <MicOff size={14} />} {tab.muted ? t('unmute') : t('mute')}</button>
      <button role="menuitem" onClick={() => { onAction({ type: 'UPDATE_TAB', tabId: tab.tabId, action: tab.pinned ? 'unpin' : 'pin' }); setMenuOpen(false); }}><Pin size={14} /> {tab.pinned ? t('unpin') : t('pin')}</button>
      <button role="menuitem" onClick={() => { onAction({ type: 'UPDATE_TAB', tabId: tab.tabId, action: 'discard' }); setMenuOpen(false); }}><LockKeyhole size={14} /> {t('discardTab')}</button>
      <button role="menuitem" className="danger" onClick={() => { onAction({ type: 'UPDATE_TAB', tabId: tab.tabId, action: 'close' }); setMenuOpen(false); }}><Trash2 size={14} /> {t('close')}</button>
    </div>}
  </div>;
});

function tabContextIcon(id: string, tab: TabRecord) {
  if (id === 'stash') return <Archive size={14} />;
  if (id === 'mute') return tab.muted ? <Volume2 size={14} /> : <MicOff size={14} />;
  if (id === 'pin') return <Pin size={14} />;
  if (id === 'discard') return <LockKeyhole size={14} />;
  if (id === 'close') return <Trash2 size={14} />;
  return undefined;
}
