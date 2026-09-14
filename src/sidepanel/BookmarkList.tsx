import { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Bookmark, ChevronDown, ChevronRight, FolderPlus, Globe2, MoreHorizontal, Pencil, RefreshCw, Sparkles, Trash2, X,
} from 'lucide-react';
import {
  collectFolderUrls,
  firstViewportIndex,
  folderSurfaceColor,
  INBOX_SURFACE_COLOR,
  pickFaviconStack,
  resolveStickyGroup,
  stickyHeaderHasScrolledAway,
} from '../shared/atmosphere';
import {
  bookmarkPlaceholderDest,
  coerceBookmarkDragHit,
  findRootFolderRecord,
  formatBookmarkFolderRowId,
  formatBookmarkRowId,
  isRootBookmarkFolder,
  parseBookmarkDragSource,
  placeBookmarkPlaceholder,
  resolveBookmarkDragEnd,
  resolveBookmarkFolderHeaderHit,
  resolveBookmarkItemDropHit,
  settleBookmarkPlaceholder,
  type BookmarkDisplayRow,
  type BookmarkDragOver,
  type BookmarkDragSource,
} from '../shared/bookmark-dnd';
import { BOOKMARK_WORKSPACE_PERMISSIONS, chromeFaviconUrl, readFaviconGranted, resolveBookmarkFavicon } from '../shared/bookmark-favicon';
import { searchBookmarks } from '../shared/bookmark-search';
import { getBuiltInAiStatus } from '../shared/ai';
import {
  buildTopicAnalyzePayload,
  requestTopicOrganizeJson,
  selectAnalyzeBookmarks,
  topicProposalFromModel,
} from '../shared/bookmark-organize-ai';
import {
  formatOrganizeSnapshotTime,
  mergeTopicWithHostOrganize,
  proposeBookmarkOrganize,
  type BookmarkOrganizeProposal,
} from '../shared/bookmark-organize';
import { bookmarkUndoToastKey } from '../shared/bookmark-toasts';
import {
  COLLAPSED_BOOKMARK_FOLDERS_KEY,
  largeFolderIdsToCollapse,
  readCollapsedFolderIds,
  resolveCollapsedFolderIds,
  toggleCollapsedFolderId,
} from '../shared/bookmark-collapse';
import { BookmarkForestNode, buildBookmarkForest, flattenVisibleBookmarkRows, INBOX_COLLAPSE_ID, inboxBookmarks } from '../shared/bookmark-tree';
import { canMutateBookmarkNode, filingDestinationFolders, findBookmarkDuplicateGroups, isManagedBookmarkNode, otherBookmarksRootId } from '../shared/bookmarks';
import { extractGroupingPageTextInPage } from '../shared/page-text';
import { dropPositionFromPoint } from '../shared/tab-ops';
import { formatTabDragId, parseTabDragId, rememberTabDragHit, TAB_DROP_ATTR, type DragSurface } from '../shared/tab-dnd';
import {
  BookmarkFolderRecord,
  BookmarkFolderSuggestion,
  BookmarkOrganizeScope,
  BookmarkOrganizeSnapshotSummary,
  BookmarkRecord,
  TabRecord,
  ToastMessage,
  ZenTabEvent,
  ZenTabMessage,
  ZenTabSettings,
} from '../shared/types';
import { canonicalizeUrl } from '../shared/url';
import { BookmarkEditPanel } from './BookmarkEditPanel';
import { BookmarkExportSheet } from './BookmarkExportSheet';
import { BookmarkFilingSheet } from './BookmarkFilingSheet';
import { BookmarkHealthSheet } from './BookmarkHealthSheet';
import { ContextMenu, ContextMenuItem } from './ContextMenu';
import { buildBookmarkGroupContextSpecs, buildBookmarkRowContextSpecs } from './context-menu';
import { DragPreviewOverlay } from './DragPreviewOverlay';
import { DroppableSurface } from './dnd-surfaces';
import { FaviconStack } from './FaviconStack';
import { Translator } from './i18n';
import { setTabDragOverId } from './tab-drag-over';
import { usePointerDragSession } from './use-pointer-drag-session';

const BOOKMARK_SUMMARIES_KEY = 'zen-tab.bookmark-summaries';
const MAX_BOOKMARK_SUMMARIES = 200;
const BOOKMARK_STICKY_KINDS = ['folder', 'inbox', 'search'] as const;

export type BookmarkChrome = {
  inboxCount: number;
  openOrganize: () => void;
  openExport: () => void;
  openReview: () => void;
};

type BookmarkTreeData = {
  granted: boolean;
  bookmarks: BookmarkRecord[];
  folders: BookmarkFolderRecord[];
};

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}


function canMutateRecord(node: BookmarkRecord | BookmarkFolderRecord, folders: BookmarkFolderRecord[]): boolean {
  if (isManagedBookmarkNode(node.id, folders) || (node.parentId && isManagedBookmarkNode(node.parentId, folders))) {
    return false;
  }
  if ('url' in node) {
    return canMutateBookmarkNode({
      folderKind: node.folderKind === 'managed' ? 'managed' : 'folder',
      unmodifiable: node.unmodifiable,
    });
  }
  return canMutateBookmarkNode(node);
}

function readBookmarkDragOver(
  clientX: number,
  clientY: number,
  folders: BookmarkFolderRecord[],
  sourceId?: string,
  collapsedFolders?: ReadonlySet<string>,
  localX?: number,
): { over: BookmarkDragOver; placement?: 'before' | 'after' } | null {
  const raw = document.elementFromPoint(clientX, clientY);
  if (!raw || !('closest' in raw)) return null;

  const source = parseBookmarkDragSource(sourceId ?? '');
  const isFolderDrag = source?.type === 'folder';
  const isDraggedRoot = isFolderDrag && isRootBookmarkFolder(source.id, folders);
  const isLeftRail = localX !== undefined && localX < 36;

  const tabNode = raw.closest(`[${TAB_DROP_ATTR}]`);
  const tabSurface = tabNode ? parseTabDragId(tabNode.getAttribute(TAB_DROP_ATTR) ?? '') : null;
  if (tabSurface?.kind === 'bookmark-folder' && tabNode) {
    const dest = folders.find((folder) => folder.id === tabSurface.folderId);
    const rect = tabNode.getBoundingClientRect();
    const yRatio = rect.height === 0 ? 0.5 : (clientY - rect.top) / rect.height;
    const placement = dropPositionFromPoint(clientY, rect.top, rect.height);
    const parentId = tabNode.getAttribute('data-bookmark-parent') ?? dest?.parentId ?? '';
    const index = Number(tabNode.getAttribute('data-bookmark-index') ?? dest?.index ?? 0);
    const hit = resolveBookmarkFolderHeaderHit({
      sourceType: source?.type,
      folderId: tabSurface.folderId,
      parentId,
      index,
      isSpecialRoot: Boolean(dest?.isSpecialRoot),
      isExpanded: Boolean(collapsedFolders && !collapsedFolders.has(tabSurface.folderId)),
      placement,
      yRatio,
    });

    if (isFolderDrag && (isDraggedRoot || isLeftRail) && hit.over.kind === 'bookmark-folder-row') {
      const rootFolder = findRootFolderRecord(tabSurface.folderId, folders);
      if (rootFolder && rootFolder.id !== tabSurface.folderId && rootFolder.id !== source.id) {
        return {
          over: {
            kind: 'bookmark-folder-row',
            id: rootFolder.id,
            parentId: rootFolder.parentId ?? '',
            index: rootFolder.index,
          },
          placement: 'after',
        };
      }
    }

    return hit;
  }
  if (tabSurface && (
    tabSurface.kind === 'bookmark-inbox'
    || tabSurface.kind === 'bookmark-nav'
    || tabSurface.kind === 'stash'
  )) {
    return { over: tabSurface };
  }
  const rowNode = raw.closest('[data-bookmark-drop]');
  if (rowNode) {
    const dropAttr = rowNode.getAttribute('data-bookmark-drop') ?? '';
    if (dropAttr.startsWith('bookmark-empty-slot-')) {
      const folderId = dropAttr.slice('bookmark-empty-slot-'.length);
      return { over: { kind: 'bookmark-folder', folderId } };
    }
    const parsed = parseBookmarkDragSource(dropAttr);
    if (parsed) {
      const rect = rowNode.getBoundingClientRect();
      const placement = dropPositionFromPoint(clientY, rect.top, rect.height);
      const parentId = rowNode.getAttribute('data-bookmark-parent') ?? '';
      const index = Number(rowNode.getAttribute('data-bookmark-index') ?? 0);
      return resolveBookmarkItemDropHit({
        sourceType: source?.type,
        sourceId: source?.id,
        isDraggedRoot,
        isLeftRail,
        hoveredKind: parsed.type,
        hoveredId: parsed.id,
        parentId,
        index,
        folders,
        placement,
      });
    }
  }
  return tabSurface ? { over: tabSurface } : null;
}

