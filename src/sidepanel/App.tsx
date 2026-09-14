import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive, Bookmark, Download, Inbox, Layers3, ListFilter, MoreHorizontal, PanelLeft, Search, Settings2, Sparkles, X,
} from 'lucide-react';
import { applyProjectMemory, createAIProvider } from '../shared/ai';
import { BOOKMARK_WORKSPACE_PERMISSIONS, readFaviconGranted } from '../shared/bookmark-favicon';
import { hostPermissionForBaseUrl, normalizeOpenAiBaseUrl } from '../shared/openai';
import { downloadTextFile, exportWindowAsJson } from '../shared/portable';
import { BookmarkRecord, CleanupProposal, GroupProposal, StashRecord, TabRecord, ToastMessage, ZenTabSettings } from '../shared/types';
import { AtmosphereCanvas } from './AtmosphereCanvas';
import { AudioBar } from './AudioBar';
import { BookmarkChrome, BookmarkList } from './BookmarkList';
import { CleanupModal } from './CleanupModal';
import { CommandPalette } from './CommandPalette';
import { GroupModal } from './GroupModal';
import { createTranslator } from './i18n';
import { buildPaletteEntries } from './palette';
import { SettingsPanel } from './SettingsPanel';
import { StashList } from './StashList';
import { shouldFetchPaletteBookmarks } from './local-snapshot';
import { showsUnifiedSearch, useZenTabStore } from './store';
import { TabTree } from './TabTree';
import { Toast } from './ui';
import { UnifiedSearch } from './UnifiedSearch';
import { DroppableSurface } from './dnd-surfaces';
import { fileDroppedTab } from './file-dropped-tab';
import { parseTabDragId, readTabPlacement, resolveTabDragEnd } from '../shared/tab-dnd';

type StashSelection = { scope: 'window' | 'group' | 'tabs'; groupId?: number; tabIds?: number[]; includePinned: boolean; includeActive: boolean; busyLabel: string };

