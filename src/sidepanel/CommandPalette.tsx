import { useEffect, useMemo, useRef, useState } from 'react';
import { AppWindow, Archive, Bookmark, Globe2, ListFilter, Search, Settings2, Sparkles, Undo2, X } from 'lucide-react';
import { BookmarkRecord, StashRecord, TabRecord, WindowSnapshot } from '../shared/types';
import { Translator } from './i18n';
import { PaletteEntry, buildPaletteEntries } from './palette';
import { useFocusTrap } from './ui';

export function PaletteIcon({ item }: { item: PaletteEntry }) {
  if (item.commandId === 'jump-tab') {
    return item.favIconUrl
      ? <img src={item.favIconUrl} alt="" className="palette-favicon" />
      : <Globe2 size={13} />;
  }
  if (item.commandId === 'switch-window') return <AppWindow size={13} />;
  if (item.commandId === 'cleanup') return <ListFilter size={13} />;
  if (item.commandId === 'settings') return <Settings2 size={13} />;
  if (item.commandId === 'undo') return <Undo2 size={13} />;
  if (item.commandId === 'search') return <Search size={13} />;
  if (item.commandId === 'bookmarks' || item.commandId === 'jump-bookmark') return <Bookmark size={13} />;
  if (item.commandId === 'jump-stash' || item.commandId.startsWith('stash') || item.commandId === 'export-window') return <Archive size={13} />;
  return <Sparkles size={13} />;
}

export function CommandPalette({ open, windows, bookmarks, stashes, t, onClose, onRun }: {
  open: boolean;
  windows: WindowSnapshot[];
  bookmarks?: BookmarkRecord[];
  stashes?: StashRecord[];
  t: Translator;
  onClose: () => void;
  onRun: (commandId: string, tab?: TabRecord, windowId?: number, url?: string, stashId?: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const sheetRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const commands = useMemo(() => buildPaletteEntries(windows, query, t, bookmarks, stashes), [bookmarks, query, stashes, t, windows]);
  useFocusTrap(sheetRef, onClose, inputRef, open);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setActive(0);
      return;
    }
    inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  if (!open) return null;

  const runItem = (item: PaletteEntry) => {
    onRun(item.commandId, item.tab, item.windowId, item.url, item.stashId);
    onClose();
  };

  const runActive = () => {
    const item = commands[active];
    if (!item) return;
    runItem(item);
  };

  return <div className="palette-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <div ref={sheetRef} className="palette-sheet" role="dialog" aria-modal="true" aria-label={t('commandPalette')} onKeyDown={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key === 'ArrowDown') { event.preventDefault(); setActive((index) => Math.min(commands.length - 1, index + 1)); }
      if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => Math.max(0, index - 1)); }
      if (event.key === 'Enter') { event.preventDefault(); runActive(); }
    }}>
      <label className="search-box palette-search">
        <Search size={16} />
        <input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('commandPalettePlaceholder')} aria-label={t('commandPalettePlaceholder')} />
        <button className="search-clear" onClick={onClose} aria-label={t('close')}><X size={13} /></button>
      </label>
      <div className="palette-list" role="listbox">
        {commands.length === 0 && <div className="palette-empty">{t('noMatchingCommands')}</div>}
        {commands.map((item, index) => (
          <button key={item.id} className={index === active ? 'palette-item active' : 'palette-item'} role="option" aria-selected={index === active} onMouseEnter={() => setActive(index)} onClick={() => runItem(item)}>
            <span className="palette-icon"><PaletteIcon item={item} /></span>
            <span><strong>{item.label}</strong>{item.detail && <small>{item.detail}</small>}</span>
          </button>
        ))}
      </div>
    </div>
  </div>;
}