function findLastVisibleDropTarget(
  rows: readonly BookmarkDisplayRow[],
  draggedKey: string,
  sourceType?: BookmarkDragSource['type'],
): { over: BookmarkDragOver; placement: 'after' } | null {
  if (sourceType === 'folder') {
    for (let i = rows.length - 1; i >= 0; i--) {
      const row = rows[i];
      if (row.kind === 'folder' && row.depth === 0) {
        const folderRowId = formatBookmarkFolderRowId(row.folder.id);
        if (folderRowId !== draggedKey) {
          return {
            over: {
              kind: 'bookmark-folder-row',
              id: row.folder.id,
              parentId: row.folder.parentId ?? '',
              index: row.folder.index,
            },
            placement: 'after',
          };
        }
      }
    }
  }

  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (row.kind === 'bookmark') {
      const rowId = formatBookmarkRowId(row.bookmark.id);
      if (rowId !== draggedKey) {
        return {
          over: {
            kind: 'bookmark-row',
            id: row.bookmark.id,
            parentId: row.bookmark.parentId,
            index: row.bookmark.index,
          },
          placement: 'after',
        };
      }
    } else if (row.kind === 'folder') {
      const folderRowId = formatBookmarkFolderRowId(row.folder.id);
      if (folderRowId !== draggedKey) {
        return {
          over: {
            kind: 'bookmark-folder-row',
            id: row.folder.id,
            parentId: row.folder.parentId ?? '',
            index: row.folder.index,
          },
          placement: 'after',
        };
      }
    }
  }
  return null;
}

