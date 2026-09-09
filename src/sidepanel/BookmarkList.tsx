import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bookmark, ChevronDown, ChevronRight, Globe2, RefreshCw, Sparkles, Trash2, X } from 'lucide-react';
import { BOOKMARK_WORKSPACE_PERMISSIONS, chromeFaviconUrl, readFaviconGranted, resolveBookmarkFavicon } from '../shared/bookmark-favicon';
import { searchBookmarks } from '../shared/bookmark-search';
import { BookmarkForestNode, buildBookmarkForest, inboxBookmarks } from '../shared/bookmark-tree';
import { findBookmarkDuplicateGroups } from '../shared/bookmarks';
import { extractGroupingPageTextInPage } from '../shared/page-text';
import {
  BookmarkDuplicateGroup,
  BookmarkFolderRecord,
  BookmarkFolderSuggestion,
  BookmarkRecord,
  TabRecord,
  ToastMessage,
  ZenTabEvent,
  ZenTabMessage,
} from '../shared/types';
import { canonicalizeUrl } from '../shared/url';
import { ContextMenu, ContextMenuItem } from './ContextMenu';
import { buildBookmarkGroupContextSpecs, buildBookmarkRowContextSpecs } from './context-menu';
import { fileDroppedTab } from './file-dropped-tab';
import { Translator } from './i18n';

const BOOKMARK_SUMMARIES_KEY = 'zen-tab.bookmark-summaries';
const MAX_BOOKMARK_SUMMARIES = 200;

type BookmarkTreeData = {
  granted: boolean;
  bookmarks: BookmarkRecord[];
  folders: BookmarkFolderRecord[];
};

type FilingDraft = {
  bookmarkId: string;
  suggestion: BookmarkFolderSuggestion | null;
  folderId: string;
};

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function eligibleFolders(folders: BookmarkFolderRecord[]): BookmarkFolderRecord[] {
  return folders.filter((folder) => !folder.isSpecialRoot && !folder.isInbox);
}

