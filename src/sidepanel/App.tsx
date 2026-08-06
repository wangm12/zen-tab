import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Archive,
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Globe2,
  Info,
  Layers3,
  ListFilter,
  LockKeyhole,
  MicOff,
  MoreHorizontal,
  PanelLeft,
  Pin,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  Tag,
  Trash2,
  Undo2,
  Volume2,
  X,
  Zap,
} from 'lucide-react';
import { createAIProvider } from '../shared/ai';
import { displayHostname } from '../shared/url';
import { CleanupProposal, GroupProposal, StashRecord, ZenTabMessage, ZenTabSettings, TabRecord, ToastMessage, WindowSnapshot } from '../shared/types';
import { createTranslator, Translator } from './i18n';
import { useZenTabStore } from './store';

type RequestFn = <T = unknown>(message: ZenTabMessage) => Promise<T>;
type StashSelection = { scope: 'window' | 'group' | 'tabs'; groupId?: number; tabIds?: number[]; includePinned: boolean; includeActive: boolean; busyLabel: string };
const TOAST_DURATION_MS = 5000;

function App() {
  const {
    snapshot,
    selectedWindowId,
    section,
    search,
    modal,
    groupProposal,
    cleanupProposal,
    groupScanProgress,
    busy,
    toast,
    error,
    load,
    request,
    setSection,
    setSearch,
    setModal,
    setGroupProposal,
    setCleanupProposal,
    setBusy,
    showToast,
    updateSettings,
  } = useZenTabStore();
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [draftGroupProposal, setDraftGroupProposal] = useState<GroupProposal | null>(null);
  const [draftCleanupProposal, setDraftCleanupProposal] = useState<CleanupProposal | null>(null);
  const [stashMenuOpen, setStashMenuOpen] = useState(false);
  const [stashDropActive, setStashDropActive] = useState(false);
  const undoInFlight = useRef(false);
  const language = snapshot?.settings.language ?? 'en';
  const t = useMemo(() => createTranslator(language), [language]);

  useEffect(() => setDraftGroupProposal(groupProposal), [groupProposal]);
  useEffect(() => setDraftCleanupProposal(cleanupProposal), [cleanupProposal]);
  useEffect(() => {
    if (!stashMenuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setStashMenuOpen(false); };
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest('.stash-action-wrap')) setStashMenuOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
    };
  }, [stashMenuOpen]);

  const currentWindow = snapshot?.windows.find((window) => window.windowId === selectedWindowId) ?? snapshot?.windows[0];
  const proposalTabs = draftGroupProposal ? snapshot?.windows.find((window) => window.windowId === draftGroupProposal.sourceWindowId)?.tabs ?? [] : [];
  const tabCount = snapshot?.windows.reduce((sum, window) => sum + window.tabs.length, 0) ?? 0;

  const action = useCallback(async (message: Parameters<typeof request>[0], success?: string, successAction?: ToastMessage['action']): Promise<boolean> => {
    try {
      await request(message);
      if (success) showToast({ id: `${Date.now()}`, tone: 'success', message: success, ...(successAction ? { action: successAction } : {}) });
      return true;
    } catch (actionError) {
      showToast({ id: `${Date.now()}`, tone: 'error', message: actionError instanceof Error ? actionError.message : t('actionFailed') });
      return false;
    }
  }, [request, showToast, t]);

  const updateSettingsSafe = useCallback(async (patch: Partial<ZenTabSettings>) => {
    try {
      await updateSettings(patch);
    } catch (settingsError) {
      showToast({ id: `${Date.now()}`, tone: 'error', message: settingsError instanceof Error ? settingsError.message : t('couldNotSaveSettings') });
      throw settingsError;
    }
  }, [showToast, t, updateSettings]);

  const updateAIProvider = useCallback(async (provider: ZenTabSettings['aiProvider']) => {
    try {
      if (provider === 'groq') {
        const granted = await chrome.permissions.request({ origins: ['https://api.groq.com/*'] });
        if (!granted) {
          showToast({ id: `${Date.now()}`, tone: 'warning', message: t('groqPermissionDenied') });
          return;
        }
      }
      await updateSettingsSafe({ aiProvider: provider });
    } catch (providerError) {
      showToast({ id: `${Date.now()}`, tone: 'error', message: providerError instanceof Error ? providerError.message : t('couldNotSaveSettings') });
      throw providerError;
    }
  }, [showToast, t, updateSettingsSafe]);

  const runGroupAnalysis = useCallback(async () => {
    if (!currentWindow) return;
    const deepScanAll = Boolean(snapshot?.settings.deepAnalysisEnabled);
    useZenTabStore.setState({ groupScanProgress: null });
    setBusy(deepScanAll ? t('scanningAllPageContext') : t('enrichingUncertainTabs'));
    try {
      const prepared = await request<{ inputs: Array<{ tabId: number; title: string; url: string; canonicalUrl: string | null; summary?: string }>; deepAnalysisUsed: boolean; proposal?: GroupProposal }>({
        type: 'RUN_GROUP_ANALYSIS',
        windowId: currentWindow.windowId,
        deepScanAll,
      });
      const provider = createAIProvider(snapshot?.settings ?? ({} as ZenTabSettings));
      const proposal = prepared.proposal ?? await provider.proposeProjects(prepared.inputs);
      setGroupProposal({ ...proposal, sourceWindowId: currentWindow.windowId, analyzedTabIds: prepared.inputs.map((input) => input.tabId) });
      setModal('group');
      showToast({ id: `${Date.now()}`, tone: 'neutral', message: prepared.deepAnalysisUsed ? t('projectContextEnriched') : t('projectContextMetadata') });
    } catch (analysisError) {
      showToast({ id: `${Date.now()}`, tone: 'error', message: analysisError instanceof Error ? analysisError.message : t('couldNotAnalyzeWindow') });
    } finally {
      setBusy(null);
      useZenTabStore.setState({ groupScanProgress: null });
    }
  }, [currentWindow, request, setBusy, setGroupProposal, setModal, showToast, snapshot?.settings, t]);

  const runCleanupAnalysis = useCallback(async () => {
    if (!currentWindow) return;
    setBusy(t('findingLowValueTabs'));
    try {
      const proposal = await request<CleanupProposal>({ type: 'RUN_CLEANUP_ANALYSIS', windowId: currentWindow.windowId });
      setCleanupProposal(proposal);
      setModal('cleanup');
    } catch (analysisError) {
      showToast({ id: `${Date.now()}`, tone: 'error', message: analysisError instanceof Error ? analysisError.message : t('couldNotScanWindow') });
    } finally {
      setBusy(null);
    }
  }, [currentWindow, request, setBusy, setCleanupProposal, setModal, showToast, t]);

  const stashSelection = useCallback(async (selection: StashSelection) => {
    if (!currentWindow) return;
    setStashMenuOpen(false);
    setStashDropActive(false);
    setBusy(selection.busyLabel);
    try {
      const stash = await request<StashRecord>({ type: 'STASH', windowId: currentWindow.windowId, scope: selection.scope, groupId: selection.groupId, tabIds: selection.tabIds, includePinned: selection.includePinned, includeActive: selection.includeActive });
      showToast({ id: `${Date.now()}`, tone: 'success', message: t('tabsStashed', { count: stash.tabs.length }), action: 'undo' });
    } catch (stashError) {
      showToast({ id: `${Date.now()}`, tone: 'error', message: stashError instanceof Error ? stashError.message : t('couldNotStashTabs') });
    } finally {
      setBusy(null);
    }
  }, [currentWindow, request, setBusy, showToast, t]);

  const stashGroup = useCallback((groupId: number) => {
    void stashSelection({ scope: 'group', groupId, includePinned: false, includeActive: true, busyLabel: t('stashingGroup') });
  }, [stashSelection, t]);

  const handleStashDragOver = useCallback((event: React.DragEvent<HTMLButtonElement>) => {
    if (!event.dataTransfer.types.includes('text/tab-id')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setStashDropActive(true);
  }, []);

  const handleStashDrop = useCallback((event: React.DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const tabId = Number(event.dataTransfer.getData('text/tab-id'));
    setStashDropActive(false);
    if (Number.isFinite(tabId)) void stashSelection({ scope: 'tabs', tabIds: [tabId], includePinned: true, includeActive: true, busyLabel: t('stashingTab') });
  }, [stashSelection, t]);

  const closeSelectedTabs = useCallback(async (tabIds: number[]) => {
    try {
      const result = await request<{ closed: number }>({ type: 'CLOSE_TABS', tabIds });
      showToast({ id: `${Date.now()}`, tone: 'success', message: t('tabsClosed', { count: result.closed }), ...(result.closed > 0 ? { action: 'undo' as const } : {}) });
      return true;
    } catch (closeError) {
      showToast({ id: `${Date.now()}`, tone: 'error', message: closeError instanceof Error ? closeError.message : t('couldNotCloseTabs') });
      return false;
    }
  }, [request, showToast, t]);

  const applyCleanup = useCallback(async (proposal: CleanupProposal, tabIds: number[]) => {
    try {
      const result = await request<{ closed: number; skipped: number }>({ type: 'APPLY_CLEANUP', proposalId: proposal.proposalId, tabIds });
      showToast({ id: `${Date.now()}`, tone: result.skipped > 0 ? 'warning' : 'success', message: result.skipped > 0 ? t('tabsClosedWithSkipped', { closed: result.closed, skipped: result.skipped }) : t('tabsClosed', { count: result.closed }), ...(result.closed > 0 ? { action: 'undo' as const } : {}) });
      setModal(null);
    } catch (cleanupError) {
      showToast({ id: `${Date.now()}`, tone: 'error', message: cleanupError instanceof Error ? cleanupError.message : t('couldNotCloseTabs') });
    }
  }, [request, setModal, showToast, t]);

  const undo = useCallback(async () => {
    if (undoInFlight.current) return;
    undoInFlight.current = true;
    try {
      const result = await request<{ undone: boolean }>({ type: 'UNDO_ACTION' });
      showToast({ id: `${Date.now()}`, tone: result.undone ? 'success' : 'neutral', message: result.undone ? t('lastActionRestored') : t('nothingToUndo') });
    } catch (error) {
      showToast({ id: `${Date.now()}`, tone: 'error', message: error instanceof Error ? error.message : t('actionFailed') });
    } finally {
      undoInFlight.current = false;
    }
  }, [request, showToast, t]);

  useEffect(() => {
    const handleUndoShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.key.toLowerCase() !== 'z') return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable)) return;
      if (!snapshot?.lastAction || snapshot.lastAction.expiresAt <= Date.now()) return;
      event.preventDefault();
      void undo();
    };
    window.addEventListener('keydown', handleUndoShortcut);
    return () => window.removeEventListener('keydown', handleUndoShortcut);
  }, [snapshot?.lastAction, undo]);

  const dismissToast = useCallback(() => {
    useZenTabStore.setState({ toast: null });
  }, []);

  const requestDeepScanAll = useCallback(async (enabled: boolean) => {
    try {
      if (!enabled) {
        await updateSettingsSafe({ deepAnalysisEnabled: false });
        return;
      }
      const granted = await chrome.permissions.request({ permissions: ['scripting'], origins: ['<all_urls>'] });
      await updateSettingsSafe({ deepAnalysisEnabled: granted });
      showToast({ id: `${Date.now()}`, tone: granted ? 'success' : 'warning', message: granted ? t('deepScanReady') : t('adaptiveMetadataEnabled') });
    } catch {
      showToast({ id: `${Date.now()}`, tone: 'warning', message: t('permissionDenied') });
    }
  }, [showToast, t, updateSettingsSafe]);

  if (!snapshot) return <LoadingState error={error} t={t} />;

  return (
    <main className="app-shell">
      <nav className="section-switcher" aria-label={t('zenTabSections')}>
        <button className={section === 'tabs' ? 'section-tab active' : 'section-tab'} onClick={() => setSection('tabs')}><Layers3 size={15} /> {t('liveTabs')} <span className="count-pill">{tabCount}</span></button>
        <button className={`${section === 'stashes' ? 'section-tab active' : 'section-tab'}${stashDropActive ? ' drop-target' : ''}`} onClick={() => setSection('stashes')} onDragOver={handleStashDragOver} onDragLeave={() => setStashDropActive(false)} onDrop={handleStashDrop} aria-label={t('stashLibrary')}><Archive size={15} /> {stashDropActive ? t('dropToStash') : t('stash')} <span className="count-pill">{snapshot.stashes.length}</span></button>
      </nav>

      {section === 'tabs' ? (
        <>
          {snapshot.windows.length > 1 && <div className="window-tabs" aria-label={t('browserWindows')}>
            {snapshot.windows.map((window, index) => (
              <button key={window.windowId} className={window.windowId === currentWindow?.windowId ? 'window-chip active' : 'window-chip'} onClick={() => useZenTabStore.setState({ selectedWindowId: window.windowId })} aria-label={`${window.incognito ? t('privateWindow') : t('window', { index: index + 1 })}, ${window.tabs.length} tabs`}>
                <span className={window.incognito ? 'window-dot private' : 'window-dot'} />
                <span>{window.incognito ? t('privateWindow') : t('window', { index: index + 1 })}</span>
                <small>{window.tabs.length}</small>
              </button>
            ))}
          </div>}

          <div className="command-row">
            <label className="search-box">
              <Search size={16} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('findTabOrProject')} aria-label={t('findTabOrProject')} />
              {search && <button className="search-clear" onClick={() => setSearch('')} aria-label={t('close')}><X size={13} /></button>}
            </label>
            <div className="command-actions" aria-label={t('tabActions')}>
              <button className="command-button accent" onClick={() => void runGroupAnalysis()} disabled={Boolean(busy)}><Sparkles size={15} /> {t('groupTabs')}</button>
              <button className="command-button" onClick={() => void runCleanupAnalysis()} disabled={Boolean(busy)}><ListFilter size={15} /> {t('cleanUp')}</button>
              <div className="stash-action-wrap">
                <button className="command-button" onClick={() => setStashMenuOpen((open) => !open)} disabled={Boolean(busy)} aria-expanded={stashMenuOpen} aria-haspopup="menu"><ArrowDownToLine size={15} /> {t('stash')} <ChevronDown size={13} /></button>
                {stashMenuOpen && <div className="stash-popover" role="menu" aria-label={t('stash')}>
                  <button className="stash-menu-item" role="menuitem" onClick={() => void stashSelection({ scope: 'window', includePinned: false, includeActive: false, busyLabel: t('stashingWindow') })}>
                    <span className="stash-menu-icon" aria-hidden="true"><PanelLeft size={15} /></span>
                    <span className="stash-menu-copy"><strong>{t('stashWindow')}</strong><small>{t('keepPinnedActive')}</small></span>
                  </button>
                  <button className="stash-menu-item" role="menuitem" onClick={() => void stashSelection({ scope: 'window', includePinned: true, includeActive: true, busyLabel: t('stashingAllTabs') })}>
                    <span className="stash-menu-icon" aria-hidden="true"><Layers3 size={15} /></span>
                    <span className="stash-menu-copy"><strong>{t('stashAllTabs')}</strong><small>{t('includePinnedActive')}</small></span>
                  </button>
                </div>}
              </div>
            </div>
          </div>

          {busy && <div className="busy-bar" role="status"><span className="busy-spinner" /><span>{busy}</span>{groupScanProgress && <span className="busy-progress">{groupScanProgress.scanned}/{groupScanProgress.total}</span>}<span className="busy-tail">{t('workingQuietly')}</span></div>}

          <TabTree
            windowSnapshot={currentWindow}
            search={search}
            collapsed={collapsed}
            t={t}
            onToggleGroup={(groupId) => setCollapsed((previous) => {
              const next = new Set(previous);
              if (next.has(groupId)) next.delete(groupId); else next.add(groupId);
              return next;
            })}
            onStashGroup={stashGroup}
            onStashTabs={(tabIds) => void stashSelection({ scope: 'tabs', tabIds, includePinned: true, includeActive: true, busyLabel: t('stashingSelectedTabs') })}
            onCloseTabs={closeSelectedTabs}
            onAction={(message) => {
              if (message.type === 'UPDATE_TAB' && message.action === 'activate' && message.windowId != null) {
                useZenTabStore.setState({ selectedWindowId: message.windowId });
              }
              if (message.type === 'UPDATE_TAB' && message.action === 'close') {
                void closeSelectedTabs([message.tabId]);
                return;
              }
              void action(message);
            }}
          />
        </>
      ) : (
        <StashList stashes={snapshot.stashes} request={request} showToast={showToast} t={t} />
      )}

      <footer className="app-footer">
        <div className="footer-line">
          <span><Zap size={13} /> {t('quietlySynced')}</span>
          <span>{snapshot.settings.deepAnalysisEnabled ? t('deepScanOn') : t('adaptiveContext')}</span>
        </div>
        <div className="bottom-bar">
          <div className="brand-lockup">
            <img className="brand-mark" src="/icons/zen-tab-48.png" alt="" />
            <div className="brand-copy">
              <div className="brand-name">Zen Tab <span className="live-dot" /></div>
              <h1>{t('tabWorkspace')}</h1>
            </div>
          </div>
          <button className="icon-button muted-action" aria-label={t('openSettings')} onClick={() => setModal('settings')}><Settings2 size={17} /></button>
        </div>
      </footer>

      {toast && <Toast key={toast.id} toast={toast} t={t} onDismiss={dismissToast} onUndo={() => void undo()} />}
      {modal === 'group' && draftGroupProposal && <GroupModal proposal={draftGroupProposal} tabs={proposalTabs} t={t} onChange={setDraftGroupProposal} onClose={() => setModal(null)} onApply={async (selectedIndexes) => { const selectedGroups = draftGroupProposal.groups.filter((_, index) => selectedIndexes.includes(index)); if (await action({ type: 'APPLY_GROUP_PROPOSAL', proposal: { ...draftGroupProposal, groups: selectedGroups } }, t('groupsCreated', { count: selectedGroups.length }), 'undo')) setModal(null); }} />}
      {modal === 'cleanup' && draftCleanupProposal && <CleanupModal proposal={draftCleanupProposal} t={t} onClose={() => setModal(null)} onApply={(tabIds) => applyCleanup(draftCleanupProposal, tabIds)} />}
      {modal === 'settings' && <SettingsPanel settings={snapshot.settings} hasGroqApiKey={snapshot.hasGroqApiKey} t={t} onClose={() => setModal(null)} onUpdate={updateSettingsSafe} onUpdateProvider={updateAIProvider} onUpdateGroqKey={async (apiKey) => { try { await request({ type: 'UPDATE_GROQ_KEY', apiKey }); await load(); showToast({ id: `${Date.now()}`, tone: 'success', message: t('groqKeySaved') }); } catch (keyError) { showToast({ id: `${Date.now()}`, tone: 'error', message: keyError instanceof Error ? keyError.message : t('couldNotSaveGroqKey') }); } }} onRequestDeepScanAll={requestDeepScanAll} />}
    </main>
  );
}

