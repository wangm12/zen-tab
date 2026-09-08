import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Archive, Check, ChevronDown, ChevronRight, Globe2, LockKeyhole, MicOff, MoreHorizontal, Palette, Pencil, Pin, Trash2, Ungroup, Volume2,
} from 'lucide-react';
import { displayHostname } from '../shared/url';
import { sortGroupsByStripOrder } from '../shared/tab-ops';
import { GroupColor, TabRecord, WindowSnapshot, ZenTabMessage } from '../shared/types';
import { Translator } from './i18n';

type TreeRow =
  | { kind: 'group'; id: number; name: string; color: string; count: number; collapsed: boolean; synthetic?: boolean }
  | { kind: 'tab'; tab: TabRecord };

type DropTarget =
  | { kind: 'start' }
  | { kind: 'tab'; tabId: number; position: 'before' | 'after' }
  | { kind: 'group'; groupId: number };

export function TabTree({ windowSnapshot, search, t, onToggleGroup, onStashGroup, onStashUngrouped, onStashTabs, onCloseTabs, onAction }: {
  windowSnapshot?: WindowSnapshot;
  search: string;
  t: Translator;
  onToggleGroup: (groupId: number, collapsed: boolean) => void;
  onStashGroup: (groupId: number) => void;
  onStashUngrouped: () => void;
  onStashTabs: (tabIds: number[]) => void;
  onCloseTabs: (tabIds: number[]) => Promise<boolean>;
  onAction: (message: ZenTabMessage) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const reorderTimer = useRef<number | undefined>(undefined);
  const [syntheticCollapsed, setSyntheticCollapsed] = useState<Set<number>>(new Set());
  const [draggedTabId, setDraggedTabId] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [settlingTabId, setSettlingTabId] = useState<number | null>(null);
  const [reorganizing, setReorganizing] = useState(false);
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
      next.push({ kind: 'group', id: group.groupId, name: group.title || t('untitledGroup'), color: group.color, count: tabs.length, collapsed: group.collapsed });
      if (!group.collapsed) tabs.forEach((tab) => next.push({ kind: 'tab', tab }));
    }
    const matchingUngrouped = ungrouped.filter(matches);
    if (matchingUngrouped.length || !normalizedSearch) {
      const syntheticId = -windowSnapshot.windowId;
      const collapsed = syntheticCollapsed.has(syntheticId);
      next.push({ kind: 'group', id: syntheticId, name: t('ungrouped'), color: 'none', count: matchingUngrouped.length, collapsed, synthetic: true });
      if (!collapsed) matchingUngrouped.forEach((tab) => next.push({ kind: 'tab', tab }));
    }
    return next;
  }, [normalizedSearch, syntheticCollapsed, t, windowSnapshot]);

  const visibleTabIds = useMemo(() => rows.filter((row): row is Extract<TreeRow, { kind: 'tab' }> => row.kind === 'tab').map((row) => row.tab.tabId), [rows]);

  useEffect(() => {
    const availableIds = new Set(windowSnapshot?.tabs.map((tab) => tab.tabId) ?? []);
    setSelectedTabIds((previous) => {
      const next = new Set([...previous].filter((tabId) => availableIds.has(tabId)));
      return next.size === previous.size ? previous : next;
    });
    setSelectionAnchorId((previous) => previous != null && availableIds.has(previous) ? previous : null);
  }, [windowSnapshot]);

  useEffect(() => () => {
    if (reorderTimer.current) window.clearTimeout(reorderTimer.current);
  }, []);

  const clearDrag = useCallback(() => {
    setDraggedTabId(null);
    setDropTarget(null);
  }, []);

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

  const beginDrag = useCallback((tabId: number, event: React.DragEvent<HTMLDivElement>) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/tab-id', String(tabId));
    setDraggedTabId(tabId);
    setDropTarget(null);
  }, []);

  const markReorganized = useCallback((tabId: number) => {
    if (reorderTimer.current) window.clearTimeout(reorderTimer.current);
    setSettlingTabId(tabId);
    setReorganizing(true);
    reorderTimer.current = window.setTimeout(() => {
      setSettlingTabId(null);
      setReorganizing(false);
      reorderTimer.current = undefined;
    }, 360);
  }, []);

  const dropOnTab = useCallback((targetTab: TabRecord, event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const draggedId = draggedTabId ?? Number(event.dataTransfer.getData('text/tab-id'));
    if (!Number.isFinite(draggedId) || draggedId === targetTab.tabId || !windowSnapshot) {
      clearDrag();
      return;
    }
    const draggedTab = windowSnapshot.tabs.find((tab) => tab.tabId === draggedId);
    const position = dropTarget?.kind === 'tab' && dropTarget.tabId === targetTab.tabId ? dropTarget.position : 'after';
    const movingForward = (draggedTab?.index ?? targetTab.index) < targetTab.index;
    const destinationIndex = position === 'before'
      ? targetTab.index - (movingForward ? 1 : 0)
      : targetTab.index + (movingForward ? 0 : 1);
    markReorganized(draggedId);
    onAction({ type: 'MOVE_TAB', tabId: draggedId, windowId: targetTab.windowId, index: Math.max(0, destinationIndex) });
    clearDrag();
  }, [clearDrag, draggedTabId, dropTarget, markReorganized, onAction, windowSnapshot]);

  const dropOnStart = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const draggedId = draggedTabId ?? Number(event.dataTransfer.getData('text/tab-id'));
    const draggedTab = windowSnapshot?.tabs.find((tab) => tab.tabId === draggedId);
    if (!Number.isFinite(draggedId) || !draggedTab || !windowSnapshot) {
      clearDrag();
      return;
    }
    if (draggedTab.index !== 0) {
      markReorganized(draggedId);
      onAction({ type: 'MOVE_TAB', tabId: draggedId, windowId: windowSnapshot.windowId, index: 0 });
    }
    clearDrag();
  }, [clearDrag, draggedTabId, markReorganized, onAction, windowSnapshot]);

  const dropOnGroup = useCallback((groupId: number, event: React.DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const draggedId = draggedTabId ?? Number(event.dataTransfer.getData('text/tab-id'));
    if (!Number.isFinite(draggedId)) {
      clearDrag();
      return;
    }
    markReorganized(draggedId);
    onAction({ type: 'GROUP_TAB', tabId: draggedId, groupId });
    clearDrag();
  }, [clearDrag, draggedTabId, markReorganized, onAction]);

  const virtualizer = useVirtualizer({ count: rows.length, getScrollElement: () => scrollRef.current, estimateSize: (index) => rows[index].kind === 'group' ? 40 : 62, overscan: 10 });
  const activeTabId = windowSnapshot?.tabs.find((tab) => tab.active)?.tabId ?? null;
  const lastScrolledActiveTabId = useRef<number | null>(null);

  useEffect(() => {
    if (activeTabId == null || activeTabId === lastScrolledActiveTabId.current) return;
    const activeRowIndex = rows.findIndex((row) => row.kind === 'tab' && row.tab.tabId === activeTabId);
    if (activeRowIndex < 0) return;
    lastScrolledActiveTabId.current = activeTabId;
    const frame = window.requestAnimationFrame(() => virtualizer.scrollToIndex(activeRowIndex, { align: 'auto' }));
    return () => window.cancelAnimationFrame(frame);
  }, [activeTabId, rows, virtualizer]);

  if (!windowSnapshot || rows.length === 0) return <div className="empty-state"><div className="empty-orbit"><Globe2 size={22} /></div><strong>{search ? t('noMatchingTabs') : t('clearWindow')}</strong><p>{search ? t('tryShorterTitle') : t('openTabToAppear')}</p></div>;

  const selectedIds = [...selectedTabIds];
  const selectionMode = selectedIds.length > 0;
  const closeSelected = async () => {
    if (await onCloseTabs(selectedIds)) clearSelection();
  };

  return <>
    {selectionMode && <div className="selection-bar" role="toolbar" aria-label={t('selected')}><span className="selection-summary"><strong>{selectedIds.length}</strong> {t('selected')} <span className="selection-mode-label">{t('selectionMode')}</span></span><div className="selection-actions"><button className="selection-action" onClick={() => { onStashTabs(selectedIds); clearSelection(); }}><Archive size={14} /> {t('stash')}</button><button className="selection-action" onClick={() => void closeSelected()}><Trash2 size={14} /> {t('close')}</button><button className="selection-clear" onClick={clearSelection} aria-label={t('exitSelection')}>{t('done')}</button></div></div>}
    <div className="tree-scroller" ref={scrollRef} tabIndex={0} aria-label={t('liveTabs')} onKeyDown={handleTreeKeyDown} onDragLeave={(event) => { if (event.currentTarget === event.target) setDropTarget(null); }}>
      {draggedTabId != null && <div className={dropTarget?.kind === 'start' ? 'drop-start-bar active' : 'drop-start-bar'} role="button" aria-label={t('moveTabToStart')} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTarget({ kind: 'start' }); }} onDrop={dropOnStart} />}
      <div className={reorganizing ? 'tree-canvas reorganizing' : 'tree-canvas'} style={{ height: virtualizer.getTotalSize() }}>{virtualizer.getVirtualItems().map((virtualRow) => {
        const row = rows[virtualRow.index];
        const isGroupTarget = row.kind === 'group' && dropTarget?.kind === 'group' && dropTarget.groupId === row.id;
        const tabDropPosition = row.kind === 'tab' && dropTarget?.kind === 'tab' && dropTarget.tabId === row.tab.tabId ? dropTarget.position : undefined;
        return <div key={row.kind === 'group' ? `group-${row.id}` : `tab-${row.tab.tabId}`} ref={virtualizer.measureElement} data-index={virtualRow.index} className="tree-position" style={{ transform: `translateY(${virtualRow.start}px)` }}>
          {row.kind === 'group' ? <GroupRow row={row} t={t} onToggle={() => {
            if (row.synthetic) setSyntheticCollapsed((previous) => {
              const next = new Set(previous);
              if (next.has(row.id)) next.delete(row.id); else next.add(row.id);
              return next;
            });
            else onToggleGroup(row.id, !row.collapsed);
          }} onStash={row.synthetic ? onStashUngrouped : () => onStashGroup(row.id)} onAction={onAction} onDragOver={(event) => { if (!row.synthetic && draggedTabId != null) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTarget({ kind: 'group', groupId: row.id }); } }} onDrop={(event) => { if (!row.synthetic) dropOnGroup(row.id, event); }} isDropTarget={Boolean(isGroupTarget)} /> : <TabRow tab={row.tab} t={t} selected={selectedTabIds.has(row.tab.tabId)} selectionMode={selectionMode} onSelect={(event, forceToggle) => selectTab(row.tab.tabId, event, forceToggle)} onClearSelection={clearSelection} onAction={onAction} onDragStart={beginDrag} onDragEnd={clearDrag} onDragOver={(event) => { if (draggedTabId == null || draggedTabId === row.tab.tabId) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; const rect = event.currentTarget.getBoundingClientRect(); const position = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'; setDropTarget({ kind: 'tab', tabId: row.tab.tabId, position }); }} onDrop={(event) => dropOnTab(row.tab, event)} isDragging={draggedTabId === row.tab.tabId} dropPosition={tabDropPosition} isSettling={settlingTabId === row.tab.tabId} />}
        </div>;
      })}</div></div>
  </>;
}

function GroupRow({ row, t, onToggle, onStash, onAction, onDragOver, onDrop, isDropTarget }: { row: Extract<TreeRow, { kind: 'group' }>; t: Translator; onToggle: () => void; onStash: () => void; onAction: (message: ZenTabMessage) => void; onDragOver: (event: React.DragEvent<HTMLButtonElement>) => void; onDrop: (event: React.DragEvent<HTMLButtonElement>) => void; isDropTarget: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(row.name === t('untitledGroup') ? '' : row.name);
  const colors: GroupColor[] = ['grey', 'blue', 'cyan', 'green', 'yellow', 'orange', 'red', 'pink', 'purple'];
  const colorLabels: Record<GroupColor, string> = { grey: t('groupColorGrey'), blue: t('groupColorBlue'), cyan: t('groupColorCyan'), green: t('groupColorGreen'), yellow: t('groupColorYellow'), orange: t('groupColorOrange'), red: t('groupColorRed'), pink: t('groupColorPink'), purple: t('groupColorPurple') };
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
  return <div className="group-row-shell">
    <button className={isDropTarget ? 'group-row drop-target' : 'group-row'} onClick={onToggle} onDragOver={onDragOver} onDrop={onDrop} aria-expanded={!row.collapsed}>
      <span className="group-chevron">{row.collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}</span>
      <span className={row.synthetic ? 'group-dot neutral' : `group-dot ${row.color}`} />
      <span className="group-name">{row.name}</span><span className="group-count">{row.count}</span>
    </button>
    <button className="group-stash" onClick={(event) => { event.stopPropagation(); onStash(); }} aria-label={`${t('stash')} ${row.name}`} title={`${t('stash')} ${row.name}`}><Archive size={14} /></button>
    {!row.synthetic && <button className="group-menu-button" onClick={(event) => { event.stopPropagation(); setMenuOpen((open) => !open); }} aria-label={`${t('tabActions')} ${row.name}`} aria-expanded={menuOpen} aria-haspopup="menu"><MoreHorizontal size={15} /></button>}
    {!row.synthetic && menuOpen && <div className="group-popover" role="menu">
      {renaming ? <form className="group-rename-form" onSubmit={(event) => { event.preventDefault(); submitRename(); }}><input autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={42} aria-label={t('renameGroup')} /><button className="icon-button subtle" type="submit" aria-label={t('done')}><Check size={14} /></button></form> : <button role="menuitem" onClick={() => setRenaming(true)}><Pencil size={14} /> {t('renameGroup')}</button>}
      <div className="group-color-menu" role="group" aria-label={t('changeGroupColor')}>{colors.map((color) => <button key={color} className={`group-color-swatch ${color}${row.color === color ? ' selected' : ''}`} onClick={() => { onAction({ type: 'UPDATE_GROUP', groupId: row.id, action: 'color', color }); setMenuOpen(false); }} aria-label={`${t('changeGroupColor')}: ${colorLabels[color]}`} title={colorLabels[color]}><Palette size={11} /></button>)}</div>
      <button role="menuitem" className="danger" onClick={() => { onAction({ type: 'UNGROUP_GROUP', groupId: row.id }); setMenuOpen(false); }}><Ungroup size={14} /> {t('ungroup')}</button>
    </div>}
  </div>;
}

const TabRow = memo(function TabRow({ tab, t, selected, selectionMode, onSelect, onClearSelection, onAction, onDragStart, onDragEnd, onDragOver, onDrop, isDragging, dropPosition, isSettling }: { tab: TabRecord; t: Translator; selected: boolean; selectionMode: boolean; onSelect: (event: React.MouseEvent<HTMLButtonElement>, forceToggle?: boolean) => void; onClearSelection: () => void; onAction: (message: ZenTabMessage) => void; onDragStart: (tabId: number, event: React.DragEvent<HTMLDivElement>) => void; onDragEnd: () => void; onDragOver: (event: React.DragEvent<HTMLDivElement>) => void; onDrop: (event: React.DragEvent<HTMLDivElement>) => void; isDragging: boolean; dropPosition?: 'before' | 'after'; isSettling: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPlacement, setMenuPlacement] = useState<'up' | 'down'>('down');
  const favicon = tab.favIconUrl;
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
    if (menuOpen) {
      setMenuOpen(false);
      return;
    }
    const row = event.currentTarget.closest('.tab-row');
    const rowBottom = row?.getBoundingClientRect().bottom ?? 0;
    setMenuPlacement(rowBottom + 186 > window.innerHeight - 8 ? 'up' : 'down');
    setMenuOpen(true);
  };
  const rowClass = ['tab-row', tab.active ? 'active' : '', selectionMode ? 'selection-mode' : '', selected ? 'selected' : '', isDragging ? 'dragging' : '', isSettling ? 'settling' : '', dropPosition ? `drop-${dropPosition}` : ''].filter(Boolean).join(' ');
  return <div className={rowClass} draggable onDragStart={(event) => onDragStart(tab.tabId, event)} onDragEnd={onDragEnd} onDrop={onDrop} onDragOver={onDragOver}>
    <button className={selected ? 'tab-select selected' : 'tab-select'} type="button" draggable={false} onClick={(event) => { event.stopPropagation(); onSelect(event, true); }} aria-pressed={selected} aria-label={selected ? t('deselectTab', { title: tab.title }) : t('selectTab', { title: tab.title })}><span className="selection-box">{selected && <Check size={11} />}</span></button>
    <button className="tab-main" onClick={(event) => { if (selectionMode) { event.preventDefault(); event.stopPropagation(); onSelect(event, true); return; } if (event.metaKey || event.ctrlKey || event.shiftKey) { event.preventDefault(); onSelect(event); return; } setMenuOpen(false); onClearSelection(); onAction({ type: 'UPDATE_TAB', tabId: tab.tabId, windowId: tab.windowId, action: 'activate' }); }} title={selectionMode ? t('clickToSelect') : (tab.url || tab.title)}>
      <span className="favicon-wrap">{favicon ? <img src={favicon} alt="" className="favicon" /> : <Globe2 size={15} />}</span>
      <span className="tab-copy"><span className="tab-title">{tab.title || t('untitledTab')}</span><span className="tab-host">{displayHostname(tab.url)}</span></span>
      <span className="tab-state" aria-label={tab.discarded ? t('discarded') : tab.audible ? t('playingAudio') : tab.pinned ? t('pinned') : undefined}>{tab.discarded ? <LockKeyhole size={13} /> : tab.audible ? <Volume2 size={13} /> : tab.pinned ? <Pin size={13} /> : null}</span>
    </button>
    <button className="row-menu" draggable={false} onClick={toggleMenu} aria-label={t('actionsFor', { title: tab.title })} aria-expanded={menuOpen} aria-haspopup="menu"><MoreHorizontal size={16} /></button>
    {menuOpen && <div className={menuPlacement === 'up' ? 'row-popover up' : 'row-popover'} role="menu">
      <button role="menuitem" onClick={() => { onAction({ type: 'UPDATE_TAB', tabId: tab.tabId, action: tab.muted ? 'unmute' : 'mute' }); setMenuOpen(false); }}>{tab.muted ? <Volume2 size={14} /> : <MicOff size={14} />} {tab.muted ? t('unmute') : t('mute')}</button>
      <button role="menuitem" onClick={() => { onAction({ type: 'UPDATE_TAB', tabId: tab.tabId, action: tab.pinned ? 'unpin' : 'pin' }); setMenuOpen(false); }}><Pin size={14} /> {tab.pinned ? t('unpin') : t('pin')}</button>
      <button role="menuitem" onClick={() => { onAction({ type: 'UPDATE_TAB', tabId: tab.tabId, action: 'discard' }); setMenuOpen(false); }}><LockKeyhole size={14} /> {t('discarded')}</button>
      <button role="menuitem" className="danger" onClick={() => { onAction({ type: 'UPDATE_TAB', tabId: tab.tabId, action: 'close' }); setMenuOpen(false); }}><Trash2 size={14} /> {t('close')}</button>
    </div>}
  </div>;
});
