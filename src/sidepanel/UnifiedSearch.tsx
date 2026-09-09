import { useMemo } from 'react';
import { BookmarkRecord, StashRecord, WindowSnapshot } from '../shared/types';
import { PaletteIcon } from './CommandPalette';
import { Translator } from './i18n';
import { PaletteEntry, buildPaletteEntries } from './palette';

export function UnifiedSearch({ windows, bookmarks, stashes, query, t, activeIndex, onActiveIndexChange, onRun }: {
  windows: WindowSnapshot[];
  bookmarks: BookmarkRecord[];
  stashes: StashRecord[];
  query: string;
  t: Translator;
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onRun: (item: PaletteEntry) => void;
}) {
  const entries = useMemo(
    () => buildPaletteEntries(windows, query, t, bookmarks, stashes),
    [bookmarks, query, stashes, t, windows],
  );

  return (
    <div className="palette-list" role="listbox">
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
          <span><strong>{item.label}</strong>{item.detail && <small>{item.detail}</small>}</span>
        </button>
      ))}
    </div>
  );
}