function LoadingState({ error, t }: { error: string | null; t: Translator }) {
  return <main className="loading-state"><img className="brand-mark large" src="/icons/zen-tab-48.png" alt="" /><div><strong>{t('openingZenTab')}</strong><p>{error ?? t('connectingToTabs')}</p></div></main>;
}

type TreeRow =
  | { kind: 'group'; id: number; name: string; color: string; count: number; collapsed: boolean; synthetic?: boolean }
  | { kind: 'tab'; tab: TabRecord };

type DropTarget =
  | { kind: 'start' }
  | { kind: 'tab'; tabId: number; position: 'before' | 'after' }
  | { kind: 'group'; groupId: number };

function TabTree({ windowSnapshot, search, collapsed, t, onToggleGroup, onStashGroup, onStashTabs, onCloseTabs, onAction }: { windowSnapshot?: WindowSnapshot; search: string; collapsed: Set<number>; t: Translator; onToggleGroup: (groupId: number) => void; onStashGroup: (groupId: number) => void; onStashTabs: (tabIds: number[]) => void; onCloseTabs: (tabIds: number[]) => Promise<boolean>; onAction: (message: ZenTabMessage) => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const reorderTimer = useRef<number | undefined>(undefined);
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
    for (const group of [...windowSnapshot.groups].sort((a, b) => a.groupId - b.groupId)) {
      const tabs = (groups.get(group.groupId) ?? []).filter(matches);
      if (normalizedSearch && tabs.length === 0) continue;
      next.push({ kind: 'group', id: group.groupId, name: group.title || t('untitledGroup'), color: group.color, count: tabs.length, collapsed: collapsed.has(group.groupId) });
      if (!collapsed.has(group.groupId)) tabs.forEach((tab) => next.push({ kind: 'tab', tab }));
    }
    const matchingUngrouped = ungrouped.filter(matches);
    if (matchingUngrouped.length || !normalizedSearch) {
      const syntheticId = -windowSnapshot.windowId;
      next.push({ kind: 'group', id: syntheticId, name: t('ungrouped'), color: 'none', count: matchingUngrouped.length, collapsed: collapsed.has(syntheticId), synthetic: true });
      if (!collapsed.has(syntheticId)) matchingUngrouped.forEach((tab) => next.push({ kind: 'tab', tab }));
    }
    return next;
  }, [collapsed, normalizedSearch, t, windowSnapshot]);

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

  const virtualizer = useVirtualizer({ count: rows.length, getScrollElement: () => scrollRef.current, estimateSize: (index) => rows[index].kind === 'group' ? 37 : 62, overscan: 10 });
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
    {selectionMode && <div className="selection-bar" role="toolbar" aria-label={t('selected')}><span className="selection-summary"><strong>{selectedIds.length}</strong> {t('selected')} <span className="selection-mode-label">{t('selectionMode')}</span></span><div className="selection-actions"><button className="selection-action" onClick={() => { onStashTabs(selectedIds); clearSelection(); }}><ArrowDownToLine size={14} /> {t('stash')}</button><button className="selection-action" onClick={() => void closeSelected()}><Trash2 size={14} /> {t('close')}</button><button className="selection-clear" onClick={clearSelection} aria-label={t('exitSelection')}>{t('done')}</button></div></div>}
    <div className="tree-scroller" ref={scrollRef} tabIndex={0} aria-label={t('liveTabs')} onKeyDown={handleTreeKeyDown} onDragLeave={(event) => { if (event.currentTarget === event.target) setDropTarget(null); }}>
      {draggedTabId != null && <div className={dropTarget?.kind === 'start' ? 'drop-start-bar active' : 'drop-start-bar'} role="button" aria-label={t('moveTabToStart')} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTarget({ kind: 'start' }); }} onDrop={dropOnStart} />}
      <div className={reorganizing ? 'tree-canvas reorganizing' : 'tree-canvas'} style={{ height: virtualizer.getTotalSize() }}>{virtualizer.getVirtualItems().map((virtualRow) => {
    const row = rows[virtualRow.index];
    const isGroupTarget = row.kind === 'group' && dropTarget?.kind === 'group' && dropTarget.groupId === row.id;
    const tabDropPosition = row.kind === 'tab' && dropTarget?.kind === 'tab' && dropTarget.tabId === row.tab.tabId ? dropTarget.position : undefined;
    return <div key={row.kind === 'group' ? `group-${row.id}` : `tab-${row.tab.tabId}`} ref={virtualizer.measureElement} data-index={virtualRow.index} className="tree-position" style={{ transform: `translateY(${virtualRow.start}px)` }}>
      {row.kind === 'group' ? <GroupRow row={row} t={t} onToggle={() => onToggleGroup(row.id)} onStash={() => onStashGroup(row.id)} onDragOver={(event) => { if (!row.synthetic && draggedTabId != null) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTarget({ kind: 'group', groupId: row.id }); } }} onDrop={(event) => { if (!row.synthetic) dropOnGroup(row.id, event); }} isDropTarget={Boolean(isGroupTarget)} /> : <TabRow tab={row.tab} t={t} selected={selectedTabIds.has(row.tab.tabId)} selectionMode={selectionMode} onSelect={(event, forceToggle) => selectTab(row.tab.tabId, event, forceToggle)} onClearSelection={clearSelection} onAction={onAction} onDragStart={beginDrag} onDragEnd={clearDrag} onDragOver={(event) => { if (draggedTabId == null || draggedTabId === row.tab.tabId) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; const rect = event.currentTarget.getBoundingClientRect(); const position = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'; setDropTarget({ kind: 'tab', tabId: row.tab.tabId, position }); }} onDrop={(event) => dropOnTab(row.tab, event)} isDragging={draggedTabId === row.tab.tabId} dropPosition={tabDropPosition} isSettling={settlingTabId === row.tab.tabId} />}
    </div>;
  })}</div></div>
  </>;
}

function GroupRow({ row, t, onToggle, onStash, onDragOver, onDrop, isDropTarget }: { row: Extract<TreeRow, { kind: 'group' }>; t: Translator; onToggle: () => void; onStash: () => void; onDragOver: (event: React.DragEvent<HTMLButtonElement>) => void; onDrop: (event: React.DragEvent<HTMLButtonElement>) => void; isDropTarget: boolean }) {
  return <div className="group-row-shell">
    <button className={isDropTarget ? 'group-row drop-target' : 'group-row'} onClick={onToggle} onDragOver={onDragOver} onDrop={onDrop} aria-expanded={!row.collapsed}>
      <span className="group-chevron">{row.collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}</span>
      <span className={row.synthetic ? 'group-dot neutral' : `group-dot ${row.color}`} />
      <span className="group-name">{row.name}</span><span className="group-count">{row.count}</span>
    </button>
    {!row.synthetic && <button className="group-stash" onClick={(event) => { event.stopPropagation(); onStash(); }} aria-label={`${t('stash')} ${row.name}`} title={`${t('stash')} ${row.name}`}><ArrowDownToLine size={14} /></button>}
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
    setMenuPlacement(rowBottom + 146 > window.innerHeight - 8 ? 'up' : 'down');
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

function ModalFrame({ eyebrow, title, description, closeLabel, onClose, children, footer }: { eyebrow: string; title: string; description: string; closeLabel?: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  const titleId = `${useId()}-title`;
  const descriptionId = `${useId()}-description`;
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const focusable = () => [...(dialog?.querySelectorAll<HTMLElement>('button, input, select, textarea, [href], [tabindex]:not([tabindex="-1"])') ?? [])].filter((element) => !element.hasAttribute('disabled'));
    focusable()[0]?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><section ref={dialogRef} className="modal-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}>
    <header className="modal-header"><div><span className="eyebrow">{eyebrow}</span><h2 id={titleId}>{title}</h2><p id={descriptionId}>{description}</p></div><button className="icon-button" onClick={onClose} aria-label={closeLabel ?? 'Close'}><X size={18} /></button></header>
    <div className="modal-content">{children}</div>
    {footer && <footer className="modal-footer">{footer}</footer>}
  </section></div>;
}

function GroupModal({ proposal, tabs, t, onChange, onClose, onApply }: { proposal: GroupProposal; tabs: TabRecord[]; t: Translator; onChange: (proposal: GroupProposal) => void; onClose: () => void; onApply: (selectedIndexes: number[]) => Promise<void> }) {
  const [selected, setSelected] = useState(new Set(proposal.groups.flatMap((group, index) => group.confidence === 'low' ? [] : [index])));
  const [applying, setApplying] = useState(false);
  const tabsById = useMemo(() => new Map(tabs.map((tab) => [tab.tabId, tab])), [tabs]);
  const confidenceCopy = {
    high: { label: t('strongMatch'), description: t('severalSignals') },
    medium: { label: t('possibleMatch'), description: t('someSignals') },
    low: { label: t('needsReview'), description: t('limitedContext') },
  } as const;
  const apply = async () => { setApplying(true); await onApply([...selected]); setApplying(false); };
  return <ModalFrame eyebrow={t('projectMap')} title={t('suggestedGroups', { count: proposal.groups.length })} description={t('checkTabsEvidence')} closeLabel={t('close')} onClose={onClose}>
    <div className="confidence-banner"><Sparkles size={16} /><span><strong>{t('suggestionsToReview')}</strong> · {t('tabsNeedMoreContext', { count: proposal.unclassifiedTabIds.length })}</span><span className="confidence-note">{t('reviewBeforeApplying')}</span></div>
    <div className="proposal-list">{proposal.groups.map((group, index) => <div className={selected.has(index) ? 'proposal-group selected' : 'proposal-group'} key={`${group.name}-${index}`}>
      <div className="proposal-heading"><label className="check-wrap"><input type="checkbox" aria-label={t('selectGroup', { name: group.name })} checked={selected.has(index)} onChange={() => setSelected((previous) => { const next = new Set(previous); if (next.has(index)) next.delete(index); else next.add(index); return next; })} /><span className="fake-check"><Check size={12} /></span></label><input className="proposal-name" value={group.name} onChange={(event) => onChange({ ...proposal, groups: proposal.groups.map((item, groupIndex) => groupIndex === index ? { ...item, name: event.target.value } : item) })} /><span className={`confidence ${group.confidence}`} title={confidenceCopy[group.confidence].description} aria-label={`${confidenceCopy[group.confidence].label}: ${confidenceCopy[group.confidence].description}`}>{confidenceCopy[group.confidence].label}</span></div>
      <div className="proposal-tabs">{group.tabIds.map((tabId) => { const tab = tabsById.get(tabId); const title = tab?.title.trim() || t('untitledTab'); const host = tab ? displayHostname(tab.url) : t('pageNoLongerAvailable'); return <span key={tabId} className="proposal-tab" title={tab ? `${title}\n${tab.url}` : title}><span className="mini-dot" /><span className="proposal-tab-copy"><strong className="proposal-tab-title">{title}</strong><small className="proposal-tab-host">{host}</small></span></span>; })}</div>
      <div className="evidence-line"><Info size={13} /> {group.evidence.map((evidence) => `${evidence.label}: ${evidence.detail}`).join(' · ')}</div>
    </div>)}</div>
    {proposal.unclassifiedTabIds.length > 0 && <div className="unclassified-note"><CircleHelp size={15} /><span>{t('keptAside', { count: proposal.unclassifiedTabIds.length })}</span></div>}
    <div className="modal-actions"><button className="text-button" onClick={onClose}>{t('keepAsIs')}</button><button className="primary-button" disabled={applying || selected.size === 0} onClick={() => void apply()}>{applying ? t('applying') : t('createGroups', { count: selected.size })} <ArrowUpRight size={15} /></button></div>
  </ModalFrame>;
}

function CleanupModal({ proposal, t, onClose, onApply }: { proposal: CleanupProposal; t: Translator; onClose: () => void; onApply: (tabIds: number[]) => Promise<void> }) {
  const safeCandidates = proposal.candidates.filter((candidate) => !candidate.protected);
  const [selected, setSelected] = useState(new Set(safeCandidates.filter((candidate) => candidate.confidence !== 'low').map((candidate) => candidate.tabId)));
  const apply = async () => onApply([...selected]);
  return <ModalFrame eyebrow={t('lowValueScan')} title={t('possibleCleanups', { count: safeCandidates.length })} description={t('nothingCloses')} closeLabel={t('close')} onClose={onClose}>
    <div className="confidence-banner amber"><ShieldIcon /><span><strong>{t('protectedPages')}</strong> · {t('conservative')}</span></div>
    <div className="cleanup-list">{proposal.candidates.map((candidate) => <label className={candidate.protected ? 'cleanup-item protected' : 'cleanup-item'} key={candidate.tabId}>
      <span className="check-wrap">{candidate.protected ? <LockKeyhole size={15} /> : <><input type="checkbox" checked={selected.has(candidate.tabId)} onChange={() => setSelected((previous) => { const next = new Set(previous); if (next.has(candidate.tabId)) next.delete(candidate.tabId); else next.add(candidate.tabId); return next; })} /><span className="fake-check"><Check size={12} /></span></>}</span>
      <span className="cleanup-copy"><strong>{candidate.title || t('untitledTab')}</strong><span>{candidate.reason}</span><small>{displayHostname(candidate.url)} · {candidate.evidence.join(' ')}</small></span>
      <span className={`confidence ${candidate.confidence}`}>{candidate.confidence === 'high' ? t('strongMatch') : candidate.confidence === 'medium' ? t('possibleMatch') : t('needsReview')}</span>
    </label>)}</div>
    {safeCandidates.length === 0 && <div className="empty-modal"><div className="empty-orbit"><Check size={20} /></div><strong>{t('noSafeCleanup')}</strong><p>{t('contextIntentional')}</p></div>}
    <div className="modal-actions"><button className="text-button" onClick={onClose}>{t('leaveEverything')}</button><button className="primary-button danger-button" disabled={selected.size === 0} onClick={() => void apply()}>{t('close')} {t('tabsCount', { count: selected.size })} <Trash2 size={15} /></button></div>
  </ModalFrame>;
}

function ShieldIcon() { return <LockKeyhole size={16} />; }

function StashList({ stashes, request, showToast, t }: { stashes: StashRecord[]; request: RequestFn; showToast: (toast: ToastMessage) => void; t: Translator }) {
  const [loading, setLoading] = useState<string | null>(null);
  const restore = async (stash: StashRecord) => {
    if (loading) return;
    setLoading(stash.id);
    try { await request({ type: 'RESTORE_STASH', stashId: stash.id }); showToast({ id: `${Date.now()}`, tone: 'success', message: t('tabsOpening', { count: stash.tabs.length }) }); }
    catch (error) { showToast({ id: `${Date.now()}`, tone: 'error', message: error instanceof Error ? error.message : t('couldNotRestoreStash') }); }
    finally { setLoading(null); }
  };
  const remove = async (stash: StashRecord) => {
    if (loading) return;
    setLoading(stash.id);
    try { await request({ type: 'DELETE_STASH', stashId: stash.id }); showToast({ id: `${Date.now()}`, tone: 'neutral', message: t('stashDeleted') }); }
    catch (error) { showToast({ id: `${Date.now()}`, tone: 'error', message: error instanceof Error ? error.message : t('couldNotDeleteStash') }); }
    finally { setLoading(null); }
  };
  return <section className="stash-view"><div className="section-intro"><div><span className="eyebrow">{t('recoverableContext')}</span><h2>{t('stashLibrary')}</h2><p>{t('stashLibraryDescription')}</p></div><div className="stash-total"><span>{stashes.length}</span><small>{t('saved')}</small></div></div>
    {stashes.length === 0 ? <div className="empty-state stash-empty"><div className="empty-orbit"><Archive size={22} /></div><strong>{t('nextFocus')}</strong><p>{t('stashEmptyDescription')}</p></div> : <div className="stash-list">{stashes.map((stash) => <article className="stash-item" key={stash.id}><div className="stash-icon"><Archive size={17} /></div><div className="stash-copy"><strong>{stash.name}</strong><span>{t('tabsCount', { count: stash.tabs.length })} · {new Date(stash.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span><div className="stash-preview">{stash.tabs.slice(0, 3).map((tab) => <span key={`${stash.id}-${tab.tabId ?? tab.url}`} title={tab.title}><Globe2 size={12} /> {displayHostname(tab.url)}</span>)}</div></div><div className="stash-actions"><button className="small-button" disabled={loading !== null} onClick={() => void restore(stash)}>{loading === stash.id ? <RefreshCw className="spin" size={14} /> : <ArrowUpRight size={14} />} {t('restore')}</button><button className="icon-button subtle" disabled={loading !== null} onClick={() => void remove(stash)} aria-label={`${t('delete')} ${stash.name}`}><Trash2 size={15} /></button></div></article>)}</div>}
  </section>;
}

function SettingsPanel({ settings, hasGroqApiKey, t, onClose, onUpdate, onUpdateProvider, onUpdateGroqKey, onRequestDeepScanAll }: { settings: ZenTabSettings; hasGroqApiKey: boolean; t: Translator; onClose: () => void; onUpdate: (patch: Partial<ZenTabSettings>) => Promise<void>; onUpdateProvider: (provider: ZenTabSettings['aiProvider']) => Promise<void>; onUpdateGroqKey: (apiKey: string) => Promise<void>; onRequestDeepScanAll: (enabled: boolean) => Promise<void> }) {
  const [apiKey, setApiKey] = useState('');
  const [protectedDomains, setProtectedDomains] = useState(settings.protectedDomains.join(', '));
  const safelyUpdate = (patch: Partial<ZenTabSettings>) => { void onUpdate(patch).catch(() => undefined); };
  const safelyUpdateProvider = (provider: ZenTabSettings['aiProvider']) => { void onUpdateProvider(provider).catch(() => undefined); };
  const safelyRequestDeepScan = (enabled: boolean) => { void onRequestDeepScanAll(enabled).catch(() => undefined); };
  return <ModalFrame eyebrow={t('controlRoom')} title={t('settings')} description={t('settingsDescription')} closeLabel={t('close')} onClose={onClose} footer={<button className="primary-button" onClick={onClose}>{t('done')} <Check size={15} /></button>}>
    <div className="settings-section"><div className="settings-heading"><div><label htmlFor="language-select"><strong>{t('language')}</strong></label><span>{t('languageDescription')}</span></div><select id="language-select" className="inline-select" value={settings.language} onChange={(event) => safelyUpdate({ language: event.target.value as ZenTabSettings['language'] })}><option value="en">English</option><option value="zh">中文</option></select></div></div>
    <div className="settings-section"><div className="settings-heading"><div><label htmlFor="theme-select"><strong>{t('theme')}</strong></label><span>{t('themeDescription')}</span></div><select id="theme-select" className="inline-select" value={settings.theme} onChange={(event) => safelyUpdate({ theme: event.target.value as ZenTabSettings['theme'] })}><option value="system">{t('systemTheme')}</option><option value="light">{t('lightTheme')}</option><option value="dark">{t('darkTheme')}</option></select></div></div>
    <div className="settings-section"><div className="settings-heading"><div><strong>{t('duplicateGuard')}</strong><span>{t('catchRepeated')}</span></div><Toggle label={t('duplicateGuard')} checked={settings.duplicateEnabled} onChange={(checked) => safelyUpdate({ duplicateEnabled: checked })} /></div><label className="select-field"><span>{t('matchScope')}</span><select value={settings.duplicateScope} onChange={(event) => safelyUpdate({ duplicateScope: event.target.value as ZenTabSettings['duplicateScope'] })}><option value="all-normal-windows">{t('allNormalWindows')}</option><option value="same-window">{t('currentWindowOnly')}</option></select></label></div>
    <div className="settings-section"><div className="settings-heading"><div><strong>{t('deepScanAll')}</strong><span>{t('deepScanDescription')}</span></div><Toggle label={t('deepScanAll')} checked={settings.deepAnalysisEnabled} onChange={safelyRequestDeepScan} /></div><div className="privacy-note"><LockKeyhole size={14} /><span>{t('deepScanPrivacy')}</span></div></div>
    <div className="settings-section"><div className="settings-heading"><div><strong>{t('aiProvider')}</strong><span>{t('localAutomatic')}</span></div><select className="inline-select" value={settings.aiProvider} onChange={(event) => safelyUpdateProvider(event.target.value as ZenTabSettings['aiProvider'])}><option value="local">{t('localAutomatic')}</option><option value="groq">{t('groqByok')}</option></select></div>{settings.aiProvider === 'groq' && <><label className="field-label" htmlFor="groq-api-key">{t('groqApiKey')}<input id="groq-api-key" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} onBlur={() => { if (apiKey.trim()) void onUpdateGroqKey(apiKey.trim()); }} placeholder={hasGroqApiKey ? t('savedLocally') : 'gsk_…'} /></label>{hasGroqApiKey && <button className="text-button key-clear" type="button" onClick={() => { setApiKey(''); void onUpdateGroqKey(''); }}>{t('clearApiKey')}</button>}<div className="privacy-note"><LockKeyhole size={14} /><span>{t('groqPrivacy')}</span></div></>}</div>
    <div className="settings-section"><div className="settings-heading"><div><label htmlFor="protected-domains"><strong>{t('protectedDomains')}</strong></label><span>{t('protectedDomainsDescription')}</span></div><Tag size={16} className="section-icon" /></div><input id="protected-domains" className="full-input" value={protectedDomains} onChange={(event) => setProtectedDomains(event.target.value)} onBlur={() => safelyUpdate({ protectedDomains: protectedDomains.split(',').map((domain) => domain.trim().toLowerCase()).filter(Boolean) })} placeholder={t('protectedDomainsPlaceholder')} /></div>
    <div className="settings-footnote"><Info size={14} /> {t('settingsFootnote')}</div>
  </ModalFrame>;
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <button type="button" role="switch" aria-label={label} aria-checked={checked} className={checked ? 'toggle on' : 'toggle'} onClick={() => onChange(!checked)}><span /></button>;
}

function Toast({ toast, t, onDismiss, onUndo }: { toast: NonNullable<ReturnType<typeof useZenTabStore.getState>['toast']>; t: Translator; onDismiss: () => void; onUndo: () => void }) {
  useEffect(() => { const timer = window.setTimeout(onDismiss, TOAST_DURATION_MS); return () => window.clearTimeout(timer); }, [onDismiss]);
  const toastStyle = { '--toast-duration': `${TOAST_DURATION_MS}ms` } as React.CSSProperties;
  return <div className={`toast ${toast.tone}`} role="status" style={toastStyle}><span className="toast-indicator" /> <span>{toast.message}</span>{toast.action === 'undo' && <button className="toast-action" type="button" onClick={onUndo} title={`${t('undo')} (⌘Z / Ctrl+Z)`} aria-label={t('undo')} aria-keyshortcuts="Meta+Z Control+Z"><Undo2 size={15} aria-hidden="true" /></button>}<button className="toast-close" type="button" onClick={onDismiss} aria-label={t('dismiss')}><X size={13} /></button></div>;
}

export { App };