function App() {
  const {
    snapshot, selectedWindowId, section, search, modal, groupProposal, cleanupProposal, groupScanProgress, bookmarkEpoch, bookmarkFilingSuggestion, busy, restoreProgress, toast, error,
    load, request, setSection, setSearch, setModal, setGroupProposal, setCleanupProposal, setBusy, showToast, updateSettings,
  } = useZenTabStore();
  const [draftGroupProposal, setDraftGroupProposal] = useState<GroupProposal | null>(null);
  const [draftCleanupProposal, setDraftCleanupProposal] = useState<CleanupProposal | null>(null);
  const [organizeMenuOpen, setOrganizeMenuOpen] = useState(false);
  const [bookmarkChrome, setBookmarkChrome] = useState<BookmarkChrome | null>(null);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteBookmarks, setPaletteBookmarks] = useState<BookmarkRecord[]>([]);
  const [faviconGranted, setFaviconGranted] = useState(false);
  const [unifiedActiveIndex, setUnifiedActiveIndex] = useState(0);
  const [focusStashId, setFocusStashId] = useState<string | undefined>();
  const searchRef = useRef<HTMLInputElement>(null);
  const undoInFlight = useRef(false);
  const language = snapshot?.settings.language ?? 'en';
  const t = useMemo(() => createTranslator(language), [language]);
  const unifiedEntries = useMemo(
    () => snapshot ? buildPaletteEntries(snapshot.windows, search, t, paletteBookmarks, snapshot.stashes, faviconGranted) : [],
    [faviconGranted, paletteBookmarks, search, snapshot, t],
  );

  useEffect(() => {
    let cancelled = false;
    const checkFavicon = async () => {
      if (typeof chrome === 'undefined' || !chrome.permissions?.contains) return;
      const granted = await readFaviconGranted((details) => chrome.permissions.contains(details));
      if (!cancelled) setFaviconGranted(granted);
    };
    void checkFavicon();
    if (typeof chrome !== 'undefined' && chrome.permissions?.onAdded) {
      chrome.permissions.onAdded.addListener(checkFavicon);
      chrome.permissions.onRemoved?.addListener(checkFavicon);
    }
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => setDraftGroupProposal(groupProposal), [groupProposal]);
  useEffect(() => setDraftCleanupProposal(cleanupProposal), [cleanupProposal]);
  useEffect(() => { setUnifiedActiveIndex(0); }, [search]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!shouldFetchPaletteBookmarks(section, search, paletteOpen)) return;
      if (!(await chrome.permissions.contains({ permissions: ['bookmarks'] }))) {
        setPaletteBookmarks([]);
        return;
      }
      const [data, stored] = await Promise.all([
        request<{ granted: boolean; bookmarks: BookmarkRecord[] }>({ type: 'GET_BOOKMARK_TREE' }),
        chrome.storage.local.get('zen-tab.bookmark-summaries'),
      ]);
      if (cancelled) return;
      if (!data.granted) {
        setPaletteBookmarks([]);
        return;
      }
      const summaries = (stored['zen-tab.bookmark-summaries'] ?? {}) as Record<string, string>;
      setPaletteBookmarks(data.bookmarks.map((bookmark) => summaries[bookmark.id]
        ? { ...bookmark, summary: summaries[bookmark.id] }
        : bookmark));
    })().catch(() => undefined);
    return () => { cancelled = true; };
  }, [bookmarkEpoch, paletteOpen, request, search, section]);
  useEffect(() => {
    if (!organizeMenuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOrganizeMenuOpen(false); };
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest('.organize-menu-wrap')) setOrganizeMenuOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
    };
  }, [organizeMenuOpen]);
  useEffect(() => { setOrganizeMenuOpen(false); }, [section]);

  const currentWindow = snapshot?.windows.find((window) => window.windowId === selectedWindowId) ?? snapshot?.windows[0];
  const currentWindowRef = useRef(currentWindow);
  currentWindowRef.current = currentWindow;
  const proposalTabs = draftGroupProposal ? snapshot?.windows.find((window) => window.windowId === draftGroupProposal.sourceWindowId)?.tabs ?? [] : [];
  const tabCount = snapshot?.windows.reduce((sum, window) => sum + window.tabs.length, 0) ?? 0;
  const audibleTabs = currentWindow?.tabs.filter((tab) => tab.audible) ?? [];

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

  const updateAIProvider = useCallback(async (provider: ZenTabSettings['aiProvider'], baseUrl?: string) => {
    try {
      if (provider === 'openai-compatible') {
        const origin = hostPermissionForBaseUrl(baseUrl || snapshot?.settings.openaiBaseUrl || '');
        const granted = origin ? await chrome.permissions.request({ origins: [origin] }) : false;
        if (!granted) {
          showToast({ id: `${Date.now()}`, tone: 'warning', message: t('openaiPermissionDenied') });
          return;
        }
        await updateSettingsSafe({ aiProvider: provider, ...(baseUrl ? { openaiBaseUrl: normalizeOpenAiBaseUrl(baseUrl) } : {}) });
        return;
      }
      await updateSettingsSafe({ aiProvider: provider });
    } catch (providerError) {
      showToast({ id: `${Date.now()}`, tone: 'error', message: providerError instanceof Error ? providerError.message : t('couldNotSaveSettings') });
      throw providerError;
    }
  }, [showToast, snapshot?.settings.openaiBaseUrl, t, updateSettingsSafe]);

  const runGroupAnalysis = useCallback(async (tabIds?: number[]) => {
    if (!currentWindow) return false;
    const deepScanAll = Boolean(snapshot?.settings.deepAnalysisEnabled);
    useZenTabStore.setState({ groupScanProgress: null });
    setBusy(deepScanAll ? t('scanningAllPageContext') : t('enrichingUncertainTabs'));
    try {
      const prepared = await request<{ inputs: Array<{ tabId: number; title: string; url: string; canonicalUrl: string | null; summary?: string }>; deepAnalysisUsed: boolean; proposal?: GroupProposal }>({
        type: 'RUN_GROUP_ANALYSIS',
        windowId: currentWindow.windowId,
        deepScanAll,
        ...(tabIds?.length ? { tabIds } : {}),
      });
      const provider = createAIProvider(snapshot?.settings ?? ({} as ZenTabSettings));
      const rawProposal = prepared.proposal ?? await provider.proposeProjects(prepared.inputs);
      const proposal = applyProjectMemory(prepared.inputs, rawProposal, currentWindow.incognito ? [] : snapshot?.projectMemory ?? []);
      setGroupProposal({ ...proposal, sourceWindowId: currentWindow.windowId, analyzedTabIds: prepared.inputs.map((input) => input.tabId) });
      setModal('group');
      showToast({ id: `${Date.now()}`, tone: 'neutral', message: prepared.deepAnalysisUsed ? t('projectContextEnriched') : t('projectContextMetadata') });
      return true;
    } catch (analysisError) {
      showToast({ id: `${Date.now()}`, tone: 'error', message: analysisError instanceof Error ? analysisError.message : t('couldNotAnalyzeWindow') });
      return false;
    } finally {
      setBusy(null);
      useZenTabStore.setState({ groupScanProgress: null });
    }
  }, [currentWindow, request, setBusy, setGroupProposal, setModal, showToast, snapshot?.projectMemory, snapshot?.settings, t]);

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
    if (!currentWindow) return false;
    setOrganizeMenuOpen(false);
    setBusy(selection.busyLabel);
    try {
      const stash = await request<StashRecord>({ type: 'STASH', windowId: currentWindow.windowId, scope: selection.scope, groupId: selection.groupId, tabIds: selection.tabIds, includePinned: selection.includePinned, includeActive: selection.includeActive });
      showToast({ id: `${Date.now()}`, tone: 'success', message: t('tabsStashed', { count: stash.tabs.length }), action: 'undo' });
      return true;
    } catch (stashError) {
      showToast({ id: `${Date.now()}`, tone: 'error', message: stashError instanceof Error ? stashError.message : t('couldNotStashTabs') });
      return false;
    } finally {
      setBusy(null);
    }
  }, [currentWindow, request, setBusy, showToast, t]);

  const commitTabDrag = useCallback(async (event: { canceled: boolean; operation: { source?: { id: string | number } | null; target?: { id: string | number } | null } }) => {
    if (event.canceled) return;
    const liveSnapshot = snapshotRef.current;
    const liveWindow = currentWindowRef.current;
    if (!liveSnapshot || !liveWindow) return;
    const source = parseTabDragId(String(event.operation.source?.id ?? ''));
    if (source?.kind === 'group') {
      const over = parseTabDragId(String(event.operation.target?.id ?? ''));
      if (!over) return;
      if (over.kind === 'ungrouped' || over.kind === 'sticky-ungrouped') {
        void action({ type: 'UNGROUP_GROUP', groupId: source.groupId });
        return;
      }
      if (over.kind === 'tab') {
        const targetTab = liveWindow.tabs.find((tab) => tab.tabId === over.tabId);
        if (targetTab && targetTab.groupId === -1) {
          void action({ type: 'UNGROUP_GROUP', groupId: source.groupId });
          return;
        }
      }
      if (over.kind === 'list-end') {
        const lastTab = liveWindow.tabs[liveWindow.tabs.length - 1];
        if (lastTab && lastTab.groupId === -1) {
          void action({ type: 'UNGROUP_GROUP', groupId: source.groupId });
          return;
        }
      }
      if (over.kind === 'stash') {
        void stashSelection({ scope: 'group', groupId: source.groupId, includePinned: false, includeActive: true, busyLabel: t('stashingGroup') });
        return;
      }
      return;
    }
    if (source?.kind !== 'tab') return;
    const dragged = liveWindow.tabs.find((tab) => tab.tabId === source.tabId);
    if (!dragged) return;
    const over = parseTabDragId(String(event.operation.target?.id ?? ''));
    const result = resolveTabDragEnd({
      dragged,
      over,
      placement: over?.kind === 'tab' ? readTabPlacement() : undefined,
      windowId: liveWindow.windowId,
      tabs: liveWindow.tabs,
    });
    if (result.type === 'none') return;
    if (result.type === 'move') {
      void action({ type: 'MOVE_TAB', tabId: result.tabId, windowId: result.windowId, index: result.index });
      return;
    }
    if (result.type === 'group') {
      void action({ type: 'GROUP_TAB', tabId: result.tabId, groupId: result.groupId });
      return;
    }
    if (result.type === 'ungroup') {
      void action({ type: 'GROUP_TAB', tabId: result.tabId, groupId: -1 });
      return;
    }
    if (result.type === 'ungroup-and-move') {
      await action({ type: 'GROUP_TAB', tabId: result.tabId, groupId: -1 });
      void action({ type: 'MOVE_TAB', tabId: result.tabId, windowId: result.windowId, index: result.index });
      return;
    }
    if (result.type === 'stash') {
      void stashSelection({ scope: 'tabs', tabIds: [result.tabId], includePinned: true, includeActive: true, busyLabel: t('stashingTab') });
      return;
    }
    void fileDroppedTab(result.tabId, result.folderId, {
      openTabs: liveSnapshot.windows.flatMap((window) => window.tabs),
      request,
      showToast,
      t,
    });
  }, [action, request, showToast, stashSelection, t]);

  const groupSelectedTabs = async (tabIds: number[]) => {
    if (!currentWindow) return false;
    try {
      const result = await request<{ tabIds: number[] }>({ type: 'GROUP_TABS', windowId: currentWindow.windowId, tabIds });
      showToast({ id: `${Date.now()}`, tone: 'success', message: t('groupedTabs', { count: result.tabIds.length }), action: 'undo' });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : t('couldNotGroupTabs');
      showToast({ id: `${Date.now()}`, tone: 'error', message: message.includes('at least two') ? t('needTwoTabsToGroup') : t('couldNotGroupTabs') });
      return false;
    }
  };

  const fileSelectedTabs = async (tabIds: number[]) => {
    try {
      const granted = await chrome.permissions.request(BOOKMARK_WORKSPACE_PERMISSIONS);
      if (!granted) {
        showToast({ id: `${Date.now()}`, tone: 'warning', message: t('permissionDenied') });
        return false;
      }
    } catch {
      showToast({ id: `${Date.now()}`, tone: 'warning', message: t('permissionDenied') });
      return false;
    }
    const tabs = snapshot?.windows.flatMap((w) => w.tabs).filter((tab) => tabIds.includes(tab.tabId) && tab.url) ?? [];
    if (!tabs.length) return false;
    try {
      const result = await request<{ created: number }>({ type: 'CREATE_BOOKMARKS', tabs: tabs.map((tab) => ({ title: tab.title, url: tab.url })) });
      showToast({ id: `${Date.now()}`, tone: result.created > 0 ? 'success' : 'neutral', message: t('bookmarksCreated', { count: result.created }), ...(result.created > 0 ? { action: 'undo' as const } : {}) });
      return true;
    } catch (error) {
      showToast({ id: `${Date.now()}`, tone: 'error', message: error instanceof Error ? error.message : t('actionFailed') });
      return false;
    }
  };

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
      const result = await request<{ closed: number; skipped: number }>({ type: 'APPLY_CLEANUP', proposal, tabIds });
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
    } catch (undoError) {
      showToast({ id: `${Date.now()}`, tone: 'error', message: undoError instanceof Error ? undoError.message : t('actionFailed') });
    } finally {
      undoInFlight.current = false;
    }
  }, [request, showToast, t]);

  const exportCurrentWindow = useCallback(() => {
    if (!currentWindow) return;
    const index = (snapshot?.windows.findIndex((window) => window.windowId === currentWindow.windowId) ?? 0) + 1;
    downloadTextFile(`zen-tab-window-${index}.json`, exportWindowAsJson(currentWindow, { now: Date.now(), name: t('windowExportName', { index }) }));
  }, [currentWindow, snapshot?.windows, t]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target;
      const inField = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable);
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.key.toLowerCase() !== 'z' || inField) return;
      if (!snapshot?.lastAction || snapshot.lastAction.expiresAt <= Date.now()) return;
      event.preventDefault();
      void undo();
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [snapshot?.lastAction, undo]);

  const dismissToast = useCallback(() => { useZenTabStore.setState({ toast: null }); }, []);

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

  const requestPageAccessSetting = useCallback(async (enabled: boolean) => {
    try {
      if (!enabled) {
        await updateSettingsSafe({ autoDiscardInspectPages: false });
        return;
      }
      const granted = await chrome.permissions.request({ permissions: ['scripting'], origins: ['<all_urls>'] });
      await updateSettingsSafe({ autoDiscardInspectPages: granted });
      showToast({ id: `${Date.now()}`, tone: granted ? 'success' : 'warning', message: granted ? t('autoDiscardInspect') : t('permissionDenied') });
    } catch {
      showToast({ id: `${Date.now()}`, tone: 'warning', message: t('permissionDenied') });
    }
  }, [showToast, t, updateSettingsSafe]);

  const openBookmarks = useCallback(async () => {
    try {
      await chrome.permissions.request(BOOKMARK_WORKSPACE_PERMISSIONS);
    } catch {
      // The Bookmarks view keeps its explicit Grant button as a fallback.
    }
    setSection('bookmarks');
  }, [setSection]);

  const runPaletteItem = useCallback((commandId: string, tab?: TabRecord, windowId?: number, url?: string, stashId?: string) => {
    if (commandId === 'group') void runGroupAnalysis();
    if (commandId === 'cleanup') void runCleanupAnalysis();
    if (commandId === 'stash-window') void stashSelection({ scope: 'window', includePinned: false, includeActive: false, busyLabel: t('stashingWindow') });
    if (commandId === 'stash-all') void stashSelection({ scope: 'window', includePinned: true, includeActive: true, busyLabel: t('stashingAllTabs') });
    if (commandId === 'stash-library') setSection('stashes');
    if (commandId === 'bookmarks') void openBookmarks();
    if (commandId === 'export-window') exportCurrentWindow();
    if (commandId === 'settings') setModal('settings');
    if (commandId === 'search') { setSection('tabs'); window.setTimeout(() => searchRef.current?.focus(), 0); }
    if (commandId === 'undo') void undo();
    if (commandId === 'jump-tab' && tab) {
      useZenTabStore.setState({ selectedWindowId: tab.windowId });
      void action({ type: 'UPDATE_TAB', tabId: tab.tabId, windowId: tab.windowId, action: 'activate' });
    }
    if (commandId === 'jump-bookmark' && url) void chrome.tabs.create({ url });
    if (commandId === 'jump-stash') {
      setFocusStashId(stashId);
      setSection('stashes', { keepSearch: true });
    }
    if (commandId === 'switch-window' && windowId != null) {
      useZenTabStore.setState({ selectedWindowId: windowId });
      void chrome.windows.update(windowId, { focused: true }).catch(() => undefined);
    }
    if (commandId !== 'jump-stash') setSearch('');
  }, [action, exportCurrentWindow, openBookmarks, runCleanupAnalysis, runGroupAnalysis, setModal, setSearch, setSection, stashSelection, t, undo]);

  const clearProjectMemory = useCallback(async () => {
    if (!window.confirm(t('clearProjectMemoryConfirm'))) return;
    try {
      await request({ type: 'CLEAR_PROJECT_MEMORY' });
      await load();
      showToast({ id: `${Date.now()}`, tone: 'success', message: t('projectMemoryCleared') });
    } catch (memoryError) {
      showToast({ id: `${Date.now()}`, tone: 'error', message: memoryError instanceof Error ? memoryError.message : t('actionFailed') });
    }
  }, [load, request, showToast, t]);

  const atmosphereEnabled = snapshot?.settings.atmosphereEnabled ?? true;

  if (!snapshot) return (
    <main className="app-shell">
      <AtmosphereCanvas enabled={atmosphereEnabled} />
      <div className="empty-state"><p>{error ?? t('connectingToTabs')}</p></div>
    </main>
  );

  return (
    <main className="app-shell">
      <AtmosphereCanvas enabled={atmosphereEnabled} />
      <header className="top-bar">
        <label className="search-box top-search">
          <Search size={16} />
          <input
            ref={searchRef}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (paletteOpen) return;
              if (event.key === 'Escape') { event.preventDefault(); setSearch(''); return; }
              if (!search.trim()) return;
              if (event.key === 'ArrowDown') { event.preventDefault(); setUnifiedActiveIndex((index) => Math.min(Math.max(unifiedEntries.length - 1, 0), index + 1)); }
              if (event.key === 'ArrowUp') { event.preventDefault(); setUnifiedActiveIndex((index) => Math.max(0, index - 1)); }
              if (event.key === 'Enter') {
                event.preventDefault();
                const item = unifiedEntries[unifiedActiveIndex];
                if (item) runPaletteItem(item.commandId, item.tab, item.windowId, item.url, item.stashId);
              }
            }}
            placeholder={t('findTabOrProject')}
            aria-label={t('findTabOrProject')}
          />
          {search && <button className="search-clear" onClick={() => setSearch('')} aria-label={t('close')}><X size={13} /></button>}
        </label>
        {section === 'bookmarks' ? (
          <button className="command-button compact accent" onClick={() => bookmarkChrome?.openOrganize()} disabled={!bookmarkChrome || Boolean(busy)} aria-label={t('bookmarkOrganize')} title={t('bookmarkOrganize')}><ListFilter size={15} /> <span className="top-action-label">{t('bookmarkOrganize')}</span></button>
        ) : (
          <button className="command-button compact accent" onClick={() => void runGroupAnalysis()} disabled={Boolean(busy)} aria-label={t('groupTabs')} title={t('groupTabs')}><Sparkles size={15} /> <span className="top-action-label">{t('groupTabs')}</span></button>
        )}
        <div className="organize-menu-wrap">
          <button className="icon-button" onClick={() => setOrganizeMenuOpen((open) => !open)} disabled={Boolean(busy) || (section === 'bookmarks' && !bookmarkChrome)} aria-expanded={organizeMenuOpen} aria-haspopup="menu" aria-label={t('moreActions')} title={t('moreActions')}><MoreHorizontal size={17} /></button>
          {organizeMenuOpen && <div className="stash-popover organize-popover" role="menu" aria-label={t('moreActions')}>
            {section === 'bookmarks' ? <>
              <button className="stash-menu-item" role="menuitem" disabled={!bookmarkChrome || bookmarkChrome.inboxCount === 0} onClick={() => { setOrganizeMenuOpen(false); bookmarkChrome?.openReview(); }}>
                <span className="stash-menu-icon" aria-hidden="true"><Inbox size={15} /></span>
                <span className="stash-menu-copy"><strong>{t('reviewInbox')}</strong><small>{t('unfiledBookmarkCount', { count: bookmarkChrome?.inboxCount ?? 0 })}</small></span>
              </button>
              <button className="stash-menu-item" role="menuitem" disabled={!bookmarkChrome} onClick={() => { setOrganizeMenuOpen(false); bookmarkChrome?.openExport(); }}>
                <span className="stash-menu-icon" aria-hidden="true"><Download size={15} /></span>
                <span className="stash-menu-copy"><strong>{t('exportBookmarks')}</strong><small>Markdown / HTML</small></span>
              </button>
            </> : <>
              <button className="stash-menu-item" role="menuitem" onClick={() => { setOrganizeMenuOpen(false); void runCleanupAnalysis(); }}>
                <span className="stash-menu-icon" aria-hidden="true"><ListFilter size={15} /></span>
                <span className="stash-menu-copy"><strong>{t('cleanUp')}</strong><small>{t('protectedPages')}</small></span>
              </button>
              <button className="stash-menu-item" role="menuitem" onClick={() => void stashSelection({ scope: 'window', includePinned: false, includeActive: false, busyLabel: t('stashingWindow') })}>
                <span className="stash-menu-icon" aria-hidden="true"><PanelLeft size={15} /></span>
                <span className="stash-menu-copy"><strong>{t('stashWindow')}</strong><small>{t('keepPinnedActive')}</small></span>
              </button>
              <button className="stash-menu-item" role="menuitem" onClick={() => void stashSelection({ scope: 'window', includePinned: true, includeActive: true, busyLabel: t('stashingAllTabs') })}>
                <span className="stash-menu-icon" aria-hidden="true"><Layers3 size={15} /></span>
                <span className="stash-menu-copy"><strong>{t('stashAllTabs')}</strong><small>{t('includePinnedActive')}</small></span>
              </button>
              <button className="stash-menu-item" role="menuitem" onClick={() => { setOrganizeMenuOpen(false); exportCurrentWindow(); }}>
                <span className="stash-menu-icon" aria-hidden="true"><Archive size={15} /></span>
                <span className="stash-menu-copy"><strong>{t('exportWindow')}</strong><small>JSON</small></span>
              </button>
            </>}
          </div>}
        </div>
        <button className="icon-button" aria-label={t('openSettings')} onClick={() => setModal(modal === 'settings' ? null : 'settings')} title={t('settings')}><Settings2 size={17} /></button>
      </header>

      <div className="app-content">
        {showsUnifiedSearch(section, search) ? (
          <UnifiedSearch
            windows={snapshot.windows}
            bookmarks={paletteBookmarks}
            stashes={snapshot.stashes}
            query={search}
            faviconGranted={faviconGranted}
            t={t}
            activeIndex={unifiedActiveIndex}
            onActiveIndexChange={setUnifiedActiveIndex}
            onRun={(item) => runPaletteItem(item.commandId, item.tab, item.windowId, item.url, item.stashId)}
          />
        ) : section === 'tabs' && (
          <div className="section-panel">
            {snapshot.windows.length > 1 && <div className="window-tabs" aria-label={t('browserWindows')}>
              {snapshot.windows.map((window, index) => (
                <button key={window.windowId} className={window.windowId === currentWindow?.windowId ? 'window-chip active' : 'window-chip'} onClick={() => useZenTabStore.setState({ selectedWindowId: window.windowId })} aria-label={`${window.incognito ? t('privateWindow') : t('window', { index: index + 1 })}, ${window.tabs.length} tabs`}>
                  <span className={window.incognito ? 'window-dot private' : 'window-dot'} />
                  <span>{window.incognito ? t('privateWindow') : t('window', { index: index + 1 })}</span>
                  <small>{window.tabs.length}</small>
                </button>
              ))}
            </div>}

            <AudioBar tabs={audibleTabs} t={t} onActivate={(tab) => void action({ type: 'UPDATE_TAB', tabId: tab.tabId, windowId: tab.windowId, action: 'activate' })} onMuteAll={() => { audibleTabs.filter((tab) => !tab.muted).forEach((tab) => void action({ type: 'UPDATE_TAB', tabId: tab.tabId, action: 'mute' })); }} />

            {busy && <div className="busy-bar" role="status"><span className="busy-spinner" /><span className="busy-copy">{busy}</span>{groupScanProgress && <span className="busy-progress">{groupScanProgress.scanned}/{groupScanProgress.total}</span>}<span className="busy-tail">{t('workingQuietly')}</span></div>}

            <TabTree
              windowSnapshot={currentWindow}
              search={search}
              t={t}
              onTabDragEnd={(event) => { void commitTabDrag(event); }}
              onToggleGroup={(groupId, collapsed) => { void action({ type: 'UPDATE_GROUP', groupId, action: 'collapse', collapsed }); }}
              onStashGroup={(groupId) => { void stashSelection({ scope: 'group', groupId, includePinned: false, includeActive: true, busyLabel: t('stashingGroup') }); }}
              onStashUngrouped={() => {
                if (!currentWindow) return;
                void stashSelection({ scope: 'tabs', tabIds: currentWindow.tabs.filter((tab) => tab.groupId === -1).map((tab) => tab.tabId), includePinned: false, includeActive: true, busyLabel: t('stashingUngrouped') });
              }}
              onStashTabs={(tabIds) => stashSelection({ scope: 'tabs', tabIds, includePinned: true, includeActive: true, busyLabel: t('stashingSelectedTabs') })}
              onCloseTabs={closeSelectedTabs}
              onGroupTabs={groupSelectedTabs}
              onAnalyzeTabs={(ids) => runGroupAnalysis(ids)}
              onFileTabs={fileSelectedTabs}
              onAnalyzeWindow={() => void runGroupAnalysis()}
              onCleanupWindow={() => void runCleanupAnalysis()}
              onStashWindow={() => void stashSelection({ scope: 'window', includePinned: false, includeActive: false, busyLabel: t('stashingWindow') })}
              onExportWindow={exportCurrentWindow}
              onAction={(message) => {
                if (message.type === 'UPDATE_TAB' && message.action === 'activate' && message.windowId != null) useZenTabStore.setState({ selectedWindowId: message.windowId });
                if (message.type === 'UPDATE_TAB' && message.action === 'close') { void closeSelectedTabs([message.tabId]); return; }
                if (message.type === 'UNGROUP_GROUP' || (message.type === 'UPDATE_GROUP' && message.action !== 'collapse')) {
                  void action(message).then((ok) => { if (ok) showToast({ id: `${Date.now()}`, tone: 'success', message: t('groupUpdated'), action: 'undo' }); });
                  return;
                }
                void action(message);
              }}
            />
          </div>
        )}

        {section === 'stashes' && (
          <div className="section-panel">
            {busy && <div className="busy-bar" role="status"><span className="busy-spinner" /><span className="busy-copy">{busy}</span>{groupScanProgress && <span className="busy-progress">{groupScanProgress.scanned}/{groupScanProgress.total}</span>}<span className="busy-tail">{t('workingQuietly')}</span></div>}
            <StashList stashes={snapshot.stashes} search={search} onSearch={setSearch} request={request} showToast={showToast} t={t} restoreProgress={restoreProgress} hideSearch focusStashId={focusStashId} />
          </div>
        )}

        {!search.trim() && section === 'bookmarks' && (
          <div className="section-panel">
            <BookmarkList
              search={search}
              bookmarkEpoch={bookmarkEpoch}
              filingSuggestion={bookmarkFilingSuggestion}
              openTabs={snapshot.windows.flatMap((window) => window.tabs)}
              settings={snapshot.settings}
              hasCloudApiKey={snapshot.hasCloudApiKey}
              request={request}
              showToast={showToast}
              t={t}
              onBookmarksChange={setPaletteBookmarks}
              onDismissSuggestion={() => useZenTabStore.setState({ bookmarkFilingSuggestion: null })}
              onChromeChange={setBookmarkChrome}
            />
          </div>
        )}
      </div>

      <nav className="bottom-nav" aria-label={t('zenTabSections')}>
        <button className={section === 'tabs' ? 'bottom-nav-item active' : 'bottom-nav-item'} onClick={() => setSection('tabs')}><Layers3 size={15} /> {t('tabs')} <span className="count-pill">{tabCount}</span></button>
        <DroppableSurface surface={{ kind: 'stash' }} as="button" type="button" className={section === 'stashes' ? 'bottom-nav-item active' : 'bottom-nav-item'} onClick={() => setSection('stashes')} aria-label={t('stashLibrary')}>
          {(over) => <><Archive size={15} /> {over ? t('dropToStash') : t('stash')} <span className="count-pill">{snapshot.stashes.length}</span></>}
        </DroppableSurface>
        <DroppableSurface surface={{ kind: 'bookmark-nav' }} as="button" className={section === 'bookmarks' ? 'bottom-nav-item active' : 'bottom-nav-item'} onClick={() => void openBookmarks()}>
          {(over) => <><Bookmark size={15} /> {over ? t('dropToFile') : t('bookmarks')}</>}
        </DroppableSurface>
      </nav>

      {toast && <Toast key={toast.id} toast={toast} t={t} onDismiss={dismissToast} onUndo={() => void undo()} />}
      <CommandPalette open={paletteOpen} windows={snapshot.windows} bookmarks={paletteBookmarks} stashes={snapshot.stashes} faviconGranted={faviconGranted} t={t} onClose={() => setPaletteOpen(false)} onRun={runPaletteItem} />
      {modal === 'group' && draftGroupProposal && <GroupModal proposal={draftGroupProposal} tabs={proposalTabs} t={t} onChange={setDraftGroupProposal} onClose={() => setModal(null)} onApply={async (selectedIndexes) => { const selectedGroups = draftGroupProposal.groups.filter((group, index) => selectedIndexes.includes(index) && group.tabIds.length >= 2); if (!selectedGroups.length) { showToast({ id: `${Date.now()}`, tone: 'warning', message: t('noValidGroups') }); return; } if (selectedGroups.some((group) => !group.name.trim() || group.name.trim().length > 42)) { showToast({ id: `${Date.now()}`, tone: 'warning', message: t('invalidGroupName') }); return; } if (await action({ type: 'APPLY_GROUP_PROPOSAL', proposal: { ...draftGroupProposal, groups: selectedGroups } }, t('groupsCreated', { count: selectedGroups.length }), 'undo')) setModal(null); }} />}
      {modal === 'cleanup' && draftCleanupProposal && <CleanupModal proposal={draftCleanupProposal} t={t} onClose={() => setModal(null)} onApply={(tabIds) => applyCleanup(draftCleanupProposal, tabIds)} />}
      {modal === 'settings' && <SettingsPanel settings={snapshot.settings} hasCloudApiKey={snapshot.hasCloudApiKey} t={t} onClose={() => setModal(null)} onUpdate={updateSettingsSafe} onUpdateProvider={updateAIProvider} onUpdateCloudKey={async (apiKey) => { try { await request({ type: 'UPDATE_CLOUD_KEY', apiKey }); await load(); showToast({ id: `${Date.now()}`, tone: 'success', message: t('apiKeySaved') }); } catch (keyError) { showToast({ id: `${Date.now()}`, tone: 'error', message: keyError instanceof Error ? keyError.message : t('couldNotSaveApiKey') }); } }} onRequestDeepScanAll={requestDeepScanAll} onRequestDiscardInspect={requestPageAccessSetting} onClearProjectMemory={clearProjectMemory} />}
    </main>
  );
}

export { App };
