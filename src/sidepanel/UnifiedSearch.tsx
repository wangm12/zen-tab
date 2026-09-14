import { useEffect, useMemo, useRef } from 'react';
import { BookmarkRecord, StashRecord, WindowSnapshot } from '../shared/types';
import { PaletteIcon } from './CommandPalette';
import { Translator } from './i18n';
import { PaletteEntry, buildPaletteEntries } from './palette';

export function UnifiedSearch({ windows, bookmarks, stashes, query, faviconGranted = false, t, activeIndex, onActiveIndexChange, onRun }: {
  windows: WindowSnapshot[];
  bookmarks: BookmarkRecord[];
  stashes: StashRecord[];
  query: string;
  faviconGranted?: boolean;
  t: Translator;
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onRun: (item: PaletteEntry) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const entries = useMemo(
    () => buildPaletteEntries(windows, query, t, bookmarks, stashes, faviconGranted),
    [bookmarks, faviconGranted, query, stashes, t, windows],
  );

  useEffect(() => {
    const activeEl = listRef.current?.querySelector('.palette-item.active') as HTMLElement | null;
    activeEl?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  return (
    <div ref={listRef} className="palette-list" role="listbox">
      {entries.length === 0 && <div className="palette-empty">{t('noMatchingCommands')}</div>}
      {entries.map((item, index) => (
        <button
          key={item.id}
          className={index === activeIndex ? 'palette-item active' : 'palette-item'}
          role="option"
          aria-selected={index === activeIndex}
          onMouseEnter={() => onActiveIndexChange(index)}
          onClick={() => onRun(item)}
        >
          <span className="palette-icon"><PaletteIcon item={item} /></span>
          <span className="palette-text"><strong>{item.label}</strong>{item.detail && <small>{item.detail}</small>}</span>
          {item.badge && <span className={`palette-badge palette-badge-${item.kind ?? 'command'}`}>{item.badge}</span>}
        </button>
      ))}
    </div>
  );
}