export function BookmarkList({
  search,
  bookmarkEpoch,
  filingSuggestion,
  openTabs,
  request,
  showToast,
  t,
  onBookmarksChange,
  onDismissSuggestion,
}: {
  search: string;
  bookmarkEpoch: number;
  filingSuggestion: Extract<ZenTabEvent, { type: 'BOOKMARK_FILING_SUGGESTED' }> | null;
  openTabs: TabRecord[];
  request: <T = unknown>(message: ZenTabMessage) => Promise<T>;
  showToast: (toast: ToastMessage) => void;
  t: Translator;
  onBookmarksChange: (bookmarks: BookmarkRecord[]) => void;
  onDismissSuggestion: () => void;
}) {
  const [permissionGranted, setPermissionGranted] = useState<boolean | null>(null);
  const [faviconGranted, setFaviconGranted] = useState(false);
  const [bookmarks, setBookmarks] = useState<BookmarkRecord[]>([]);
  const [folders, setFolders] = useState<BookmarkFolderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [filingDraft, setFilingDraft] = useState<FilingDraft | null>(null);
  const [duplicateGroups, setDuplicateGroups] = useState<BookmarkDuplicateGroup[] | null>(null);
  const [canEnrich, setCanEnrich] = useState(false);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(() => new Set());
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; label: string; items: ContextMenuItem[] } | null>(null);

  const loadTree = useCallback(async () => {
    setLoading(true);
    try {
      const [data, stored] = await Promise.all([
        request<BookmarkTreeData>({ type: 'GET_BOOKMARK_TREE' }),
        chrome.storage.local.get(BOOKMARK_SUMMARIES_KEY),
      ]);
      setPermissionGranted(data.granted);
      if (!data.granted) {
        setBookmarks([]);
        setFolders([]);
        onBookmarksChange([]);
        return;
      }
      const summaries = (stored[BOOKMARK_SUMMARIES_KEY] ?? {}) as Record<string, string>;
      const enriched = data.bookmarks.map((bookmark) => summaries[bookmark.id]
        ? { ...bookmark, summary: summaries[bookmark.id] }
        : bookmark);
      setBookmarks(enriched);
      setFolders(data.folders);
      onBookmarksChange(enriched);
    } catch (error) {
      showToast({
        id: `${Date.now()}`,
        tone: 'error',
        message: error instanceof Error ? error.message : t('couldNotLoadBookmarks'),
      });
    } finally {
      setLoading(false);
    }
  }, [onBookmarksChange, request, showToast, t]);

  const requestPermission = useCallback(async () => {
    setLoading(true);
    try {
      const granted = await chrome.permissions.request(BOOKMARK_WORKSPACE_PERMISSIONS);
      setPermissionGranted(granted);
      if (granted) setFaviconGranted(true);
      if (!granted) setLoading(false);
    } catch {
      setPermissionGranted(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void chrome.permissions.contains({ permissions: ['bookmarks'] })
      .then((granted) => {
        if (cancelled) return;
        setPermissionGranted(granted);
        if (!granted) setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setPermissionGranted(false);
        setLoading(false);
      });
    void readFaviconGranted((details) => chrome.permissions.contains(details))
      .then((granted) => {
        if (cancelled) return;
        setFaviconGranted(granted);
      });
    return () => { cancelled = true; };
  }, [bookmarkEpoch]);

  useEffect(() => {
    if (permissionGranted === true) void loadTree();
  }, [bookmarkEpoch, loadTree, permissionGranted]);

  useEffect(() => {
    const clearDropTarget = () => setDropTarget(null);
    window.addEventListener('dragend', clearDropTarget);
    return () => window.removeEventListener('dragend', clearDropTarget);
  }, []);

  useEffect(() => {
    void chrome.permissions.contains({ permissions: ['scripting'], origins: ['<all_urls>'] })
      .then(setCanEnrich)
      .catch(() => setCanEnrich(false));
  }, []);

  const availableFolders = useMemo(() => eligibleFolders(folders), [folders]);
  const inbox = useMemo(() => inboxBookmarks(bookmarks, folders), [bookmarks, folders]);
  const inboxIds = useMemo(() => new Set(inbox.map((bookmark) => bookmark.id)), [inbox]);
  const forest = useMemo(() => buildBookmarkForest(folders, bookmarks), [bookmarks, folders]);
  const searchHits = useMemo(
    () => search.trim() ? searchBookmarks(bookmarks, search).map((result) => result.bookmark) : [],
    [bookmarks, search],
  );

  const openContextMenu = useCallback((event: React.MouseEvent, items: ContextMenuItem[], label: string) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ x: event.clientX, y: event.clientY, items, label });
  }, []);

  const toggleFolder = useCallback((folderId: string) => {
    setCollapsedFolders((current) => {
      const next = new Set(current);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }, []);

  const beginFiling = useCallback(async (bookmarkId: string, suggestion?: BookmarkFolderSuggestion | null) => {
    setBusy(bookmarkId);
    try {
      const resolved = suggestion === undefined
        ? await request<BookmarkFolderSuggestion | null>({ type: 'SUGGEST_BOOKMARK_FILE', bookmarkId })
        : suggestion;
      setFilingDraft({
        bookmarkId,
        suggestion: resolved,
        folderId: resolved?.folderId ?? availableFolders[0]?.id ?? '',
      });
    } catch (error) {
      showToast({ id: `${Date.now()}`, tone: 'error', message: error instanceof Error ? error.message : t('actionFailed') });
    } finally {
      setBusy(null);
    }
  }, [availableFolders, request, showToast, t]);

  const fileBookmark = useCallback(async () => {
    if (!filingDraft?.folderId) return;
    setBusy(filingDraft.bookmarkId);
    try {
      const result = await request<{ moved: number }>({
        type: 'FILE_BOOKMARKS',
        bookmarkIds: [filingDraft.bookmarkId],
        folderId: filingDraft.folderId,
      });
      const folder = availableFolders.find((item) => item.id === filingDraft.folderId);
      showToast({
        id: `${Date.now()}`,
        tone: result.moved > 0 ? 'success' : 'neutral',
        message: t('bookmarksFiled', { count: result.moved, folder: folder?.title ?? '' }),
        ...(result.moved > 0 ? { action: 'undo' as const } : {}),
      });
      setFilingDraft(null);
      onDismissSuggestion();
    } catch (error) {
      showToast({ id: `${Date.now()}`, tone: 'error', message: error instanceof Error ? error.message : t('actionFailed') });
    } finally {
      setBusy(null);
    }
  }, [availableFolders, filingDraft, onDismissSuggestion, request, showToast, t]);

  const previewDuplicates = useCallback(() => {
    const groups = findBookmarkDuplicateGroups(bookmarks);
    if (!groups.length) {
      showToast({ id: `${Date.now()}`, tone: 'neutral', message: t('noDuplicateBookmarks') });
      return;
    }
    setDuplicateGroups(groups);
  }, [bookmarks, showToast, t]);

  const applyDedup = useCallback(async () => {
    if (!duplicateGroups) return;
    setBusy('dedup');
    try {
      const result = await request<{ removed: number }>({ type: 'APPLY_BOOKMARK_DEDUP', groups: duplicateGroups });
      showToast({
        id: `${Date.now()}`,
        tone: result.removed > 0 ? 'success' : 'neutral',
        message: t('duplicateBookmarksRemoved', { count: result.removed }),
        ...(result.removed > 0 ? { action: 'undo' as const } : {}),
      });
      setDuplicateGroups(null);
    } catch (error) {
      showToast({ id: `${Date.now()}`, tone: 'error', message: error instanceof Error ? error.message : t('actionFailed') });
    } finally {
      setBusy(null);
    }
  }, [duplicateGroups, request, showToast, t]);

  const enrichBookmark = useCallback(async (bookmark: BookmarkRecord) => {
    const canonical = canonicalizeUrl(bookmark.url);
    const tab = openTabs.find((item) => canonicalizeUrl(item.url) === canonical);
    if (!tab || !canEnrich) return;
    setBusy(bookmark.id);
    try {
      const result = await chrome.scripting.executeScript({
        target: { tabId: tab.tabId },
        func: extractGroupingPageTextInPage,
      });
      const summary = result[0]?.result;
      if (typeof summary !== 'string' || !summary) {
        showToast({ id: `${Date.now()}`, tone: 'neutral', message: t('bookmarkSummaryUnavailable') });
        return;
      }
      const stored = await chrome.storage.local.get(BOOKMARK_SUMMARIES_KEY);
      const summaries = { ...((stored[BOOKMARK_SUMMARIES_KEY] ?? {}) as Record<string, string>) };
      delete summaries[bookmark.id];
      summaries[bookmark.id] = summary.slice(0, 900);
      const entries = Object.entries(summaries);
      const capped = Object.fromEntries(entries.slice(Math.max(0, entries.length - MAX_BOOKMARK_SUMMARIES)));
      await chrome.storage.local.set({ [BOOKMARK_SUMMARIES_KEY]: capped });
      const next = bookmarks.map((item) => item.id === bookmark.id ? { ...item, summary: summaries[bookmark.id] } : item);
      setBookmarks(next);
      onBookmarksChange(next);
      showToast({ id: `${Date.now()}`, tone: 'success', message: t('bookmarkSummarySaved') });
    } catch {
      showToast({ id: `${Date.now()}`, tone: 'warning', message: t('bookmarkSummaryUnavailable') });
    } finally {
      setBusy(null);
    }
  }, [bookmarks, canEnrich, onBookmarksChange, openTabs, showToast, t]);

  const handleTabDragOver = (event: React.DragEvent, target: string) => {
    if (!event.dataTransfer.types.includes('text/tab-id')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropTarget(target);
  };

  const handleTabDragLeave = (event: React.DragEvent, target: string) => {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    setDropTarget((current) => current === target ? null : current);
  };

  const handleTabDrop = (event: React.DragEvent, folderId?: string) => {
    event.preventDefault();
    event.stopPropagation();
    setDropTarget(null);
    const tabId = Number(event.dataTransfer.getData('text/tab-id'));
    if (Number.isFinite(tabId)) void fileDroppedTab(tabId, folderId, { openTabs, request, showToast, t });
  };

  if (loading && permissionGranted == null) {
    return <div className="bookmark-loading" role="status"><RefreshCw size={16} className="spin" /> {t('loadingBookmarks')}</div>;
  }

  if (permissionGranted === false) {
    return <div className="bookmarks-stub empty-state">
      <div className="empty-orbit"><Bookmark size={22} /></div>
      <strong>{t('bookmarkPermissionTitle')}</strong>
      <p>{t('bookmarkPermissionBody')}</p>
      <button className="primary-button bookmark-grant" disabled={loading} onClick={() => void requestPermission()}>{t('grantBookmarkAccess')}</button>
    </div>;
  }

  const openCanonicalUrls = new Set(openTabs.map((tab) => canonicalizeUrl(tab.url)).filter(Boolean));
  const searching = Boolean(search.trim());

  const renderBookmarkRow = (bookmark: BookmarkRecord) => {
    const inTray = inboxIds.has(bookmark.id);
    const hasOpenTab = openCanonicalUrls.has(canonicalizeUrl(bookmark.url));
    const icon = resolveBookmarkFavicon(
      bookmark.url,
      openTabs,
      faviconGranted ? chromeFaviconUrl(bookmark.url, (path) => chrome.runtime.getURL(path)) : undefined,
    );
    return <div className="bookmark-row" key={bookmark.id} onContextMenu={(event) => openContextMenu(event, buildBookmarkRowContextSpecs({ t, isInbox: inTray }).map((spec) => ({
      ...spec,
      onSelect: () => {
        if (spec.id === 'open') void chrome.tabs.create({ url: bookmark.url });
        if (spec.id === 'file') void beginFiling(bookmark.id);
      },
    })), bookmark.title || bookmark.url)}>
      <button className="bookmark-main" onClick={() => void chrome.tabs.create({ url: bookmark.url })}>
        <span className="bookmark-icon">{icon ? <img src={icon} alt="" className="favicon" /> : <Globe2 size={14} />}</span>
        <span className="bookmark-copy">
          <strong>{bookmark.title || bookmark.url}</strong>
          <small>{hostLabel(bookmark.url)}{bookmark.summary ? ` · ${bookmark.summary}` : ''}</small>
        </span>
      </button>
      {canEnrich && hasOpenTab && <button className="bookmark-row-action" disabled={busy === bookmark.id} onClick={() => void enrichBookmark(bookmark)} title={t('enrichBookmark')} aria-label={t('enrichBookmark')}><Sparkles size={13} /></button>}
      {inTray && <button className="small-button bookmark-file" disabled={busy === bookmark.id} onClick={() => void beginFiling(bookmark.id)}>{t('fileBookmark')}</button>}
    </div>;
  };

  const renderForest = (nodes: BookmarkForestNode[]): React.ReactNode => nodes.map((node) => {
    if (node.kind === 'bookmark') return renderBookmarkRow(node.bookmark);
    const collapsed = collapsedFolders.has(node.folder.id);
    return <section className="bookmark-group" key={node.folder.id}>
      <header
        className={dropTarget === node.folder.id ? 'drop-target' : undefined}
        aria-expanded={!collapsed}
        onClick={() => toggleFolder(node.folder.id)}
        onContextMenu={(event) => openContextMenu(event, buildBookmarkGroupContextSpecs({ t, collapsed }).map((spec) => ({
          ...spec,
          onSelect: () => toggleFolder(node.folder.id),
        })), node.folder.title)}
        onDragOver={(event) => handleTabDragOver(event, node.folder.id)}
        onDragLeave={(event) => handleTabDragLeave(event, node.folder.id)}
        onDrop={(event) => handleTabDrop(event, node.folder.id)}
      >
        <span className="bookmark-chevron">{collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}</span>
        <strong>{dropTarget === node.folder.id ? t('dropToFile') : node.folder.title}</strong>
        <span>{node.count}</span>
      </header>
      {!collapsed && <div className="bookmark-folder-children">{renderForest(node.children)}</div>}
    </section>;
  });

  return <div className="bookmark-view">
    <div className="bookmark-toolbar">
      <span>{t('bookmarkLibraryDescription', { count: bookmarks.length })}</span>
      <button className="small-button" disabled={busy === 'dedup'} onClick={previewDuplicates}><Trash2 size={12} /> {t('findDuplicates')}</button>
    </div>

    {filingSuggestion && <div className="bookmark-suggestion">
      <Sparkles size={15} />
      <div>
        <strong>{filingSuggestion.title || filingSuggestion.url}</strong>
        <span>{filingSuggestion.suggestion
          ? t('bookmarkSuggestedFolder', { folder: filingSuggestion.suggestion.folderTitle })
          : t('bookmarkChooseFolder')}</span>
      </div>
      <button className="small-button" onClick={() => void beginFiling(filingSuggestion.bookmarkId, filingSuggestion.suggestion)}>{t('review')}</button>
      <button className="icon-button subtle" onClick={onDismissSuggestion} aria-label={t('dismiss')}><X size={13} /></button>
    </div>}

    <div className="bookmark-scroller">
      {searching ? <>
        {!loading && searchHits.length === 0 && <div className="empty-state bookmark-empty">
          <div className="empty-orbit"><Bookmark size={20} /></div>
          <strong>{t('noMatchingBookmarks')}</strong>
          <p>{t('tryDifferentBookmarkSearch')}</p>
        </div>}
        {searchHits.length > 0 && <section className="bookmark-group">
          <header><strong>{t('bookmarkSearchResults')}</strong><span>{searchHits.length}</span></header>
          {searchHits.map(renderBookmarkRow)}
        </section>}
      </> : <>
        <section
          className={`bookmark-group bookmark-inbox${dropTarget === 'inbox' ? ' drop-target' : ''}`}
          onDragOver={(event) => handleTabDragOver(event, 'inbox')}
          onDragLeave={(event) => handleTabDragLeave(event, 'inbox')}
          onDrop={(event) => handleTabDrop(event)}
        >
          <header>
            <strong>{dropTarget === 'inbox' ? t('dropToFile') : t('bookmarkInbox')}</strong>
            <span>{inbox.length}</span>
          </header>
          {inbox.map(renderBookmarkRow)}
        </section>
        {renderForest(forest)}
        {!loading && inbox.length === 0 && forest.length === 0 && <div className="empty-state bookmark-empty">
          <div className="empty-orbit"><Bookmark size={20} /></div>
          <strong>{t('noBookmarksYet')}</strong>
          <p>{t('saveBookmarkToAppear')}</p>
        </div>}
      </>}
    </div>

    {filingDraft && <div className="bookmark-inline-panel" role="dialog" aria-label={t('fileBookmark')}>
      <div>
        <strong>{t('chooseBookmarkFolder')}</strong>
        {filingDraft.suggestion && <small>{filingDraft.suggestion.reason}</small>}
      </div>
      <select value={filingDraft.folderId} onChange={(event) => setFilingDraft({ ...filingDraft, folderId: event.target.value })}>
        {!availableFolders.length && <option value="">{t('noBookmarkFolders')}</option>}
        {availableFolders.map((folder) => <option key={folder.id} value={folder.id}>{folder.folderPath}</option>)}
      </select>
      <button className="primary-button" disabled={!filingDraft.folderId || busy === filingDraft.bookmarkId} onClick={() => void fileBookmark()}>{t('fileBookmark')}</button>
      <button className="icon-button subtle" onClick={() => setFilingDraft(null)} aria-label={t('cancel')}><X size={13} /></button>
    </div>}

    <ContextMenu open={Boolean(contextMenu)} x={contextMenu?.x ?? 0} y={contextMenu?.y ?? 0} items={contextMenu?.items ?? []} label={contextMenu?.label ?? t('bookmarks')} onClose={() => setContextMenu(null)} />

    {duplicateGroups && <div className="modal-backdrop" role="presentation">
      <div className="modal-sheet bookmark-dedup-modal" role="dialog" aria-modal="true" aria-label={t('bookmarkDedupTitle')}>
        <header className="modal-header">
          <div><span className="eyebrow">{t('bookmarkDedupEyebrow')}</span><h2>{t('bookmarkDedupTitle')}</h2><p>{t('bookmarkDedupDescription')}</p></div>
          <button className="icon-button" onClick={() => setDuplicateGroups(null)} aria-label={t('close')}><X size={15} /></button>
        </header>
        <div className="modal-content bookmark-dedup-list">
          {duplicateGroups.map((group) => {
            const keep = bookmarks.find((item) => item.id === group.keepId);
            const remove = group.removeIds
              .map((id) => bookmarks.find((item) => item.id === id))
              .filter((item): item is BookmarkRecord => Boolean(item));
            return <div className="bookmark-dedup-group" key={group.canonicalUrl}>
              <strong>{keep?.title || group.canonicalUrl}</strong>
              <small>{t('bookmarkDedupKeep', { folder: keep?.folderPath ?? '' })}</small>
              <span>{t('bookmarkDedupRemove', { count: group.removeIds.length })}</span>
              {remove.map((bookmark) => <span className="bookmark-dedup-remove" key={bookmark.id}>× {bookmark.folderPath}</span>)}
            </div>;
          })}
        </div>
        <footer className="modal-footer modal-actions">
          <button className="text-button" onClick={() => setDuplicateGroups(null)}>{t('cancel')}</button>
          <button className="primary-button danger-button" disabled={busy === 'dedup'} onClick={() => void applyDedup()}>{t('removeDuplicateBookmarks', { count: duplicateGroups.reduce((sum, group) => sum + group.removeIds.length, 0) })}</button>
        </footer>
      </div>
    </div>}
  </div>;
}