export function BookmarkList({
  search,
  bookmarkEpoch,
  filingSuggestion,
  openTabs,
  settings,
  hasCloudApiKey,
  request,
  showToast,
  t,
  onBookmarksChange,
  onDismissSuggestion,
  onChromeChange,
}: {
  search: string;
  bookmarkEpoch: number;
  filingSuggestion: Extract<ZenTabEvent, { type: 'BOOKMARK_FILING_SUGGESTED' }> | null;
  openTabs: TabRecord[];
  settings: ZenTabSettings;
  hasCloudApiKey: boolean;
  request: <T = unknown>(message: ZenTabMessage) => Promise<T>;
  showToast: (toast: ToastMessage) => void;
  t: Translator;
  onBookmarksChange: (bookmarks: BookmarkRecord[]) => void;
  onDismissSuggestion: () => void;
  onChromeChange?: (chrome: BookmarkChrome | null) => void;
}) {
  const [permissionGranted, setPermissionGranted] = useState<boolean | null>(null);
  const [faviconGranted, setFaviconGranted] = useState(false);
  const [bookmarks, setBookmarks] = useState<BookmarkRecord[]>([]);
  const [folders, setFolders] = useState<BookmarkFolderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [reviewSheet, setReviewSheet] = useState<{
    rows: Array<{ bookmark: BookmarkRecord; suggestion: BookmarkFolderSuggestion | null }>;
    focusBookmarkId?: string;
  } | null>(null);
  const [healthOpen, setHealthOpen] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [builtInAvailable, setBuiltInAvailable] = useState(false);
  const [topicResult, setTopicResult] = useState<null | {
    proposal: BookmarkOrganizeProposal;
    analyzedCount: number;
    eligibleCount: number;
  }>(null);
  const [organizeSnapshots, setOrganizeSnapshots] = useState<BookmarkOrganizeSnapshotSummary[]>([]);
  const [exportOpen, setExportOpen] = useState(false);
  const [canEnrich, setCanEnrich] = useState(false);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(() => new Set());
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; label: string; items: ContextMenuItem[] } | null>(null);
  const [overflowCloseToken, setOverflowCloseToken] = useState(0);
  const [editDraft, setEditDraft] = useState<
    | { kind: 'bookmark'; id: string; title: string; url: string }
    | { kind: 'folder'; id: string; title: string }
    | { kind: 'create-folder'; parentId: string; title: string }
    | null
  >(null);
  const [visualRows, setVisualRows] = useState<BookmarkDisplayRow[] | null>(null);
  const collapseSeededRef = useRef(false);
  const analyzeGen = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const cloudReady = settings.aiProvider === 'openai-compatible' && hasCloudApiKey;
  const topicReady = cloudReady || builtInAvailable;

  const loadTree = useCallback(async () => {
    setLoading(true);
    try {
      const [data, stored] = await Promise.all([
        request<BookmarkTreeData>({ type: 'GET_BOOKMARK_TREE' }),
        chrome.storage.local.get([BOOKMARK_SUMMARIES_KEY, COLLAPSED_BOOKMARK_FOLDERS_KEY]),
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
      if (!collapseSeededRef.current) {
        collapseSeededRef.current = true;
        const forest = buildBookmarkForest(data.folders, enriched);
        const next = resolveCollapsedFolderIds(
          stored[COLLAPSED_BOOKMARK_FOLDERS_KEY],
          largeFolderIdsToCollapse(forest),
        );
        setCollapsedFolders(new Set(next));
        if (readCollapsedFolderIds(stored[COLLAPSED_BOOKMARK_FOLDERS_KEY]) === null) {
          void chrome.storage.local.set({ [COLLAPSED_BOOKMARK_FOLDERS_KEY]: next });
        }
      }
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
    void chrome.permissions.contains({ permissions: ['scripting'], origins: ['<all_urls>'] })
      .then(setCanEnrich)
      .catch(() => setCanEnrich(false));
  }, []);

  const availableFolders = useMemo(() => filingDestinationFolders(folders), [folders]);
  const inbox = useMemo(() => inboxBookmarks(bookmarks, folders), [bookmarks, folders]);
  const forest = useMemo(() => buildBookmarkForest(folders, bookmarks), [bookmarks, folders]);
  const healthGroups = useMemo(() => findBookmarkDuplicateGroups(bookmarks), [bookmarks]);
  const searchHits = useMemo(
    () => search.trim() ? searchBookmarks(bookmarks, search).map((result) => result.bookmark) : [],
    [bookmarks, search],
  );
  const otherRootId = useMemo(() => otherBookmarksRootId(folders), [folders]);
  const searching = Boolean(search.trim());
  const includeInbox = !searching && inbox.length > 0;
  const visibleRows = useMemo(() => flattenVisibleBookmarkRows({
    forest: forest,
    collapsedFolderIds: collapsedFolders,
    inbox,
    includeInbox,
    searching,
    searchHits,
  }), [collapsedFolders, forest, includeInbox, inbox, searchHits, searching]);
  const displayRows = visualRows ?? visibleRows;
  const sortableEnabled = !searching;
  const folderChildren = useMemo(() => {
    const map = new Map<string, BookmarkForestNode[]>();
    const walk = (nodes: BookmarkForestNode[]) => {
      for (const node of nodes) {
        if (node.kind !== 'folder') continue;
        map.set(node.folder.id, node.children);
        walk(node.children);
      }
    };
    walk(forest);
    return map;
  }, [forest]);
  const openCanonicalUrls = useMemo(
    () => new Set(openTabs.map((tab) => canonicalizeUrl(tab.url)).filter((url): url is string => Boolean(url))),
    [openTabs],
  );
  const virtualizer = useVirtualizer({
    count: displayRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => {
      const row = displayRows[index];
      return row?.kind === 'bookmark' || row?.kind === 'placeholder' ? 54 : 52;
    },
    overscan: 8,
  });

  const openContextMenu = useCallback((event: React.MouseEvent, items: ContextMenuItem[], label: string) => {
    event.preventDefault();
    event.stopPropagation();
    setOverflowCloseToken((token) => token + 1);
    setContextMenu({ x: event.clientX, y: event.clientY, items, label });
  }, []);
  const onOpenOverflow = useCallback(() => setContextMenu(null), []);

  const toggleFolder = useCallback((folderId: string) => {
    startTransition(() => {
      setCollapsedFolders((current) => {
        const next = toggleCollapsedFolderId(current, folderId);
        void chrome.storage.local.set({ [COLLAPSED_BOOKMARK_FOLDERS_KEY]: next });
        return new Set(next);
      });
    });
  }, []);

  const loadInboxSuggestions = useCallback(async () => {
    return Promise.all(inbox.map(async (bookmark) => {
      try {
        const result = await request<{
          bookmark: BookmarkRecord;
          suggestion: BookmarkFolderSuggestion | null;
        } | null>({ type: 'SUGGEST_BOOKMARK_FILE', bookmarkId: bookmark.id });
        return {
          bookmark: result?.bookmark ?? bookmark,
          suggestion: result?.suggestion ?? null,
        };
      } catch {
        return { bookmark, suggestion: null };
      }
    }));
  }, [inbox, request]);

  const openReviewSheet = useCallback(async (focusBookmarkId?: string) => {
    if (!inbox.length) return;
    setBusy('review');
    try {
      setReviewSheet({ rows: await loadInboxSuggestions(), focusBookmarkId });
    } catch (error) {
      showToast({ id: `${Date.now()}`, tone: 'error', message: error instanceof Error ? error.message : t('actionFailed') });
    } finally {
      setBusy(null);
    }
  }, [inbox.length, loadInboxSuggestions, showToast, t]);

  const refreshOrganizeSnapshots = useCallback(async () => {
    try {
      const list = await request<BookmarkOrganizeSnapshotSummary[]>({ type: 'GET_BOOKMARK_ORGANIZE_SNAPSHOTS' });
      setOrganizeSnapshots(Array.isArray(list) ? list : []);
    } catch {
      setOrganizeSnapshots([]);
    }
  }, [request]);

  const refreshTopicReady = useCallback(async () => {
    const status = await getBuiltInAiStatus();
    setBuiltInAvailable(status === 'available');
  }, []);

  const revokeOrganizeAnalyze = useCallback(() => {
    analyzeGen.current += 1;
    setAnalyzing(false);
    setTopicResult(null);
  }, []);

  const closeOrganize = useCallback(() => {
    revokeOrganizeAnalyze();
    setHealthOpen(false);
  }, [revokeOrganizeAnalyze]);

  const openOrganize = useCallback(() => {
    revokeOrganizeAnalyze();
    setHealthOpen((open) => {
      if (open) return false;
      void refreshOrganizeSnapshots();
      void refreshTopicReady();
      return true;
    });
  }, [refreshOrganizeSnapshots, refreshTopicReady, revokeOrganizeAnalyze]);

  const applyFiling = useCallback(async (
    plan: {
      creates: Array<{ clientId: string; parentId: string; title: string }>;
      moves: Array<{ bookmarkId: string; folderId: string }>;
    },
    rowCount = reviewSheet?.rows.length ?? 0,
    toast: 'filed' | 'organized' = 'filed',
  ) => {
    setBusy('filing');
    try {
      const result = await request<{ moved: number; skipped: number }>({
        type: 'APPLY_BOOKMARK_FILING',
        creates: plan.creates,
        moves: plan.moves,
      });
      const userSkipped = Math.max(0, rowCount - plan.moves.length);
      const skipped = userSkipped + result.skipped;
      const firstFolderId = plan.moves[0]?.folderId;
      const createdTitle = plan.creates.find((create) => create.clientId === firstFolderId)?.title;
      const folderTitle = createdTitle
        ?? availableFolders.find((folder) => folder.id === firstFolderId)?.title
        ?? '';
      const filed = toast === 'organized'
        ? t('bookmarksOrganized', { count: result.moved })
        : t('bookmarksFiled', { count: result.moved, folder: folderTitle });
      showToast({
        id: `${Date.now()}`,
        tone: result.moved > 0 ? 'success' : 'neutral',
        message: skipped > 0 ? `${filed} ${t('bookmarksSkipped', { count: skipped })}` : filed,
        ...(result.moved > 0 ? { action: 'undo' as const } : {}),
      });
      setReviewSheet(null);
      closeOrganize();
      onDismissSuggestion();
    } catch (error) {
      showToast({ id: `${Date.now()}`, tone: 'error', message: error instanceof Error ? error.message : t('actionFailed') });
    } finally {
      setBusy(null);
    }
  }, [availableFolders, closeOrganize, onDismissSuggestion, request, reviewSheet?.rows.length, showToast, t]);

  const applyOrganizeFiling = useCallback(async (customProposal?: BookmarkOrganizeProposal, scope?: BookmarkOrganizeScope) => {
    const proposal = customProposal ?? topicResult?.proposal ?? proposeBookmarkOrganize({ bookmarks, folders, scope });
    if (!proposal.moves.length) {
      showToast({ id: `${Date.now()}`, tone: 'neutral', message: t('organizeNothingToApply') });
      return;
    }
    analyzeGen.current += 1;
    setAnalyzing(false);
    setBusy('organize');
    try {
      const result = await request<{ moved: number; skipped: number; snapshotSaved: boolean }>({
        type: 'APPLY_BOOKMARK_ORGANIZE',
        creates: proposal.creates,
        moves: proposal.moves,
        scope,
      });
      if (result.moved === 0) {
        showToast({ id: `${Date.now()}`, tone: 'neutral', message: t('organizeNothingToApply') });
        closeOrganize();
        await refreshOrganizeSnapshots();
        return;
      }
      const organized = t('bookmarksOrganized', { count: result.moved });
      showToast({
        id: `${Date.now()}`,
        tone: result.snapshotSaved === false ? 'warning' : 'success',
        message: result.snapshotSaved === false
          ? t('organizeSnapshotSaveFailed')
          : result.skipped > 0 ? `${organized} ${t('bookmarksSkipped', { count: result.skipped })}` : organized,
        action: 'undo',
      });
      setTopicResult(null);
      setHealthOpen(false);
      await refreshOrganizeSnapshots();
    } catch (error) {
      showToast({ id: `${Date.now()}`, tone: 'error', message: error instanceof Error ? error.message : t('actionFailed') });
    } finally {
      setBusy(null);
    }
  }, [bookmarks, closeOrganize, folders, refreshOrganizeSnapshots, request, showToast, t, topicResult]);

  const analyzeOrganizeTopic = useCallback(async (scope?: BookmarkOrganizeScope) => {
    const generation = analyzeGen.current + 1;
    analyzeGen.current = generation;
    setTopicResult(null);
    setAnalyzing(true);
    try {
      if (cloudReady) {
        const result = await request<{
          granted?: boolean;
          proposal?: BookmarkOrganizeProposal;
          source?: 'topic-model' | 'host-heuristic';
          analyzedCount?: number;
          eligibleCount?: number;
        }>({ type: 'ANALYZE_BOOKMARK_ORGANIZE', scope });
        if (analyzeGen.current !== generation) return;
        if (result?.granted && result.source === 'topic-model' && result.proposal) {
          setTopicResult({
            proposal: result.proposal,
            analyzedCount: result.analyzedCount ?? 0,
            eligibleCount: result.eligibleCount ?? 0,
          });
          return;
        }
        if (result?.granted !== false && result?.source !== 'topic-model' && (result?.eligibleCount ?? 0) > 0) {
          showToast({ id: `${Date.now()}`, tone: 'warning', message: t('organizeTopicFailed') });
        }
        return;
      }
      const status = await getBuiltInAiStatus();
      if (analyzeGen.current !== generation) return;
      if (status !== 'available') {
        showToast({ id: `${Date.now()}`, tone: 'warning', message: t('organizeTopicFailed') });
        return;
      }
      const { eligible, analyzed } = selectAnalyzeBookmarks(bookmarks, folders, scope);
      const raw = await requestTopicOrganizeJson(
        buildTopicAnalyzePayload(analyzed, folders, settings.language, scope),
        'local-model',
        settings,
        '',
      );
      if (analyzeGen.current !== generation) return;
      const topic = topicProposalFromModel(raw, bookmarks, folders, scope);
      if (!topic.clusters.length) {
        showToast({ id: `${Date.now()}`, tone: 'warning', message: t('organizeTopicFailed') });
        return;
      }
      setTopicResult({
        proposal: mergeTopicWithHostOrganize(topic, bookmarks, folders, scope),
        analyzedCount: analyzed.length,
        eligibleCount: eligible.length,
      });
    } catch {
      if (analyzeGen.current !== generation) return;
      showToast({ id: `${Date.now()}`, tone: 'warning', message: t('organizeTopicFailed') });
    } finally {
      if (analyzeGen.current === generation) setAnalyzing(false);
    }
  }, [bookmarks, cloudReady, folders, request, settings, showToast, t]);

  const restoreOrganizeSnapshot = useCallback(async (snapshotId: string) => {
    const snapshot = organizeSnapshots.find((item) => item.id === snapshotId);
    if (!snapshot) return;
    const time = formatOrganizeSnapshotTime(snapshot.createdAt, settings.language);
    if (!window.confirm(t('organizeRestoreConfirm', { time }))) return;
    revokeOrganizeAnalyze();
    setBusy('restore');
    try {
      const result = await request<{ moved: number; skipped: number }>({
        type: 'RESTORE_BOOKMARK_ORGANIZE',
        snapshotId,
      });
      const restored = t('organizeRestored', { count: result.moved });
      showToast({
        id: `${Date.now()}`,
        tone: result.moved > 0 ? 'success' : 'neutral',
        message: result.skipped > 0 ? `${restored} ${t('bookmarksSkipped', { count: result.skipped })}` : restored,
      });
      await refreshOrganizeSnapshots();
    } catch (error) {
      showToast({ id: `${Date.now()}`, tone: 'error', message: error instanceof Error ? error.message : t('actionFailed') });
    } finally {
      setBusy(null);
    }
  }, [organizeSnapshots, refreshOrganizeSnapshots, request, revokeOrganizeAnalyze, settings.language, showToast, t]);

  const applyDedup = useCallback(async () => {
    if (!healthGroups.length) return;
    setBusy('dedup');
    try {
      const result = await request<{ removed: number }>({ type: 'APPLY_BOOKMARK_DEDUP', groups: healthGroups });
      showToast({
        id: `${Date.now()}`,
        tone: result.removed > 0 ? 'success' : 'neutral',
        message: t('duplicateBookmarksRemoved', { count: result.removed }),
        ...(result.removed > 0 ? { action: 'undo' as const } : {}),
      });
      setHealthOpen(false);
      revokeOrganizeAnalyze();
    } catch (error) {
      showToast({ id: `${Date.now()}`, tone: 'error', message: error instanceof Error ? error.message : t('actionFailed') });
    } finally {
      setBusy(null);
    }
  }, [healthGroups, request, revokeOrganizeAnalyze, showToast, t]);

  const reviewInboxFromHealth = useCallback(() => {
    closeOrganize();
    void openReviewSheet();
  }, [closeOrganize, openReviewSheet]);

  useEffect(() => {
    if (permissionGranted === false) {
      revokeOrganizeAnalyze();
      setHealthOpen(false);
    }
  }, [permissionGranted, revokeOrganizeAnalyze]);

  useEffect(() => () => { analyzeGen.current += 1; }, []);

  useEffect(() => {
    if (!healthOpen) return;
    void refreshTopicReady();
  }, [healthOpen, hasCloudApiKey, refreshTopicReady, settings.aiProvider]);

  useEffect(() => {
    if (!onChromeChange) return;
    if (permissionGranted !== true) {
      onChromeChange(null);
      return;
    }
    onChromeChange({
      inboxCount: inbox.length,
      openOrganize,
      openExport: () => setExportOpen(true),
      openReview: () => { void openReviewSheet(); },
    });
    return () => onChromeChange(null);
  }, [inbox.length, onChromeChange, openOrganize, openReviewSheet, permissionGranted]);

  const runBookmarkAction = useCallback(async (message: ZenTabMessage) => {
    try {
      await request(message);
      const undoKey = bookmarkUndoToastKey(message.type);
      if (undoKey) showToast({ id: `${Date.now()}`, tone: 'success', message: t(undoKey), action: 'undo' });
    } catch (error) {
      showToast({ id: `${Date.now()}`, tone: 'error', message: error instanceof Error ? error.message : t('actionFailed') });
    }
  }, [request, showToast, t]);

  const openBookmarkUrls = useCallback(async (urls: string[]) => {
    if (!urls.length) return;
    if (urls.length > 15 && !window.confirm(t('openAllBookmarksConfirm', { count: urls.length }))) return;
    await runBookmarkAction({ type: 'OPEN_BOOKMARK_URLS', urls });
  }, [runBookmarkAction, t]);

  const createFolderUnder = useCallback((parentId: string | undefined) => {
    if (!parentId) return;
    setEditDraft({ kind: 'create-folder', parentId, title: '' });
  }, []);

  const saveEdit = useCallback(async (value: { title: string; url?: string }) => {
    if (!editDraft) return;
    const title = value.title.trim();
    if (!title) return;
    if (editDraft.kind === 'create-folder') {
      await runBookmarkAction({ type: 'CREATE_BOOKMARK_FOLDER', parentId: editDraft.parentId, title });
      setEditDraft(null);
      return;
    }
    await runBookmarkAction({
      type: 'UPDATE_BOOKMARK',
      id: editDraft.id,
      title,
      ...(value.url !== undefined ? { url: value.url } : {}),
    });
    setEditDraft(null);
  }, [editDraft, runBookmarkAction]);

  const siblings = useMemo(() => [
    ...folders.map((folder) => ({ id: folder.id, index: folder.index, parentId: folder.parentId ?? '' })),
    ...bookmarks.map((bookmark) => ({ id: bookmark.id, index: bookmark.index, parentId: bookmark.parentId })),
  ], [bookmarks, folders]);
  const visibleRowsRef = useRef(visibleRows);
  visibleRowsRef.current = visibleRows;
  const foldersRef = useRef(folders);
  foldersRef.current = folders;
  const otherRootIdRef = useRef(otherRootId);
  otherRootIdRef.current = otherRootId;
  const siblingsRef = useRef(siblings);
  siblingsRef.current = siblings;
  const collapsedFoldersRef = useRef(collapsedFolders);
  collapsedFoldersRef.current = collapsedFolders;
  const hitRef = useRef<{ over: BookmarkDragOver | null; placement?: 'before' | 'after' }>({ over: null });
  const lastHitRef = useRef<{ over: BookmarkDragOver; placement?: 'before' | 'after' } | null>(null);

  const springTimerRef = useRef<{ folderId: string; timer: number } | null>(null);
  const clearSpringTimer = () => {
    if (springTimerRef.current) {
      window.clearTimeout(springTimerRef.current.timer);
      springTimerRef.current = null;
    }
  };

  const { overlay, source: draggingId, onPointerDown: onBookmarkPointerDown, consumeSuppressedClick } = usePointerDragSession<string>({
    enabled: sortableEnabled,
    scrollerRef: scrollRef,
    onActivate: (sourceId) => {
      clearSpringTimer();
      lastHitRef.current = null;
      hitRef.current = { over: null };
      setVisualRows(placeBookmarkPlaceholder(visibleRowsRef.current, sourceId, { type: 'origin' }));
    },
    onDrag: (sourceId, point) => {
      const scroller = scrollRef.current;
      const scrollerRect = scroller?.getBoundingClientRect();
      const localX = scrollerRect ? point.x - scrollerRect.left : undefined;
      const raw = readBookmarkDragOver(
        point.x,
        point.y,
        foldersRef.current,
        sourceId,
        collapsedFoldersRef.current,
        localX,
      );
      const lastRowBottom = scroller
        ? [...scroller.querySelectorAll('[data-bookmark-drop]')].reduce((bottom, node) => Math.max(bottom, node.getBoundingClientRect().bottom), 0) || null
        : null;
      const source = parseBookmarkDragSource(sourceId);
      const lastVisibleTarget = findLastVisibleDropTarget(visibleRowsRef.current, sourceId, source?.type);
      const measured = coerceBookmarkDragHit(raw, {
        draggedKey: sourceId,
        clientY: point.y,
        lastRowBottom,
        scrollerTop: scrollerRect?.top ?? 0,
        scrollerBottom: scrollerRect?.bottom ?? 0,
        lastVisibleTarget,
      });
      const inList = Boolean(scrollerRect && point.y >= scrollerRect.top && point.y <= scrollerRect.bottom);
      const hit = rememberTabDragHit(lastHitRef.current, measured, inList);
      lastHitRef.current = hit;
      hitRef.current = { over: hit?.over ?? null, placement: hit?.placement };
      setVisualRows(placeBookmarkPlaceholder(visibleRowsRef.current, sourceId, bookmarkPlaceholderDest(sourceId, hit)));
      setTabDragOverId(hit?.over && (
        hit.over.kind === 'bookmark-inbox'
        || hit.over.kind === 'bookmark-folder'
      ) ? formatTabDragId(hit.over) : null);

      const hoveredFolderId = hit?.over && hit.over.kind === 'bookmark-folder' ? hit.over.folderId : null;
      if (source?.type !== 'folder' && hoveredFolderId && collapsedFoldersRef.current.has(hoveredFolderId)) {
        if (springTimerRef.current?.folderId !== hoveredFolderId) {
          clearSpringTimer();
          springTimerRef.current = {
            folderId: hoveredFolderId,
            timer: window.setTimeout(() => {
              setCollapsedFolders((current) => {
                if (!current.has(hoveredFolderId)) return current;
                const next = new Set(current);
                next.delete(hoveredFolderId);
                void chrome.storage.local.set({ [COLLAPSED_BOOKMARK_FOLDERS_KEY]: Array.from(next) });
                return next;
              });
            }, 500),
          };
        }
      } else {
        clearSpringTimer();
      }
    },
    onFinish: (sourceId, canceled) => {
      clearSpringTimer();
      const hit = hitRef.current;
      hitRef.current = { over: null };
      lastHitRef.current = null;
      setTabDragOverId(null);
      if (canceled) {
        setVisualRows(null);
        return;
      }
      const source = parseBookmarkDragSource(sourceId);
      if (!source) {
        setVisualRows(null);
        return;
      }
      const result = resolveBookmarkDragEnd({
        source,
        over: hit.over,
        placement: hit.placement,
        otherBookmarksRootId: otherRootIdRef.current,
        folders: foldersRef.current,
        siblings: siblingsRef.current,
      });
      if (result.type !== 'move') {
        setVisualRows(null);
        return;
      }
      setVisualRows((current) => current
        ? settleBookmarkPlaceholder(current, visibleRowsRef.current, sourceId)
        : null);

      if (collapsedFolders.has(result.parentId)) {
        setCollapsedFolders((current) => {
          const next = new Set(current);
          next.delete(result.parentId);
          void chrome.storage.local.set({ [COLLAPSED_BOOKMARK_FOLDERS_KEY]: Array.from(next) });
          return next;
        });
      }

      const sourceSibling = siblingsRef.current.find((sibling) => sibling.id === result.id);
      const isSameParent = sourceSibling?.parentId === result.parentId;

      if (isSameParent) {
        void request({
          type: 'MOVE_BOOKMARK',
          id: result.id,
          parentId: result.parentId,
          ...(result.index !== undefined ? { index: result.index } : {}),
        }).catch((error) => {
          showToast({ id: `${Date.now()}`, tone: 'error', message: error instanceof Error ? error.message : t('actionFailed') });
        });
      } else {
        void runBookmarkAction({
          type: 'MOVE_BOOKMARK',
          id: result.id,
          parentId: result.parentId,
          ...(result.index !== undefined ? { index: result.index } : {}),
        });
      }
    },
  });

  const draggingRef = useRef(false);
  draggingRef.current = draggingId != null;
  useEffect(() => {
    if (draggingRef.current) return;
    setVisualRows(null);
  }, [visibleRows]);

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

  const iconsForUrls = (urls: string[]) => pickFaviconStack(urls.map((url) => resolveBookmarkFavicon(
    url,
    openTabs,
    faviconGranted ? chromeFaviconUrl(url, (path) => chrome.runtime.getURL(path)) : undefined,
  )));

  const rowActions = (bookmark: BookmarkRecord, inTray: boolean): ContextMenuItem[] => buildBookmarkRowContextSpecs({
    t,
    isInbox: inTray,
    canMutate: canMutateRecord(bookmark, folders),
  }).map((spec) => ({
    ...spec,
    icon: spec.id === 'open' ? <Globe2 size={14} /> : spec.id === 'file' ? <Bookmark size={14} /> : spec.id === 'edit' ? <Pencil size={14} /> : spec.id === 'delete' ? <Trash2 size={14} /> : undefined,
    onSelect: () => {
      if (spec.id === 'open') void openBookmarkUrls([bookmark.url]);
      if (spec.id === 'file') void openReviewSheet(bookmark.id);
      if (spec.id === 'edit') setEditDraft({ kind: 'bookmark', id: bookmark.id, title: bookmark.title, url: bookmark.url });
      if (spec.id === 'delete') void runBookmarkAction({ type: 'REMOVE_BOOKMARK', id: bookmark.id });
    },
  }));

  const folderActions = (folder: BookmarkFolderRecord, collapsed: boolean): ContextMenuItem[] => {
    const children = folderChildren.get(folder.id) ?? [];
    return buildBookmarkGroupContextSpecs({
      t,
      collapsed,
      canMutate: canMutateRecord(folder, folders),
      isSpecialRoot: folder.isSpecialRoot,
    }).map((spec) => ({
      ...spec,
      icon: spec.id === 'new-folder' ? <FolderPlus size={14} /> : spec.id === 'rename' ? <Pencil size={14} /> : spec.id === 'delete' ? <Trash2 size={14} /> : spec.id === 'open-all' ? <Globe2 size={14} /> : undefined,
      onSelect: () => {
        if (spec.id === 'expand' || spec.id === 'collapse') toggleFolder(folder.id);
        if (spec.id === 'open-all') void openBookmarkUrls(collectFolderUrls(children));
        if (spec.id === 'new-folder') void createFolderUnder(folder.id);
        if (spec.id === 'rename') setEditDraft({ kind: 'folder', id: folder.id, title: folder.title });
        if (spec.id === 'delete' && window.confirm(t('deleteFolderConfirm'))) {
          void runBookmarkAction({ type: 'REMOVE_BOOKMARK_FOLDER', id: folder.id });
        }
      },
    }));
  };

  const inboxActions = (): ContextMenuItem[] => [
    {
      id: collapsedFolders.has(INBOX_COLLAPSE_ID) ? 'expand' : 'collapse',
      label: collapsedFolders.has(INBOX_COLLAPSE_ID) ? t('expandFolder') : t('collapseFolder'),
      onSelect: () => toggleFolder(INBOX_COLLAPSE_ID),
    },
    { id: 'open-all', label: t('openAllBookmarks'), icon: <Globe2 size={14} />, onSelect: () => { void openBookmarkUrls(inbox.map((bookmark) => bookmark.url)); } },
    { id: 'review', label: t('reviewInbox'), icon: <Bookmark size={14} />, onSelect: () => { void openReviewSheet(); } },
    ...(otherRootId ? [{ id: 'new-folder', label: t('newBookmarkFolder'), icon: <FolderPlus size={14} />, onSelect: () => { void createFolderUnder(otherRootId); } }] : []),
  ];

  const renderBookmarkRow = (bookmark: BookmarkRecord, inTray: boolean) => {
    const canonical = canonicalizeUrl(bookmark.url);
    const hasOpenTab = Boolean(canonical && openCanonicalUrls.has(canonical));
    const icon = resolveBookmarkFavicon(
      bookmark.url,
      openTabs,
      faviconGranted ? chromeFaviconUrl(bookmark.url, (path) => chrome.runtime.getURL(path)) : undefined,
    );
    const rowId = formatBookmarkRowId(bookmark.id);
    const items = [
      ...rowActions(bookmark, inTray),
      ...(canEnrich && hasOpenTab ? [{
        id: 'enrich',
        label: t('enrichBookmark'),
        icon: <Sparkles size={14} />,
        onSelect: () => { void enrichBookmark(bookmark); },
        disabled: busy === bookmark.id,
      }] : []),
    ];
    return <BookmarkCard
      bookmark={bookmark}
      host={hostLabel(bookmark.url)}
      icon={icon}
      dragging={draggingId === rowId}
      canDrag={sortableEnabled && canMutateRecord(bookmark, folders)}
      items={items}
      t={t}
      overflowCloseToken={overflowCloseToken}
      onOpenOverflow={onOpenOverflow}
      onPointerDown={(event) => onBookmarkPointerDown(rowId, event)}
      onOpen={() => { if (!consumeSuppressedClick()) void openBookmarkUrls([bookmark.url]); }}
      onContextMenu={(event) => openContextMenu(event, items, bookmark.title || bookmark.url)}
    />;
  };

  const renderFolderRow = (folder: BookmarkFolderRecord, count: number, collapsed: boolean, sticky = false) => {
    const children = folderChildren.get(folder.id) ?? [];
    const surface = folderSurfaceColor(folder.id);
    const folderRowId = formatBookmarkFolderRowId(folder.id);
    const items = folderActions(folder, collapsed);
    return <BookmarkGroupRow
      name={folder.title}
      count={count}
      collapsed={collapsed}
      icons={iconsForUrls(collectFolderUrls(children, 8))}
      surface={surface}
      rail
      droppable={{ kind: 'bookmark-folder', folderId: folder.id }}
      dropId={sticky ? undefined : folderRowId}
      parentId={sticky ? undefined : folder.parentId ?? ''}
      index={sticky ? undefined : folder.index}
      dragging={!sticky && draggingId === folderRowId}
      canDrag={sortableEnabled && !sticky && canMutateRecord(folder, folders)}
      items={items}
      t={t}
      overflowCloseToken={overflowCloseToken}
      onOpenOverflow={onOpenOverflow}
      onToggle={() => { if (!consumeSuppressedClick()) toggleFolder(folder.id); }}
      onPointerDown={sticky ? undefined : (event) => onBookmarkPointerDown(folderRowId, event)}
      onContextMenu={(event) => openContextMenu(event, items, folder.title)}
    />;
  };

  const renderInboxHeader = (count: number, collapsed: boolean, _sticky = false) => (
    <BookmarkGroupRow
      name={t('bookmarkInbox')}
      count={count}
      collapsed={collapsed}
      icons={iconsForUrls(inbox.map((bookmark) => bookmark.url))}
      surface={INBOX_SURFACE_COLOR}
      droppable={{ kind: 'bookmark-inbox' }}
      items={inboxActions()}
      t={t}
      hint={t('bookmarkInboxHint')}
      overflowCloseToken={overflowCloseToken}
      onOpenOverflow={onOpenOverflow}
      onToggle={() => toggleFolder(INBOX_COLLAPSE_ID)}
      onContextMenu={(event) => openContextMenu(event, inboxActions(), t('bookmarkInbox'))}
    />
  );

  const showEmpty = !loading && visibleRows.length === 0;
  const virtualItems = virtualizer.getVirtualItems();
  const scrollOffset = virtualizer.scrollOffset ?? 0;
  const firstVisibleIndex = firstViewportIndex(virtualItems, scrollOffset);
  const stickyCandidate = resolveStickyGroup(displayRows, firstVisibleIndex, BOOKMARK_STICKY_KINDS);
  const stickyItem = stickyCandidate
    ? virtualItems.find((item) => item.index === displayRows.indexOf(stickyCandidate))
    : undefined;
  const stickyRow = stickyCandidate
    && (!stickyItem || stickyHeaderHasScrolledAway(stickyItem.start, stickyItem.size, scrollOffset))
    ? stickyCandidate
    : null;

  const renderRow = (row: BookmarkDisplayRow, sticky = false) => {
    if (row.kind === 'placeholder') return <div className="tab-drop-placeholder" aria-hidden="true" />;
    if (row.kind === 'empty-slot') {
      return <div
        className="bookmark-empty-slot"
        data-bookmark-drop={`bookmark-empty-slot-${row.folderId}`}
        data-bookmark-parent={row.folderId}
        data-bookmark-index={0}
      >
        <span>{t('emptyFolderDropHint')}</span>
      </div>;
    }
    if (row.kind === 'inbox') return renderInboxHeader(row.count, row.collapsed, sticky);
    if (row.kind === 'search') {
      return <BookmarkGroupRow
        name={t('bookmarkSearchResults')}
        count={row.count}
        collapsed={false}
        icons={[]}
        items={[]}
        t={t}
        overflowCloseToken={overflowCloseToken}
        onOpenOverflow={onOpenOverflow}
      />;
    }
    if (row.kind === 'folder') return renderFolderRow(row.folder, row.count, row.collapsed, sticky);
    return renderBookmarkRow(row.bookmark, row.inbox);
  };

  return <div className="bookmark-view">
    {filingSuggestion && <div className="bookmark-suggestion">
      <Sparkles size={15} />
      <div>
        <strong>{filingSuggestion.title || filingSuggestion.url}</strong>
        <span>{filingSuggestion.suggestion
          ? t('bookmarkSuggestedFolder', { folder: filingSuggestion.suggestion.folderTitle })
          : t('bookmarkChooseFolder')}</span>
      </div>
      <button className="small-button" disabled={busy === 'review'} onClick={() => void openReviewSheet(filingSuggestion.bookmarkId)}>{t('review')}</button>
      <button className="icon-button subtle" onClick={onDismissSuggestion} aria-label={t('dismiss')}><X size={13} /></button>
    </div>}

    <div className={draggingId ? 'tree-scroller is-dragging bookmark-tree' : 'tree-scroller bookmark-tree'} ref={scrollRef}>
      {showEmpty ? <div className="empty-state bookmark-empty">
        <div className="empty-orbit"><Bookmark size={20} /></div>
        <strong>{searching ? t('noMatchingBookmarks') : t('noBookmarksYet')}</strong>
        <p>{searching ? t('tryDifferentBookmarkSearch') : t('saveBookmarkToAppear')}</p>
      </div> : <>
        {stickyRow && stickyRow.kind !== 'bookmark' && stickyRow.kind !== 'placeholder' && stickyRow.kind !== 'empty-slot' && <div className="sticky-group-header">{renderRow(stickyRow, true)}</div>}
        <div className={draggingId ? 'tree-canvas is-sorting' : 'tree-canvas'} style={{ height: virtualizer.getTotalSize() }}>
          {virtualItems.map((virtualRow) => {
            const row = displayRows[virtualRow.index];
            if (!row) return null;
            const rowKey = row.kind === 'bookmark'
              ? `bookmark-${row.bookmark.id}`
              : row.kind === 'folder'
                ? `folder-${row.folder.id}`
                : row.kind === 'empty-slot'
                  ? `empty-slot-${row.folderId}`
                  : row.kind;
            const depth = row.kind === 'folder' || row.kind === 'bookmark' || row.kind === 'placeholder' || row.kind === 'empty-slot' ? row.depth : 0;
            return <div
              key={rowKey}
              ref={virtualizer.measureElement}
              data-index={virtualRow.index}
              className="tree-position"
              style={{ top: virtualRow.start, '--bookmark-depth': depth } as React.CSSProperties}
            >
              {renderRow(row)}
            </div>;
          })}
        </div>
        {draggingId && <div className="tree-list-end" aria-hidden="true" />}
      </>}
    </div>

    {reviewSheet && <BookmarkFilingSheet
      rows={reviewSheet.rows}
      folders={folders}
      t={t}
      busy={busy === 'filing'}
      focusBookmarkId={reviewSheet.focusBookmarkId}
      onClose={() => setReviewSheet(null)}
      onApply={(plan) => { void applyFiling(plan); }}
    />}

    {healthOpen && <BookmarkHealthSheet
      bookmarks={bookmarks}
      folders={folders}
      inboxCount={inbox.length}
      groups={healthGroups}
      t={t}
      busy={busy === 'dedup' || busy === 'organize' || busy === 'restore' || busy === 'review'}
      topicReady={topicReady}
      analyzing={analyzing}
      topicResult={topicResult}
      snapshots={organizeSnapshots}
      language={settings.language}
      faviconGranted={faviconGranted}
      openTabs={openTabs}
      onClose={closeOrganize}
      onApplyDedup={() => { void applyDedup(); }}
      onApplyOrganize={(plan, scope) => { void applyOrganizeFiling(plan, scope); }}
      onReviewInbox={reviewInboxFromHealth}
      onAnalyzeTopic={(scope) => { void analyzeOrganizeTopic(scope); }}
      onClearTopic={() => setTopicResult(null)}
      onRestoreSnapshot={(snapshotId) => { void restoreOrganizeSnapshot(snapshotId); }}
    />}

    {exportOpen && <BookmarkExportSheet
      folders={folders}
      bookmarks={bookmarks}
      t={t}
      onClose={() => setExportOpen(false)}
    />}

    {editDraft && <BookmarkEditPanel
      label={editDraft.kind === 'create-folder' ? t('newBookmarkFolder') : t('editBookmark')}
      titleLabel={editDraft.kind === 'create-folder' ? t('bookmarkFolderName') : undefined}
      title={editDraft.title}
      url={editDraft.kind === 'bookmark' ? editDraft.url : undefined}
      onTitleChange={(title) => setEditDraft({ ...editDraft, title })}
      onUrlChange={editDraft.kind === 'bookmark' ? (url) => setEditDraft({ ...editDraft, url }) : undefined}
      onSave={(value) => { void saveEdit(value); }}
      onClose={() => setEditDraft(null)}
      showToast={showToast}
      t={t}
    />}

    <ContextMenu open={Boolean(contextMenu)} x={contextMenu?.x ?? 0} y={contextMenu?.y ?? 0} items={contextMenu?.items ?? []} label={contextMenu?.label ?? t('bookmarks')} onClose={() => setContextMenu(null)} />
    {overlay && draggingId && <DragPreviewOverlay
      x={overlay.x}
      y={overlay.y}
      icon={dragPreviewIcon(draggingId, bookmarks, folders, openTabs, faviconGranted)}
      title={dragPreviewTitle(draggingId, bookmarks, folders)}
    />}
  </div>;
}

function dragPreviewIcon(
  draggingId: string,
  bookmarks: BookmarkRecord[],
  folders: BookmarkFolderRecord[],
  openTabs: TabRecord[],
  faviconGranted: boolean,
) {
  const source = parseBookmarkDragSource(draggingId);
  if (source?.type === 'bookmark') {
    const bookmark = bookmarks.find((item) => item.id === source.id);
    if (bookmark) {
      const icon = resolveBookmarkFavicon(
        bookmark.url,
        openTabs,
        faviconGranted ? chromeFaviconUrl(bookmark.url, (path) => chrome.runtime.getURL(path)) : undefined,
      );
      if (icon) return <img src={icon} alt="" />;
    }
    return <Globe2 size={14} />;
  }
  return folders.find((folder) => folder.id === source?.id) ? <Bookmark size={14} /> : <Globe2 size={14} />;
}

function dragPreviewTitle(
  draggingId: string,
  bookmarks: BookmarkRecord[],
  folders: BookmarkFolderRecord[],
): string {
  const source = parseBookmarkDragSource(draggingId);
  if (source?.type === 'bookmark') {
    const bookmark = bookmarks.find((item) => item.id === source.id);
    return bookmark?.title || bookmark?.url || '';
  }
  if (source?.type === 'folder') {
    return folders.find((folder) => folder.id === source.id)?.title ?? '';
  }
  return '';
}

function BookmarkGroupRow({
  name,
  count,
  collapsed,
  icons,
  surface,
  rail = false,
  droppable,
  dropId,
  parentId,
  index,
  dragging,
  canDrag,
  items,
  t,
  hint,
  overflowCloseToken,
  onOpenOverflow,
  onToggle,
  onPointerDown,
  onContextMenu,
}: {
  name: string;
  count: number;
  collapsed: boolean;
  icons: string[];
  surface?: { wash: string; dot: string };
  rail?: boolean;
  droppable?: DragSurface;
  dropId?: string;
  parentId?: string;
  index?: number;
  dragging?: boolean;
  canDrag?: boolean;
  items: ContextMenuItem[];
  t: Translator;
  hint?: string;
  overflowCloseToken: number;
  onOpenOverflow: () => void;
  onToggle?: () => void;
  onPointerDown?: (event: React.PointerEvent<HTMLElement>) => void;
  onContextMenu?: (event: React.MouseEvent) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => { setMenuOpen(false); }, [overflowCloseToken]);
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
  const shellClass = [
    'group-row-shell',
    rail ? 'has-rail' : '',
    dragging ? 'dragging' : '',
  ].filter(Boolean).join(' ');
  const style = surface
    ? { '--group-wash': surface.wash, '--group-dot': surface.dot } as React.CSSProperties
    : undefined;
  const body = <>
    {onToggle
      ? <button className={canDrag ? 'group-row is-draggable' : 'group-row'} type="button" onPointerDown={canDrag ? onPointerDown : undefined} onDragStart={(event) => event.preventDefault()} onClick={onToggle} aria-expanded={!collapsed} title={hint}>
        <span className="group-chevron">{collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}</span>
        {!rail && <span className="group-dot neutral" />}
        <span className="group-name">{name}</span>
        <span className="group-count">{count}</span>
        <FaviconStack icons={icons} />
      </button>
      : <div className="group-row">
        {!rail && <span className="group-dot neutral" />}
        <span className="group-name">{name}</span>
        <span className="group-count">{count}</span>
      </div>}
    {items.length > 0 && <button
      className="group-menu-button"
      type="button"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => { event.stopPropagation(); onOpenOverflow(); setMenuOpen((open) => !open); }}
      aria-label={`${t('moreActions')} ${name}`}
      aria-expanded={menuOpen}
      aria-haspopup="menu"
    ><MoreHorizontal size={15} /></button>}
    {menuOpen && <div className="group-popover" role="menu">
      {items.map((item) => <button
        key={item.id}
        type="button"
        role="menuitem"
        className={item.danger ? 'danger' : undefined}
        disabled={item.disabled}
        onClick={() => { item.onSelect(); setMenuOpen(false); }}
      >{item.icon}<span>{item.label}</span></button>)}
    </div>}
  </>;
  if (!droppable) {
    return <div className={shellClass} style={style} title={hint} onContextMenu={onContextMenu}>{body}</div>;
  }
  return <DroppableSurface
    surface={droppable}
    className={shellClass}
    style={style}
    title={hint}
    data-bookmark-drop={dropId}
    data-bookmark-parent={parentId}
    data-bookmark-index={index}
    onContextMenu={onContextMenu}
  >
    {(over) => <>
      {onToggle
        ? <button className={canDrag ? 'group-row is-draggable' : 'group-row'} type="button" onPointerDown={canDrag ? onPointerDown : undefined} onDragStart={(event) => event.preventDefault()} onClick={onToggle} aria-expanded={!collapsed}>
          <span className="group-chevron">{collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}</span>
          {!rail && <span className="group-dot neutral" />}
          <span className="group-name">{over ? t('dropToFile') : name}</span>
          <span className="group-count">{count}</span>
          <FaviconStack icons={icons} />
        </button>
        : <div className="group-row">
          <span className="group-name">{over ? t('dropToFile') : name}</span>
          <span className="group-count">{count}</span>
        </div>}
      {items.length > 0 && <button
        className="group-menu-button"
        type="button"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => { event.stopPropagation(); onOpenOverflow(); setMenuOpen((open) => !open); }}
        aria-label={`${t('moreActions')} ${name}`}
        aria-expanded={menuOpen}
        aria-haspopup="menu"
      ><MoreHorizontal size={15} /></button>}
      {menuOpen && <div className="group-popover" role="menu">
        {items.map((item) => <button
          key={item.id}
          type="button"
          role="menuitem"
          className={item.danger ? 'danger' : undefined}
          disabled={item.disabled}
          onClick={() => { item.onSelect(); setMenuOpen(false); }}
        >{item.icon}<span>{item.label}</span></button>)}
      </div>}
    </>}
  </DroppableSurface>;
}

