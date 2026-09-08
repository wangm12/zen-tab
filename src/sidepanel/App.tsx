import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive, ChevronDown, Layers3, ListFilter, PanelLeft, Search, Settings2, Sparkles, X, Zap,
} from 'lucide-react';
import { applyProjectMemory, createAIProvider } from '../shared/ai';
import { hostPermissionForBaseUrl, normalizeOpenAiBaseUrl } from '../shared/openai';
import { downloadTextFile, exportWindowAsJson } from '../shared/portable';
import { CleanupProposal, GroupProposal, StashRecord, ToastMessage, ZenTabSettings } from '../shared/types';
import { AudioBar } from './AudioBar';
import { CleanupModal } from './CleanupModal';
import { CommandPalette } from './CommandPalette';
import { GroupModal } from './GroupModal';
import { createTranslator } from './i18n';
import { SettingsPanel } from './SettingsPanel';
import { StashList } from './StashList';
import { useZenTabStore } from './store';
import { TabTree } from './TabTree';
import { Toast } from './ui';

type StashSelection = { scope: 'window' | 'group' | 'tabs'; groupId?: number; tabIds?: number[]; includePinned: boolean; includeActive: boolean; busyLabel: string };

function App() {
  const {
    snapshot, selectedWindowId, section, search, modal, groupProposal, cleanupProposal, groupScanProgress, busy, restoreProgress, toast, error,
    load, request, setSection, setSearch, setModal, setGroupProposal, setCleanupProposal, setBusy, showToast, updateSettings,
  } = useZenTabStore();
  const [draftGroupProposal, setDraftGroupProposal] = useState<GroupProposal | null>(null);
  const [draftCleanupProposal, setDraftCleanupProposal] = useState<CleanupProposal | null>(null);
  const [stashMenuOpen, setStashMenuOpen] = useState(false);
  const [stashDropActive, setStashDropActive] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
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
      const rawProposal = prepared.proposal ?? await provider.proposeProjects(prepared.inputs);
      const proposal = applyProjectMemory(prepared.inputs, rawProposal, currentWindow.incognito ? [] : snapshot?.projectMemory ?? []);
      setGroupProposal({ ...proposal, sourceWindowId: currentWindow.windowId, analyzedTabIds: prepared.inputs.map((input) => input.tabId) });
      setModal('group');
      showToast({ id: `${Date.now()}`, tone: 'neutral', message: prepared.deepAnalysisUsed ? t('projectContextEnriched') : t('projectContextMetadata') });
    } catch (analysisError) {
      showToast({ id: `${Date.now()}`, tone: 'error', message: analysisError instanceof Error ? analysisError.message : t('couldNotAnalyzeWindow') });
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

  if (!snapshot) return <main className="loading-state"><img className="brand-mark large" src="/icons/zen-tab-48.png" alt="" /><div><strong>{t('openingZenTab')}</strong><p>{error ?? t('connectingToTabs')}</p></div></main>;

  return (
    <main className="app-shell">
      <nav className="section-switcher" aria-label={t('zenTabSections')}>
        <button className={section === 'tabs' ? 'section-tab active' : 'section-tab'} onClick={() => setSection('tabs')}><Layers3 size={15} /> {t('liveTabs')} <span className="count-pill">{tabCount}</span></button>
        <button className={`${section === 'stashes' ? 'section-tab active' : 'section-tab'}${stashDropActive ? ' drop-target' : ''}`} onClick={() => setSection('stashes')} onDragOver={(event) => { if (!event.dataTransfer.types.includes('text/tab-id')) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setStashDropActive(true); }} onDragLeave={() => setStashDropActive(false)} onDrop={(event) => { event.preventDefault(); const tabId = Number(event.dataTransfer.getData('text/tab-id')); setStashDropActive(false); if (Number.isFinite(tabId)) void stashSelection({ scope: 'tabs', tabIds: [tabId], includePinned: true, includeActive: true, busyLabel: t('stashingTab') }); }} aria-label={t('stashLibrary')}><Archive size={15} /> {stashDropActive ? t('dropToStash') : t('stash')} <span className="count-pill">{snapshot.stashes.length}</span></button>
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

          <AudioBar tabs={audibleTabs} t={t} onActivate={(tab) => void action({ type: 'UPDATE_TAB', tabId: tab.tabId, windowId: tab.windowId, action: 'activate' })} onMuteAll={() => { audibleTabs.filter((tab) => !tab.muted).forEach((tab) => void action({ type: 'UPDATE_TAB', tabId: tab.tabId, action: 'mute' })); }} />

          <div className="command-row">
            <label className="search-box">
              <Search size={16} />
              <input ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('findTabOrProject')} aria-label={t('findTabOrProject')} />
              {search && <button className="search-clear" onClick={() => setSearch('')} aria-label={t('close')}><X size={13} /></button>}
            </label>
            <div className="command-actions" aria-label={t('tabActions')}>
              <button className="command-button accent" onClick={() => void runGroupAnalysis()} disabled={Boolean(busy)}><Sparkles size={15} /> {t('groupTabs')}</button>
              <button className="command-button" onClick={() => void runCleanupAnalysis()} disabled={Boolean(busy)}><ListFilter size={15} /> {t('cleanUp')}</button>
              <div className="stash-action-wrap">
                <button className="command-button" onClick={() => setStashMenuOpen((open) => !open)} disabled={Boolean(busy)} aria-expanded={stashMenuOpen} aria-haspopup="menu"><Archive size={15} /> {t('stash')} <ChevronDown size={13} /></button>
                {stashMenuOpen && <div className="stash-popover" role="menu" aria-label={t('stash')}>
                  <button className="stash-menu-item" role="menuitem" onClick={() => void stashSelection({ scope: 'window', includePinned: false, includeActive: false, busyLabel: t('stashingWindow') })}>
                    <span className="stash-menu-icon" aria-hidden="true"><PanelLeft size={15} /></span>
                    <span className="stash-menu-copy"><strong>{t('stashWindow')}</strong><small>{t('keepPinnedActive')}</small></span>
                  </button>
                  <button className="stash-menu-item" role="menuitem" onClick={() => void stashSelection({ scope: 'window', includePinned: true, includeActive: true, busyLabel: t('stashingAllTabs') })}>
                    <span className="stash-menu-icon" aria-hidden="true"><Layers3 size={15} /></span>
                    <span className="stash-menu-copy"><strong>{t('stashAllTabs')}</strong><small>{t('includePinnedActive')}</small></span>
                  </button>
                  <button className="stash-menu-item" role="menuitem" onClick={() => { setStashMenuOpen(false); exportCurrentWindow(); }}>
                    <span className="stash-menu-icon" aria-hidden="true"><Archive size={15} /></span>
                    <span className="stash-menu-copy"><strong>{t('exportWindow')}</strong><small>JSON</small></span>
                  </button>
                </div>}
              </div>
            </div>
          </div>

          {busy && <div className="busy-bar" role="status"><span className="busy-spinner" /><span className="busy-copy">{busy}</span>{groupScanProgress && <span className="busy-progress">{groupScanProgress.scanned}/{groupScanProgress.total}</span>}<span className="busy-tail">{t('workingQuietly')}</span></div>}

          <TabTree
            windowSnapshot={currentWindow}
            search={search}
            t={t}
            onToggleGroup={(groupId, collapsed) => { void action({ type: 'UPDATE_GROUP', groupId, action: 'collapse', collapsed }); }}
            onStashGroup={(groupId) => { void stashSelection({ scope: 'group', groupId, includePinned: false, includeActive: true, busyLabel: t('stashingGroup') }); }}
            onStashUngrouped={() => {
              if (!currentWindow) return;
              void stashSelection({ scope: 'tabs', tabIds: currentWindow.tabs.filter((tab) => tab.groupId === -1).map((tab) => tab.tabId), includePinned: false, includeActive: true, busyLabel: t('stashingUngrouped') });
            }}
            onStashTabs={(tabIds) => void stashSelection({ scope: 'tabs', tabIds, includePinned: true, includeActive: true, busyLabel: t('stashingSelectedTabs') })}
            onCloseTabs={closeSelectedTabs}
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
        </>
      ) : (
        <StashList stashes={snapshot.stashes} search={search} onSearch={setSearch} request={request} showToast={showToast} t={t} restoreProgress={restoreProgress} />
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
      <CommandPalette open={paletteOpen} windows={snapshot.windows} t={t} onClose={() => setPaletteOpen(false)} onRun={(commandId, tab, windowId) => {
        if (commandId === 'group') void runGroupAnalysis();
        if (commandId === 'cleanup') void runCleanupAnalysis();
        if (commandId === 'stash-window') void stashSelection({ scope: 'window', includePinned: false, includeActive: false, busyLabel: t('stashingWindow') });
        if (commandId === 'stash-all') void stashSelection({ scope: 'window', includePinned: true, includeActive: true, busyLabel: t('stashingAllTabs') });
        if (commandId === 'stash-library') setSection('stashes');
        if (commandId === 'export-window') exportCurrentWindow();
        if (commandId === 'settings') setModal('settings');
        if (commandId === 'search') { setSection('tabs'); window.setTimeout(() => searchRef.current?.focus(), 0); }
        if (commandId === 'undo') void undo();
        if (commandId === 'jump-tab' && tab) void action({ type: 'UPDATE_TAB', tabId: tab.tabId, windowId: tab.windowId, action: 'activate' });
        if (commandId === 'switch-window' && windowId != null) {
          useZenTabStore.setState({ selectedWindowId: windowId });
          void chrome.windows.update(windowId, { focused: true }).catch(() => undefined);
        }
      }} />
      {modal === 'group' && draftGroupProposal && <GroupModal proposal={draftGroupProposal} tabs={proposalTabs} t={t} onChange={setDraftGroupProposal} onClose={() => setModal(null)} onApply={async (selectedIndexes) => { const selectedGroups = draftGroupProposal.groups.filter((group, index) => selectedIndexes.includes(index) && group.tabIds.length >= 2); if (!selectedGroups.length) { showToast({ id: `${Date.now()}`, tone: 'warning', message: t('noValidGroups') }); return; } if (selectedGroups.some((group) => !group.name.trim() || group.name.trim().length > 42)) { showToast({ id: `${Date.now()}`, tone: 'warning', message: t('invalidGroupName') }); return; } if (await action({ type: 'APPLY_GROUP_PROPOSAL', proposal: { ...draftGroupProposal, groups: selectedGroups } }, t('groupsCreated', { count: selectedGroups.length }), 'undo')) setModal(null); }} />}
      {modal === 'cleanup' && draftCleanupProposal && <CleanupModal proposal={draftCleanupProposal} t={t} onClose={() => setModal(null)} onApply={(tabIds) => applyCleanup(draftCleanupProposal, tabIds)} />}
      {modal === 'settings' && <SettingsPanel settings={snapshot.settings} hasCloudApiKey={snapshot.hasCloudApiKey} t={t} onClose={() => setModal(null)} onUpdate={updateSettingsSafe} onUpdateProvider={updateAIProvider} onUpdateCloudKey={async (apiKey) => { try { await request({ type: 'UPDATE_CLOUD_KEY', apiKey }); await load(); showToast({ id: `${Date.now()}`, tone: 'success', message: t('apiKeySaved') }); } catch (keyError) { showToast({ id: `${Date.now()}`, tone: 'error', message: keyError instanceof Error ? keyError.message : t('couldNotSaveApiKey') }); } }} onRequestDeepScanAll={requestDeepScanAll} onRequestDiscardInspect={requestPageAccessSetting} onClearProjectMemory={clearProjectMemory} />}
    </main>
  );
}

export { App };
