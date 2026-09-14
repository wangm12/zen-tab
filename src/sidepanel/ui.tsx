import { useEffect, useId, useRef } from 'react';
import { Undo2, X } from 'lucide-react';
import { ZenTabMessage } from '../shared/types';
import { Translator } from './i18n';
import { useZenTabStore } from './store';

export type RequestFn = <T = unknown>(message: ZenTabMessage) => Promise<T>;
export const TOAST_DURATION_MS = 5000;

function focusableIn(container: HTMLElement | null): HTMLElement[] {
  return [...(container?.querySelectorAll<HTMLElement>('button, input, select, textarea, [href], [tabindex]:not([tabindex="-1"])') ?? [])].filter((element) => !element.hasAttribute('disabled'));
}

export function useFocusTrap(containerRef: React.RefObject<HTMLElement | null>, onClose: () => void, initialFocusRef?: React.RefObject<HTMLElement | null>, active = true) {
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!active) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = containerRef.current;
    (initialFocusRef?.current ?? focusableIn(dialog)[0])?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusableIn(dialog);
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
  }, [active, containerRef, initialFocusRef]);
}

export function ModalFrame({ eyebrow, title, description, closeLabel, onClose, children, footer, headerExtra }: { eyebrow: string; title: string; description: string; closeLabel?: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; headerExtra?: React.ReactNode }) {
  const dialogRef = useRef<HTMLElement>(null);
  const titleId = `${useId()}-title`;
  const descriptionId = `${useId()}-description`;
  useFocusTrap(dialogRef, onClose);
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><section ref={dialogRef} className="modal-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}>
    <header className="modal-header"><div><span className="eyebrow">{eyebrow}</span><h2 id={titleId}>{title}</h2><p id={descriptionId}>{description}</p></div><button className="icon-button" onClick={onClose} aria-label={closeLabel ?? 'Close'}><X size={18} /></button>{headerExtra}</header>
    <div className="modal-content">{children}</div>
    {footer && <footer className="modal-footer">{footer}</footer>}
  </section></div>;
}

export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <button type="button" role="switch" aria-label={label} aria-checked={checked} className={checked ? 'toggle on' : 'toggle'} onClick={() => onChange(!checked)}><span /></button>;
}

export function Toast({ toast, t, onDismiss, onUndo }: { toast: NonNullable<ReturnType<typeof useZenTabStore.getState>['toast']>; t: Translator; onDismiss: () => void; onUndo: () => void }) {
  useEffect(() => { const timer = window.setTimeout(onDismiss, TOAST_DURATION_MS); return () => window.clearTimeout(timer); }, [onDismiss, toast.id]);
  const toastStyle = { '--toast-duration': `${TOAST_DURATION_MS}ms` } as React.CSSProperties;
  return <div className={`toast ${toast.tone}`} role="status" style={toastStyle}><span className="toast-indicator" /> <span>{toast.message}</span>{toast.action === 'undo' && <button className="toast-action" type="button" onClick={onUndo} title={`${t('undo')} (⌘Z / Ctrl+Z)`} aria-label={t('undo')} aria-keyshortcuts="Meta+Z Control+Z"><Undo2 size={15} aria-hidden="true" /></button>}<button className="toast-close" type="button" onClick={onDismiss} aria-label={t('dismiss')}><X size={13} /></button></div>;
}
