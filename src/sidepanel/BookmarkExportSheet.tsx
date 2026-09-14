import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { bookmarksToMarkdown, bookmarksToNetscapeHtml } from '../shared/bookmark-export';
import { downloadTextFile } from '../shared/portable';
import { BookmarkFolderRecord, BookmarkRecord } from '../shared/types';
import { Translator } from './i18n';
import { useFocusTrap } from './ui';

export function BookmarkExportSheet({
  folders,
  bookmarks,
  t,
  onClose,
}: {
  folders: BookmarkFolderRecord[];
  bookmarks: BookmarkRecord[];
  t: Translator;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, onClose);

  const [format, setFormat] = useState<'markdown' | 'html'>('markdown');

  const download = () => {
    if (format === 'markdown') {
      downloadTextFile('bookmarks.md', bookmarksToMarkdown(folders, bookmarks), 'text/markdown;charset=utf-8');
      return;
    }
    downloadTextFile(
      'bookmarks_import.html',
      bookmarksToNetscapeHtml(folders, bookmarks),
      'text/html;charset=utf-8',
    );
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
      className="modal-sheet bookmark-export-modal"
      role="dialog"
      aria-modal="true"
      aria-label={t('exportBookmarks')}
    >
      <header className="modal-header">
        <div>
          <h2>{t('exportBookmarks')}</h2>
          <p>{t('exportAddsNotReplaces')}</p>
        </div>
        <button className="icon-button" onClick={onClose} aria-label={t('close')}><X size={15} /></button>
      </header>
      <div className="modal-content bookmark-export-list">
        <div className="bookmark-export-formats" role="radiogroup" aria-label={t('exportBookmarks')}>
          <label className={format === 'markdown' ? 'bookmark-export-option active' : 'bookmark-export-option'}>
            <input
              type="radio"
              name="bookmark-export-format"
              checked={format === 'markdown'}
              onChange={() => setFormat('markdown')}
            />
            <span>{t('exportMarkdown')}</span>
          </label>
          <label className={format === 'html' ? 'bookmark-export-option active' : 'bookmark-export-option'}>
            <input
              type="radio"
              name="bookmark-export-format"
              checked={format === 'html'}
              onChange={() => setFormat('html')}
            />
            <span>{t('exportNetscapeHtml')}</span>
          </label>
        </div>
      </div>
      <footer className="modal-footer modal-actions">
        <button className="text-button" onClick={onClose}>{t('cancel')}</button>
        <button className="primary-button" onClick={download}>{t('downloadExport')}</button>
      </footer>
    </div>
  </div>, document.body);
}
