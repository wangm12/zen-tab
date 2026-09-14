import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, ChevronUp, Folder, FolderPlus, Globe2, Inbox, RefreshCw, Sparkles, X } from 'lucide-react';
import {
  BookmarkOrganizeCluster,
  BookmarkOrganizeProposal,
  canOrganizeBookmark,
  formatOrganizeSnapshotTime,
  organizeDestinationFolders,
  proposeBookmarkOrganize,
  visibleBookmarkOrganizeSnapshots,
} from '../shared/bookmark-organize';
import { BookmarkFilingCreate, BookmarkFilingMove } from '../shared/bookmark-filing';
import { chromeFaviconUrl, resolveBookmarkFavicon } from '../shared/bookmark-favicon';
import { otherBookmarksRootId } from '../shared/bookmarks';
import {
  BookmarkDuplicateGroup,
  BookmarkFolderRecord,
  BookmarkOrganizeScope,
  BookmarkOrganizeSnapshotSummary,
  BookmarkRecord,
  Language,
  TabRecord,
} from '../shared/types';
import { getHostname } from '../shared/url';
import { TranslationKey, Translator } from './i18n';
import { useFocusTrap } from './ui';

const PREVIEW_LIMIT = 4;

const ORGANIZE_SCOPES: Array<{ id: BookmarkOrganizeScope; labelKey: TranslationKey }> = [
  { id: 'unfiled', labelKey: 'organizeScopeUnfiled' },
  { id: 'bar', labelKey: 'organizeScopeBar' },
  { id: 'other', labelKey: 'organizeScopeOther' },
  { id: 'all', labelKey: 'organizeScopeAll' },
];