const BookmarkCard = memo(function BookmarkCard({
  bookmark,
  host,
  icon,
  dragging,
  canDrag,
  items,
  t,
  overflowCloseToken,
  onOpenOverflow,
  onPointerDown,
  onOpen,
  onContextMenu,
}: {
  bookmark: BookmarkRecord;
  host: string;
  icon?: string;
  dragging: boolean;
  canDrag: boolean;
  items: ContextMenuItem[];
  t: Translator;
  overflowCloseToken: number;
  onOpenOverflow: () => void;
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onOpen: () => void;
  onContextMenu: (event: React.MouseEvent<HTMLDivElement>) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPlacement, setMenuPlacement] = useState<'up' | 'down'>('down');
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
  const rowId = formatBookmarkRowId(bookmark.id);
  return <div
    className={['tab-row', 'is-card', dragging ? 'dragging' : ''].filter(Boolean).join(' ')}
    data-bookmark-drop={rowId}
    data-bookmark-parent={bookmark.parentId}
    data-bookmark-index={bookmark.index}
    onContextMenu={onContextMenu}
  >
    <div
      className="tab-main"
      role="button"
      tabIndex={0}
      title={bookmark.url || bookmark.title}
      onPointerDown={canDrag ? onPointerDown : undefined}
      onDragStart={(event) => event.preventDefault()}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onOpen();
      }}
    >
      <span className="favicon-wrap">{icon
        ? <img src={icon} alt="" className="favicon" draggable={false} />
        : <Globe2 size={15} />}</span>
      <span className="tab-copy">
        <span className="tab-title">{bookmark.title || bookmark.url}</span>
        <span className="tab-host">{host}</span>
      </span>
    </div>
    <button className="row-menu" type="button" onPointerDown={(event) => event.stopPropagation()} onClick={toggleMenu} aria-label={t('actionsFor', { title: bookmark.title || bookmark.url })} aria-expanded={menuOpen} aria-haspopup="menu"><MoreHorizontal size={16} /></button>
    {menuOpen && <div className={menuPlacement === 'up' ? 'row-popover up' : 'row-popover'} role="menu">
      {items.map((item) => <button
        key={item.id}
        type="button"
        role="menuitem"
        className={item.danger ? 'danger' : undefined}
        disabled={item.disabled}
        onClick={() => { item.onSelect(); setMenuOpen(false); }}
      >{item.icon}<span>{item.label}</span></button>)}
    </div>}
  </div>;
});
