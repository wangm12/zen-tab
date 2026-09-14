import { X } from 'lucide-react';
import { ToastMessage } from '../shared/types';
import { Translator } from './i18n';

export function BookmarkEditPanel({
  title,
  url,
  label,
  titleLabel,
  onTitleChange,
  onUrlChange,
  onSave,
  onClose,
  showToast,
  t,
}: {
  title: string;
  url?: string;
  label?: string;
  titleLabel?: string;
  onTitleChange: (value: string) => void;
  onUrlChange?: (value: string) => void;
  onSave: (value: { title: string; url?: string }) => void;
  onClose: () => void;
  showToast: (toast: ToastMessage) => void;
  t: Translator;
}) {
  const showUrl = url !== undefined && onUrlChange;
  const submit = () => {
    if (!title.trim()) return;
    if (showUrl) {
      try {
        new URL(url);
      } catch {
        showToast({ id: `${Date.now()}`, tone: 'error', message: t('invalidBookmarkUrl') });
        return;
      }
    }
    onSave({ title, ...(showUrl ? { url } : {}) });
  };
  return (
    <div className="bookmark-inline-panel bookmark-edit-panel" role="dialog" aria-label={label ?? t('editBookmark')}>
      <label className="bookmark-edit-field">
        <span>{titleLabel ?? t('bookmarkTitleLabel')}</span>
        <input
          value={title}
          autoFocus
          onChange={(event) => onTitleChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit();
            if (event.key === 'Escape') onClose();
          }}
        />
      </label>
      {showUrl && (
        <label className="bookmark-edit-field">
          <span>{t('bookmarkUrlLabel')}</span>
          <input
            value={url}
            onChange={(event) => onUrlChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit();
              if (event.key === 'Escape') onClose();
            }}
          />
        </label>
      )}
      <button className="primary-button" disabled={!title.trim()} onClick={submit}>
        {t('saveBookmarkEdit')}
      </button>
      <button className="icon-button subtle" onClick={onClose} aria-label={t('cancel')}><X size={13} /></button>
    </div>
  );
}