export function BookmarkHealthSheet({
  bookmarks,
  folders,
  inboxCount,
  groups,
  t,
  busy,
  topicReady,
  analyzing,
  topicResult,
  snapshots,
  language,
  faviconGranted,
  openTabs,
  onClose,
  onApplyDedup,
  onApplyOrganize,
  onReviewInbox,
  onAnalyzeTopic,
  onClearTopic,
  onRestoreSnapshot,
}: {
  bookmarks: BookmarkRecord[];
  folders: BookmarkFolderRecord[];
  inboxCount: number;
  groups: BookmarkDuplicateGroup[];
  t: Translator;
  busy: boolean;
  topicReady: boolean;
  analyzing: boolean;
  topicResult: null | { proposal: BookmarkOrganizeProposal; analyzedCount: number; eligibleCount: number };
  snapshots: BookmarkOrganizeSnapshotSummary[];
  language: Language;
  faviconGranted: boolean;
  openTabs: TabRecord[];
  onClose: () => void;
  onApplyDedup: () => void;
  onApplyOrganize: (effectivePlan: BookmarkOrganizeProposal, scope: BookmarkOrganizeScope) => void;
  onReviewInbox: () => void;
  onAnalyzeTopic: (scope: BookmarkOrganizeScope) => void;
  onClearTopic: () => void;
  onRestoreSnapshot: (snapshotId: string) => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, onClose);

  const [scope, setScope] = useState<BookmarkOrganizeScope>('unfiled');
  const [excludedBookmarkIds, setExcludedBookmarkIds] = useState<Set<string>>(() => new Set());
  const [clusterTargetOverrides, setClusterTargetOverrides] = useState<Map<string, string>>(() => new Map());
  const [expandedClusterKeys, setExpandedClusterKeys] = useState<Set<string>>(() => new Set());

  const foldersById = useMemo(() => new Map(folders.map((folder) => [folder.id, folder])), [folders]);
  const bookmarksById = useMemo(() => new Map(bookmarks.map((bookmark) => [bookmark.id, bookmark])), [bookmarks]);

  const scopeCandidateCounts = useMemo(() => {
    const counts: Record<BookmarkOrganizeScope, number> = {
      unfiled: 0,
      bar: 0,
      other: 0,
      all: 0,
    };
    for (const item of ORGANIZE_SCOPES) {
      counts[item.id] = bookmarks.filter((bookmark) =>
        canOrganizeBookmark(bookmark, folders, foldersById, item.id),
      ).length;
    }
    return counts;
  }, [bookmarks, folders, foldersById]);

  const destinations = useMemo(() => organizeDestinationFolders(folders, scope), [folders, scope]);

  const handleScopeChange = (newScope: BookmarkOrganizeScope) => {
    if (newScope === scope) return;
    setScope(newScope);
    setExcludedBookmarkIds(new Set());
    setClusterTargetOverrides(new Map());
    setExpandedClusterKeys(new Set());
    onClearTopic();
  };

  const hostProposal = useMemo(() => proposeBookmarkOrganize({ bookmarks, folders, scope }), [bookmarks, folders, scope]);
  const baseProposal = topicResult?.proposal ?? hostProposal;
  const actionsLocked = analyzing || busy;
  const visibleSnapshots = visibleBookmarkOrganizeSnapshots(snapshots, Date.now());
  const removeCount = groups.reduce((sum, group) => sum + group.removeIds.length, 0);

  const toggleBookmark = (bookmarkId: string) => {
    setExcludedBookmarkIds((current) => {
      const next = new Set(current);
      if (next.has(bookmarkId)) {
        next.delete(bookmarkId);
      } else {
        next.add(bookmarkId);
      }
      return next;
    });
  };

  const toggleCluster = (cluster: BookmarkOrganizeCluster) => {
    const isClusterAllIncluded = cluster.bookmarkIds.every((id) => !excludedBookmarkIds.has(id));
    setExcludedBookmarkIds((current) => {
      const next = new Set(current);
      if (isClusterAllIncluded) {
        for (const id of cluster.bookmarkIds) {
          next.add(id);
        }
      } else {
        for (const id of cluster.bookmarkIds) {
          next.delete(id);
        }
      }
      return next;
    });
  };

  const toggleExpandCluster = (clusterKey: string) => {
    setExpandedClusterKeys((current) => {
      const next = new Set(current);
      if (next.has(clusterKey)) {
        next.delete(clusterKey);
      } else {
        next.add(clusterKey);
      }
      return next;
    });
  };

  const handleTargetChange = (clusterKey: string, targetValue: string) => {
    setClusterTargetOverrides((current) => {
      const next = new Map(current);
      next.set(clusterKey, targetValue);
      return next;
    });
  };

  const effectivePlan = useMemo((): BookmarkOrganizeProposal => {
    const effectiveCreates: BookmarkFilingCreate[] = [];
    const effectiveMoves: BookmarkFilingMove[] = [];
    const createdByParentAndTitle = new Map<string, string>();
    const barRoot = folders.find((folder) => folder.folderKind === 'bar')?.id ?? '1';
    const otherRoot = otherBookmarksRootId(folders) ?? '2';
    const createRoot = scope === 'bar' ? barRoot : otherRoot;

    const effectiveClusters: BookmarkOrganizeCluster[] = [];

    for (const cluster of baseProposal.clusters) {
      const activeBookmarkIds = cluster.bookmarkIds.filter((id) => !excludedBookmarkIds.has(id));
      if (activeBookmarkIds.length === 0) continue;

      const defaultTarget = cluster.create ? '__new__' : (cluster.folderId ?? '__new__');
      const target = clusterTargetOverrides.get(cluster.key) ?? defaultTarget;

      if (target === '__new__') {
        const originalCreate = cluster.clientId
          ? baseProposal.creates.find((c) => c.clientId === cluster.clientId)
          : undefined;
        const title = originalCreate?.title ?? cluster.folderTitle;
        const parentId = originalCreate?.parentId ?? createRoot;
        const key = `${parentId}\0${title.toLowerCase()}`;

        let clientId = createdByParentAndTitle.get(key);
        if (!clientId) {
          clientId = originalCreate?.clientId ?? `organize-custom-${cluster.key.replace(/[^a-z0-9]+/g, '-')}`;
          createdByParentAndTitle.set(key, clientId);
          effectiveCreates.push({ clientId, parentId, title });
        }

        for (const bookmarkId of activeBookmarkIds) {
          effectiveMoves.push({ bookmarkId, folderId: clientId });
        }

        effectiveClusters.push({
          ...cluster,
          create: true,
          folderId: undefined,
          clientId,
          bookmarkIds: activeBookmarkIds,
        });
      } else {
        const targetFolderId = target;
        let clusterMovedCount = 0;
        for (const bookmarkId of activeBookmarkIds) {
          const bookmark = bookmarksById.get(bookmarkId);
          if (bookmark && bookmark.parentId === targetFolderId) {
            continue;
          }
          effectiveMoves.push({ bookmarkId, folderId: targetFolderId });
          clusterMovedCount++;
        }

        if (clusterMovedCount > 0 || activeBookmarkIds.length > 0) {
          effectiveClusters.push({
            ...cluster,
            create: false,
            folderId: targetFolderId,
            clientId: undefined,
            bookmarkIds: activeBookmarkIds,
          });
        }
      }
    }

    return {
      creates: effectiveCreates,
      moves: effectiveMoves,
      clusters: effectiveClusters,
    };
  }, [baseProposal, bookmarksById, clusterTargetOverrides, excludedBookmarkIds, folders, scope]);

  return createPortal(
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="modal-sheet bookmark-health-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('bookmarkOrganize')}
      >
        <header className="modal-header">
          <div>
            <span className="eyebrow">{t('bookmarkDedupEyebrow')}</span>
            <h2>{t('bookmarkOrganize')}</h2>
            <p>{t('bookmarkOrganizeDescription')}</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label={t('close')}>
            <X size={15} />
          </button>
        </header>
        <div className="modal-content bookmark-health-list">
          <div className="bookmark-organize-scope-bar">
            <div
              className="bookmark-organize-segmented-bar"
              role="tablist"
              aria-label={t('organizeScopeLabel')}
            >
              {ORGANIZE_SCOPES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={scope === item.id}
                  disabled={actionsLocked}
                  className={
                    scope === item.id
                      ? 'bookmark-organize-segmented-tab active'
                      : 'bookmark-organize-segmented-tab'
                  }
                  onClick={() => handleScopeChange(item.id)}
                >
                  <span className="bookmark-organize-tab-label">{t(item.labelKey)}</span>
                  <span className="bookmark-organize-tab-badge">
                    {scopeCandidateCounts[item.id]}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <section className="bookmark-health-section">
            <div className="bookmark-organize-section-header">
              <h3>{t('organizeClustersTitle')}</h3>
              <div className="bookmark-organize-toolbar">
                <button
                  type="button"
                  className={`bookmark-organize-tool-btn${analyzing ? ' is-analyzing' : ''}`}
                  disabled={!topicReady || actionsLocked}
                  onClick={() => onAnalyzeTopic(scope)}
                  title={!topicReady ? t('organizeNeedsModel') : undefined}
                >
                  {analyzing ? (
                    <RefreshCw size={13} className="text-accent spin" />
                  ) : (
                    <Sparkles size={13} className="text-accent" />
                  )}
                  <span>{analyzing ? t('organizeAnalyzing') : t('organizeByTopic')}</span>
                </button>
                <button
                  type="button"
                  className="bookmark-organize-tool-btn"
                  disabled={inboxCount === 0 || actionsLocked}
                  onClick={onReviewInbox}
                >
                  <Inbox size={13} />
                  <span>{t('reviewUnfiled')}</span>
                  {inboxCount > 0 && (
                    <span className="bookmark-organize-tool-badge">{inboxCount}</span>
                  )}
                </button>
                {topicResult ? (
                  <button
                    type="button"
                    className="bookmark-organize-tool-btn"
                    disabled={actionsLocked}
                    onClick={onClearTopic}
                  >
                    <span>{t('organizeShowHostClusters')}</span>
                  </button>
                ) : null}
              </div>
            </div>

            {analyzing ? (
              <div className="bookmark-organize-analyzing-state">
                <div className="bookmark-organize-ai-banner">
                  <div className="ai-banner-icon-wrap">
                    <Sparkles size={15} className="text-accent ai-sparkle-pulse" />
                  </div>
                  <div className="ai-banner-text">
                    <strong>{t('organizeAnalyzing')}</strong>
                  </div>
                </div>
                <div className="bookmark-organize-skeleton-list">
                  <div className="bookmark-organize-skeleton-card">
                    <div className="skeleton-header">
                      <div className="skeleton-checkbox shimmer" />
                      <div className="skeleton-title shimmer" style={{ width: '40%' }} />
                      <div className="skeleton-badge shimmer" style={{ width: '22%' }} />
                    </div>
                    <div className="skeleton-pill shimmer" style={{ width: '68%' }} />
                    <div className="skeleton-row shimmer" />
                    <div className="skeleton-row shimmer" style={{ width: '88%' }} />
                    <div className="skeleton-row shimmer" style={{ width: '72%' }} />
                  </div>
                  <div className="bookmark-organize-skeleton-card">
                    <div className="skeleton-header">
                      <div className="skeleton-checkbox shimmer" />
                      <div className="skeleton-title shimmer" style={{ width: '32%' }} />
                      <div className="skeleton-badge shimmer" style={{ width: '18%' }} />
                    </div>
                    <div className="skeleton-pill shimmer" style={{ width: '60%' }} />
                    <div className="skeleton-row shimmer" />
                    <div className="skeleton-row shimmer" style={{ width: '80%' }} />
                  </div>
                </div>
              </div>
            ) : (
              <>
                {topicResult ? (
                  <p className="bookmark-organize-status-note">
                    {t('organizeAnalyzedCount', {
                      analyzed: topicResult.analyzedCount,
                      eligible: topicResult.eligibleCount,
                    })}
                  </p>
                ) : null}
                {!topicReady ? (
                  <p className="bookmark-organize-status-note text-dim">{t('organizeNeedsModel')}</p>
                ) : null}

                {baseProposal.clusters.length === 0 ? (
                  <p className="bookmark-organize-status-note">{t('noOrganizeSuggestions')}</p>
                ) : (
                  <div className="bookmark-organize-list">
                {baseProposal.clusters.map((cluster) => {
                  const isClusterAllExcluded = cluster.bookmarkIds.every((id) =>
                    excludedBookmarkIds.has(id),
                  );
                  const isClusterAllIncluded = cluster.bookmarkIds.every(
                    (id) => !excludedBookmarkIds.has(id),
                  );
                  const isClusterPartiallyExcluded =
                    !isClusterAllExcluded && !isClusterAllIncluded;

                  const activeBookmarkCount = cluster.bookmarkIds.filter(
                    (id) => !excludedBookmarkIds.has(id),
                  ).length;

                  const defaultTarget = cluster.create
                    ? '__new__'
                    : (cluster.folderId ?? '__new__');
                  const currentTarget = clusterTargetOverrides.get(cluster.key) ?? defaultTarget;
                  const isNewFolder = currentTarget === '__new__';

                  const isExpanded = expandedClusterKeys.has(cluster.key);
                  const previewBookmarks = isExpanded
                    ? cluster.bookmarkIds
                    : cluster.bookmarkIds.slice(0, PREVIEW_LIMIT);
                  const extraCount = cluster.bookmarkIds.length - PREVIEW_LIMIT;

                  return (
                    <div
                      className={`bookmark-organize-card${isClusterAllExcluded ? ' excluded' : ''}`}
                      key={cluster.key}
                    >
                      <div className="bookmark-organize-card-header bookmark-organize-group-header">
                        <label className="bookmark-organize-checkbox-label">
                          <input
                            type="checkbox"
                            checked={isClusterAllIncluded}
                            ref={(element) => {
                              if (element) element.indeterminate = isClusterPartiallyExcluded;
                            }}
                            disabled={actionsLocked}
                            onChange={() => toggleCluster(cluster)}
                            aria-label={cluster.folderTitle}
                          />
                          <span className="bookmark-organize-folder-icon">
                            {isNewFolder ? (
                              <FolderPlus size={15} className="text-accent" />
                            ) : (
                              <Folder size={15} />
                            )}
                          </span>
                          <strong
                            className="bookmark-organize-folder-name"
                            title={cluster.folderTitle}
                          >
                            {cluster.folderTitle}
                          </strong>
                        </label>
                        <div className="bookmark-organize-header-meta">
                          <span
                            className={`bookmark-organize-badge ${isNewFolder ? 'new-folder' : 'existing-folder'}`}
                          >
                            {isNewFolder ? t('organizeCreateFolder') : t('organizeExistingFolder')}
                          </span>
                          <span className="bookmark-organize-group-count">
                            {t('organizeClusterCount', { count: activeBookmarkCount })}
                          </span>
                        </div>
                      </div>

                      <div className="bookmark-organize-target-pill">
                        <span className="bookmark-organize-target-label">
                          {t('organizeTargetFolder')}
                        </span>
                        <div className="bookmark-organize-select-wrapper">
                          <Folder size={12} className="bookmark-organize-select-icon" />
                          <select
                            className="bookmark-organize-select"
                            value={currentTarget}
                            disabled={actionsLocked}
                            onChange={(e) => handleTargetChange(cluster.key, e.target.value)}
                            aria-label={t('organizeTargetFolder')}
                          >
                            <option value="__new__">
                              {t('organizeNewFolderLabel', { name: cluster.folderTitle })}
                            </option>
                            {destinations.map((folder) => (
                              <option key={folder.id} value={folder.id}>
                                {folder.folderPath}
                              </option>
                            ))}
                            {cluster.folderId &&
                              !destinations.some((f) => f.id === cluster.folderId) && (
                                <option key={cluster.folderId} value={cluster.folderId}>
                                  {foldersById.get(cluster.folderId)?.folderPath ??
                                    cluster.folderTitle}
                                </option>
                              )}
                          </select>
                          <ChevronDown
                            size={12}
                            className="bookmark-organize-select-chevron"
                          />
                        </div>
                      </div>

                      <div className="bookmark-organize-items">
                        {previewBookmarks.map((id) => {
                          const bookmark = bookmarksById.get(id);
                          const isItemExcluded = excludedBookmarkIds.has(id);
                          const title = bookmark?.title || bookmark?.url || id;
                          const rawUrl = bookmark?.url ?? '';
                          const host = rawUrl ? getHostname(rawUrl).replace(/^www\./, '') : '';
                          const icon = rawUrl
                            ? resolveBookmarkFavicon(
                                rawUrl,
                                openTabs,
                                faviconGranted
                                  ? chromeFaviconUrl(rawUrl, (p) => chrome.runtime.getURL(p))
                                  : undefined,
                              )
                            : undefined;

                          return (
                            <label
                              key={id}
                              className={`bookmark-organize-item${isItemExcluded ? ' excluded' : ''}`}
                            >
                              <input
                                type="checkbox"
                                checked={!isItemExcluded}
                                disabled={actionsLocked}
                                onChange={() => toggleBookmark(id)}
                                aria-label={title}
                              />
                              <span className="favicon-wrap">
                                {icon ? (
                                  <img
                                    src={icon}
                                    alt=""
                                    className="favicon"
                                    draggable={false}
                                  />
                                ) : (
                                  <Globe2 size={13} />
                                )}
                              </span>
                              <span className="bookmark-organize-item-title" title={title}>
                                {title}
                              </span>
                              {host ? (
                                <span className="bookmark-organize-item-host" title={host}>
                                  {host}
                                </span>
                              ) : null}
                            </label>
                          );
                        })}
                      </div>

                      {extraCount > 0 && (
                        <button
                          type="button"
                          className="bookmark-organize-expand-btn text-button"
                          disabled={actionsLocked}
                          onClick={() => toggleExpandCluster(cluster.key)}
                        >
                          {isExpanded ? (
                            <>
                              <span>{t('organizeShowLess')}</span>
                              <ChevronUp size={12} />
                            </>
                          ) : (
                            <>
                              <span>{t('organizeMoreBookmarks', { count: extraCount })}</span>
                              <ChevronDown size={12} />
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </section>

          {visibleSnapshots.length > 0 ? (
            <section className="bookmark-health-section bookmark-organize-snapshots-section">
              <h3>{t('organizeSnapshotsTitle')}</h3>
              <div className="bookmark-organize-list">
                {visibleSnapshots.map((snapshot) => {
                  const time = formatOrganizeSnapshotTime(snapshot.createdAt, language);
                  return (
                    <div
                      className="bookmark-organize-snapshot-card bookmark-organize-snapshot"
                      key={snapshot.id}
                    >
                      <div className="bookmark-organize-meta">
                        <strong>{time}</strong>
                        <button
                          className="small-button"
                          disabled={actionsLocked}
                          onClick={() => onRestoreSnapshot(snapshot.id)}
                        >
                          {t('organizeRestore')}
                        </button>
                      </div>
                      <small>
                        {t('organizeSnapshotMeta', {
                          count: snapshot.moveCount,
                          days: snapshot.daysLeft,
                        })}
                      </small>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}

          <section className="bookmark-health-section bookmark-dedup-section">
            <div className="bookmark-dedup-section-header">
              <h3>{t('bookmarkDedupTitle')}</h3>
              {groups.length > 0 && (
                <span className="bookmark-dedup-count-badge">{groups.length}</span>
              )}
            </div>
            {groups.length === 0 ? (
              <div className="bookmark-dedup-clean-row">
                <Check size={14} className="text-accent" />
                <span>{t('noDuplicateBookmarks')}</span>
              </div>
            ) : (
              <>
                <div className="bookmark-dedup-list">
                  {groups.map((group) => {
                    const keep = bookmarksById.get(group.keepId);
                    const remove = group.removeIds
                      .map((id) => bookmarksById.get(id))
                      .filter((item): item is BookmarkRecord => Boolean(item));
                    return (
                      <div className="bookmark-dedup-group" key={group.canonicalUrl}>
                        <strong>{keep?.title || group.canonicalUrl}</strong>
                        <small>{t('bookmarkDedupKeep', { folder: keep?.folderPath ?? '' })}</small>
                        <span className="bookmark-dedup-remove-count">
                          {t('bookmarkDedupRemove', { count: group.removeIds.length })}
                        </span>
                        {remove.map((bookmark) => (
                          <span className="bookmark-dedup-remove" key={bookmark.id}>
                            × {bookmark.folderPath}
                          </span>
                        ))}
                      </div>
                    );
                  })}
                </div>
                <div className="bookmark-dedup-actions">
                  <button
                    type="button"
                    className="primary-button danger-button"
                    disabled={actionsLocked}
                    onClick={onApplyDedup}
                  >
                    {t('removeDuplicateBookmarks', { count: removeCount })}
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
        <footer className="modal-footer modal-actions">
          <button className="text-button" onClick={onClose}>
            {t('cancel')}
          </button>
          <button
            className="primary-button"
            disabled={actionsLocked || effectivePlan.moves.length === 0}
            onClick={() => onApplyOrganize(effectivePlan, scope)}
          >
            {t('organizeIncludedCount', { count: effectivePlan.moves.length })}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

