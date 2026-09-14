import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import {
  BookmarkFilingCreate,
  BookmarkFilingMove,
  NEW_FILING_FOLDER,
  initialFilingFolderId,
  resolveFilingRowPlan,
} from '../shared/bookmark-filing';
import { filingDestinationFolders, folderCreateParentFolders, otherBookmarksRootId } from '../shared/bookmarks';
import { createId } from '../shared/ids';
import { BookmarkFolderRecord, BookmarkFolderSuggestion, BookmarkRecord } from '../shared/types';
import { Translator } from './i18n';
import { useFocusTrap } from './ui';

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

type RowDraft = {
  bookmarkId: string;
  folderId: string;
  skipped: boolean;
  newFolderTitle: string;
  newFolderParentId: string;
};

export function BookmarkFilingSheet({
  rows,
  folders,
  t,
  busy,
  focusBookmarkId,
  onClose,
  onApply,
}: {
  rows: Array<{ bookmark: BookmarkRecord; suggestion: BookmarkFolderSuggestion | null }>;
  folders: BookmarkFolderRecord[];
  t: Translator;
  busy: boolean;
  focusBookmarkId?: string;
  onClose: () => void;
  onApply: (plan: { creates: BookmarkFilingCreate[]; moves: BookmarkFilingMove[] }) => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, onClose);

  const destinations = useMemo(() => filingDestinationFolders(folders), [folders]);
  const createParents = useMemo(() => folderCreateParentFolders(folders), [folders]);
  const eligibleIds = useMemo(() => new Set(destinations.map((folder) => folder.id)), [destinations]);
  const otherRootId = useMemo(() => otherBookmarksRootId(folders), [folders]);
  const [drafts, setDrafts] = useState<RowDraft[]>(() => rows.map((row) => ({
    bookmarkId: row.bookmark.id,
    folderId: initialFilingFolderId(row.suggestion, eligibleIds),
    skipped: false,
    newFolderTitle: '',
    newFolderParentId: otherRootId ?? createParents[0]?.id ?? '',
  })));

  useEffect(() => {
    if (!focusBookmarkId) return;
    const node = document.querySelector(`[data-filing-row="${focusBookmarkId}"]`);
    if (!(node instanceof HTMLElement)) return;
    node.scrollIntoView({ block: 'nearest' });
    const focusable = node.querySelector('select, input');
    if (focusable instanceof HTMLElement) focusable.focus();
  }, [focusBookmarkId, rows]);

  const updateDraft = (bookmarkId: string, patch: Partial<RowDraft>) => {
    setDrafts((current) => current.map((draft) => (
      draft.bookmarkId === bookmarkId ? { ...draft, ...patch } : draft
    )));
  };

  const canConfirm = drafts.some((draft) => resolveFilingRowPlan(draft).type !== 'skip');

  const apply = () => {
    const creates: BookmarkFilingCreate[] = [];
    const moves: BookmarkFilingMove[] = [];
    const createdByTitle = new Map<string, string>();
    for (const draft of drafts) {
      const plan = resolveFilingRowPlan(draft);
      if (plan.type === 'skip') continue;
      if (plan.type === 'existing') {
        moves.push({ bookmarkId: draft.bookmarkId, folderId: plan.folderId });
        continue;
      }
      const key = `${plan.parentId}\0${plan.title}`;
      let clientId = createdByTitle.get(key);
      if (!clientId) {
        clientId = createId('folder');
        createdByTitle.set(key, clientId);
        creates.push({ clientId, parentId: plan.parentId, title: plan.title });
      }
      moves.push({ bookmarkId: draft.bookmarkId, folderId: clientId });
    }
    onApply({ creates, moves });
  };

  return createPortal(<div
    className="modal-backdrop"
    role="presentation"
    onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}
  >
    <div
      ref={dialogRef}
      className="modal-sheet bookmark-filing-modal"
      role="dialog"
      aria-modal="true"
      aria-label={t('reviewInbox')}
    >
      <header className="modal-header">
        <div>
          <span className="eyebrow">{t('bookmarkInbox')}</span>
          <h2>{t('reviewInbox')}</h2>
          <p>{t('chooseBookmarkFolder')}</p>
        </div>
        <button className="icon-button" onClick={onClose} aria-label={t('cancel')}><X size={15} /></button>
      </header>
      <div className="modal-content bookmark-filing-list">
        {rows.map((row) => {
          const draft = drafts.find((item) => item.bookmarkId === row.bookmark.id);
          if (!draft) return null;
          const creating = draft.folderId === NEW_FILING_FOLDER;
          return <div
            className={draft.skipped ? 'bookmark-filing-row skipped' : 'bookmark-filing-row'}
            key={row.bookmark.id}
            data-filing-row={row.bookmark.id}
          >
            <strong>{row.bookmark.title || row.bookmark.url}</strong>
            <small>{hostLabel(row.bookmark.url)}</small>
            {row.suggestion && <span className={`bookmark-filing-reason confidence ${row.suggestion.confidence}`}>
              {row.suggestion.confidence === 'high' ? t('strongMatch') : row.suggestion.confidence === 'medium' ? t('possibleMatch') : t('needsReview')}
              {row.suggestion.reason ? ` · ${row.suggestion.reason}` : ''}
            </span>}
            <label className="bookmark-filing-skip">
              <input
                type="checkbox"
                checked={draft.skipped}
                onChange={(event) => updateDraft(row.bookmark.id, { skipped: event.target.checked })}
              />
              {t('skipBookmark')}
            </label>
            <select
              value={draft.folderId}
              disabled={draft.skipped}
              onChange={(event) => updateDraft(row.bookmark.id, { folderId: event.target.value })}
            >
              <option value="">{destinations.length ? '' : t('noBookmarkFolders')}</option>
              {destinations.map((folder) => (
                <option key={folder.id} value={folder.id}>{folder.folderPath}</option>
              ))}
              {createParents.length > 0 && <option value={NEW_FILING_FOLDER}>{t('newFolderInReview')}</option>}
            </select>
            {creating && <label className="bookmark-filing-new">
              <span>{t('newFolderParent')}</span>
              <select
                value={draft.newFolderParentId}
                disabled={draft.skipped}
                onChange={(event) => updateDraft(row.bookmark.id, { newFolderParentId: event.target.value })}
              >
                {createParents.map((folder) => (
                  <option key={folder.id} value={folder.id}>{folder.folderPath}</option>
                ))}
              </select>
            </label>}
            {creating && <label className="bookmark-filing-new">
              <span>{t('newFolderInReview')}</span>
              <input
                value={draft.newFolderTitle}
                disabled={draft.skipped}
                placeholder={t('bookmarkFolderName')}
                onChange={(event) => updateDraft(row.bookmark.id, { newFolderTitle: event.target.value })}
              />
            </label>}
          </div>;
        })}
      </div>
      <footer className="modal-footer modal-actions">
        <button className="text-button" onClick={onClose}>{t('cancel')}</button>
        <button className="primary-button" disabled={!canConfirm || busy} onClick={apply}>{t('fileBookmark')}</button>
      </footer>
    </div>
  </div>, document.body);
}
