import { useEffect, useRef, useState } from 'react';
import { Archive, ArrowUpRight, Check, ChevronDown, ChevronRight, Clock, Download, Globe2, Layers3, Pencil, RefreshCw, RotateCcw, Search, Trash2, Upload, X } from 'lucide-react';
import { downloadTextFile, exportStashAsJson, exportStashAsMarkdown, parseImportedStashes } from '../shared/portable';
import { displayHostname } from '../shared/url';
import { RecentSession, StashRecord, ToastMessage } from '../shared/types';
import { Translator } from './i18n';
import { RequestFn } from './ui';
import { useZenTabStore } from './store';

export function StashList({ stashes, search, onSearch, request, showToast, t, restoreProgress, hideSearch, focusStashId }: {
  stashes: StashRecord[];
  search: string;
  onSearch: (value: string) => void;
  request: RequestFn;
  showToast: (toast: ToastMessage) => void;
  t: Translator;
  restoreProgress: { stashId: string; completed: number; total: number } | null;
  hideSearch?: boolean;
  focusStashId?: string;
}) {
  const [loading, setLoading] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [showAllRecent, setShowAllRecent] = useState(false);
  const [recentSessions, setRecentSessions] = useState<RecentSession[]>([]);
  const jsonInputRef = useRef<HTMLInputElement>(null);
  const normalizedSearch = search.trim().toLowerCase();
  const filteredStashes = stashes.filter((stash) => {
    if (!normalizedSearch) return true;
    const searchable = [stash.name, ...stash.tabs.flatMap((tab) => [tab.title, tab.url, displayHostname(tab.url), tab.groupTitle ?? ''])].join(' ').toLowerCase();
    return searchable.includes(normalizedSearch);
  });

  useEffect(() => {
    void request<RecentSession[]>({ type: 'LIST_RECENT_SESSIONS' }).then(setRecentSessions).catch(() => setRecentSessions([]));
  }, [request, stashes.length]);
  useEffect(() => {
    if (focusStashId) setExpandedId(focusStashId);
  }, [focusStashId]);

  const showRestoreError = (error: unknown) => showToast({ id: `${Date.now()}`, tone: 'error', message: error instanceof Error ? error.message : t('couldNotRestoreStash') });
  const restore = async (stash: StashRecord, selection?: { kind: 'tab'; tabId: number } | { kind: 'group'; groupId: number }) => {
    if (loading) return;
    setLoading(stash.id);
    try {
      const result = await request<{ created: number; failed: number }>(selection ? { type: 'RESTORE_STASH_SELECTION', stashId: stash.id, selection } : { type: 'RESTORE_STASH', stashId: stash.id });
      useZenTabStore.setState({ restoreProgress: null });
      showToast({ id: `${Date.now()}`, tone: result.failed > 0 ? 'warning' : 'success', message: result.failed > 0 ? t('tabsRestoredWithSkipped', { created: result.created, failed: result.failed }) : t('tabsOpening', { count: result.created }) });
    } catch (error) { showRestoreError(error); }
    finally { useZenTabStore.setState({ restoreProgress: null }); setLoading(null); }
  };
  const remove = async (stash: StashRecord) => {
    if (loading) return;
    setLoading(stash.id);
    try { await request({ type: 'DELETE_STASH', stashId: stash.id }); showToast({ id: `${Date.now()}`, tone: 'neutral', message: t('stashDeleted') }); }
    catch (error) { showToast({ id: `${Date.now()}`, tone: 'error', message: error instanceof Error ? error.message : t('couldNotDeleteStash') }); }
    finally { setLoading(null); }
  };
  const rename = async (stash: StashRecord) => {
    const name = draftName.trim();
    if (!name || name.length > 80) {
      showToast({ id: `${Date.now()}`, tone: 'warning', message: t('invalidStashName') });
      return;
    }
    try {
      await request({ type: 'RENAME_STASH', stashId: stash.id, name });
      setEditingId(null);
      showToast({ id: `${Date.now()}`, tone: 'success', message: t('stashRenamed') });
    } catch (error) {
      showToast({ id: `${Date.now()}`, tone: 'error', message: error instanceof Error ? error.message : t('actionFailed') });
    }
  };
  const importJsonFile = async (file: File) => {
    try {
      const stashesToImport = parseImportedStashes(await file.text());
      const result = await request<{ imported: number }>({ type: 'IMPORT_STASHES', stashes: stashesToImport });
      showToast({ id: `${Date.now()}`, tone: 'success', message: t('importedStashes', { count: result.imported }) });
    } catch (error) {
      showToast({ id: `${Date.now()}`, tone: 'error', message: error instanceof Error ? error.message : t('couldNotImport') });
    }
  };
  const restoreSession = async (session: RecentSession) => {
    setRecentSessions((prev) => prev.filter((s) => s.sessionId !== session.sessionId));
    try {
      await request({ type: 'RESTORE_SESSION', sessionId: session.sessionId });
      showToast({ id: `${Date.now()}`, tone: 'success', message: t('lastActionRestored') });
    } catch (error) {
      void request<RecentSession[]>({ type: 'LIST_RECENT_SESSIONS' }).then(setRecentSessions).catch(() => {});
      showToast({ id: `${Date.now()}`, tone: 'error', message: error instanceof Error ? error.message : t('couldNotListSessions') });
    }
  };
  const renderDetails = (stash: StashRecord) => {
    const groups = new Map<number, typeof stash.tabs>();
    const ungrouped: typeof stash.tabs = [];
    for (const tab of stash.tabs) {
      if (tab.groupId === -1) ungrouped.push(tab);
      else groups.set(tab.groupId, [...(groups.get(tab.groupId) ?? []), tab]);
    }
    const groupEntries = [...groups.entries()];
    return <div className="stash-details">
      {groupEntries.map(([groupId, tabs]) => <div className="stash-detail-group" key={`${stash.id}-group-${groupId}`}>
        <div className="stash-detail-heading"><span><span className="group-dot blue" /> {tabs[0]?.groupTitle || t('untitledGroup')} <small>{tabs.length}</small></span><button className="small-button" disabled={loading !== null} onClick={() => void restore(stash, { kind: 'group', groupId })}><ArrowUpRight size={13} /> {t('restoreGroup')}</button></div>
        {tabs.map((tab) => <div className="stash-tab-item" key={`${stash.id}-${tab.tabId ?? tab.url}-${tab.index}`}><span className="stash-tab-copy"><Globe2 size={12} /><span><strong>{tab.title || t('untitledTab')}</strong><small>{displayHostname(tab.url)}</small></span></span><button className="icon-button subtle" disabled={loading !== null || typeof tab.tabId !== 'number'} onClick={() => typeof tab.tabId === 'number' && void restore(stash, { kind: 'tab', tabId: tab.tabId })} aria-label={`${t('restoreTab')} ${tab.title}`} title={t('restoreTab')}><ArrowUpRight size={14} /></button></div>)}
      </div>)}
      {ungrouped.length > 0 && <div className="stash-detail-group"><div className="stash-detail-heading"><span><span className="group-dot neutral" /> {t('ungrouped')} <small>{ungrouped.length}</small></span></div>{ungrouped.map((tab) => <div className="stash-tab-item" key={`${stash.id}-${tab.tabId ?? tab.url}-${tab.index}`}><span className="stash-tab-copy"><Globe2 size={12} /><span><strong>{tab.title || t('untitledTab')}</strong><small>{displayHostname(tab.url)}</small></span></span><button className="icon-button subtle" disabled={loading !== null || typeof tab.tabId !== 'number'} onClick={() => typeof tab.tabId === 'number' && void restore(stash, { kind: 'tab', tabId: tab.tabId })} aria-label={`${t('restoreTab')} ${tab.title}`} title={t('restoreTab')}><ArrowUpRight size={14} /></button></div>)}</div>}
    </div>;
  };
  return <section className="stash-view"><div className="section-intro"><div><span className="eyebrow">{t('recoverableContext')}</span><h2>{t('stashLibrary')}</h2><p>{t('stashLibraryDescription')}</p></div><div className="stash-total"><span>{stashes.length}</span><small>{t('saved')}</small></div></div>
    <div className="stash-toolbar">
      <button className="small-button" type="button" onClick={() => jsonInputRef.current?.click()} title={t('importJsonTooltip')}><Upload size={13} /> {t('importFile')}</button>
      <input ref={jsonInputRef} type="file" accept="application/json,.json" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void importJsonFile(file); event.target.value = ''; }} />
    </div>
    {recentSessions.length > 0 && (
      <div className="recent-sessions">
        <div className="recent-sessions-header">
          <div className="recent-sessions-title">
            <Clock size={13} className="text-accent" />
            <strong>{t('recentlyClosed')}</strong>
            <span className="recent-sessions-badge">{recentSessions.length}</span>
          </div>
        </div>
        <div className={`recent-sessions-list${showAllRecent ? ' expanded' : ''}`}>
          {(showAllRecent ? recentSessions : recentSessions.slice(0, 8)).map((session) => {
            const isWindow = session.kind === 'window';
            const tabLabel = session.tabCount === 1 ? t('tabSingle') : t('tabsCount', { count: session.tabCount });
            const host = session.url ? displayHostname(session.url) : '';
            const subtitle = isWindow
              ? `${t('closedWindow')} · ${tabLabel}`
              : host || t('closedTab');
            return (
              <div className="recent-session-row" key={session.sessionId}>
                <span className="favicon-wrap">
                  {isWindow ? (
                    <Layers3 size={14} className="text-accent" />
                  ) : session.favIconUrl ? (
                    <img src={session.favIconUrl} alt="" className="favicon" draggable={false} />
                  ) : (
                    <Globe2 size={14} />
                  )}
                </span>
                <div className="recent-session-copy">
                  <strong title={session.title}>{session.title}</strong>
                  <small title={subtitle}>{subtitle}</small>
                </div>
                <button
                  className="recent-session-restore-btn"
                  onClick={() => void restoreSession(session)}
                  title={`${t('restoreClosed')}: ${session.title}`}
                >
                  <RotateCcw size={12} />
                  <span>{t('restoreClosed')}</span>
                </button>
              </div>
            );
          })}
        </div>
        {recentSessions.length > 8 && (
          <button
            type="button"
            className="recent-sessions-toggle-btn"
            onClick={() => setShowAllRecent((open) => !open)}
            aria-expanded={showAllRecent}
          >
            <span>{showAllRecent ? t('showLessRecent') : t('showAllRecent', { count: recentSessions.length })}</span>
            <ChevronDown size={13} className={showAllRecent ? 'rotate-180' : ''} />
          </button>
        )}
      </div>
    )}
    {!hideSearch && <label className="search-box stash-search"><Search size={16} /><input value={search} onChange={(event) => onSearch(event.target.value)} placeholder={t('stashSearch')} aria-label={t('stashSearch')} />{search && <button className="search-clear" onClick={() => onSearch('')} aria-label={t('close')}><X size={13} /></button>}</label>}
    {loading && restoreProgress?.stashId === loading && <div className="stash-progress" role="status">{t('restoringTabs')} · {restoreProgress.completed}/{restoreProgress.total}</div>}
    {stashes.length === 0 ? <div className="empty-state stash-empty"><div className="empty-orbit"><Archive size={22} /></div><strong>{t('nextFocus')}</strong><p>{t('stashEmptyDescription')}</p></div> : filteredStashes.length === 0 ? <div className="empty-state stash-empty"><div className="empty-orbit"><Search size={22} /></div><strong>{t('noMatchingStashes')}</strong><p>{t('tryShorterTitle')}</p></div> : <div className="stash-list">{filteredStashes.map((stash) => <article className={expandedId === stash.id ? 'stash-item expanded' : 'stash-item'} key={stash.id}><div className="stash-icon"><Archive size={17} /></div><div className="stash-copy"><div className="stash-title-row">{editingId === stash.id ? <form className="stash-rename-form" onSubmit={(event) => { event.preventDefault(); void rename(stash); }}><input autoFocus maxLength={80} value={draftName} onChange={(event) => setDraftName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setEditingId(null); }} aria-label={t('renameStash')} /><button className="icon-button subtle" type="submit" aria-label={t('done')}><Check size={14} /></button></form> : <><strong>{stash.name}</strong><button className="icon-button subtle stash-edit" onClick={() => { setEditingId(stash.id); setDraftName(stash.name); }} aria-label={`${t('renameStash')} ${stash.name}`} title={t('renameStash')}><Pencil size={13} /></button></>}</div><span>{t('tabsCount', { count: stash.tabs.length })} · {new Date(stash.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span><div className="stash-preview">{stash.tabs.slice(0, 3).map((tab) => <span key={`${stash.id}-${tab.tabId ?? tab.url}`} title={tab.title}><Globe2 size={12} /> {displayHostname(tab.url)}</span>)}</div></div><div className="stash-actions"><button className="icon-button subtle" onClick={() => downloadTextFile(`${stash.name}.json`, exportStashAsJson(stash))} aria-label={t('exportJson')} title={t('exportJson')}><Download size={14} /></button><button className="icon-button subtle" onClick={() => downloadTextFile(`${stash.name}.md`, exportStashAsMarkdown(stash), 'text/markdown')} aria-label={t('exportMarkdown')} title={t('exportMarkdown')}><Download size={14} /></button><button className="small-button" disabled={loading !== null} onClick={() => void restore(stash)}>{loading === stash.id ? <RefreshCw className="spin" size={14} /> : <ArrowUpRight size={14} />} {t('restore')}</button><button className="icon-button subtle" disabled={loading !== null} onClick={() => setExpandedId((current) => current === stash.id ? null : stash.id)} aria-label={expandedId === stash.id ? t('collapseStash') : t('expandStash')} title={expandedId === stash.id ? t('collapseStash') : t('expandStash')}>{expandedId === stash.id ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</button><button className="icon-button subtle" disabled={loading !== null} onClick={() => void remove(stash)} aria-label={`${t('delete')} ${stash.name}`}><Trash2 size={15} /></button></div>{expandedId === stash.id && renderDetails(stash)}</article>)}</div>}
  </section>;
}
