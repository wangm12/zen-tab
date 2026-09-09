import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GroupColor } from '../shared/types';
import { clampMenuPosition, ContextMenuSpec } from './context-menu';

export type ContextMenuItem = ContextMenuSpec & {
  id: string;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
  icon?: React.ReactNode;
  swatches?: {
    colors: GroupColor[];
    selected: string;
    labels: Record<GroupColor, string>;
    onSelectColor: (color: GroupColor) => void;
  };
};

export type ContextMenuProps = {
  open: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
  label: string;
  onClose: () => void;
};

export function ContextMenu({ open, x, y, items, label, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x, y });

  useLayoutEffect(() => {
    if (!open || !menuRef.current) {
      setPosition({ x, y });
      return;
    }
    const rect = menuRef.current.getBoundingClientRect();
    setPosition(clampMenuPosition(x, y, rect.width, rect.height, window.innerWidth, window.innerHeight));
  }, [items, open, x, y]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest('.context-menu')) onClose();
    };
    document.addEventListener('keydown', closeOnEscape, true);
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => {
      document.removeEventListener('keydown', closeOnEscape, true);
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
    };
  }, [onClose, open]);

  if (!open) return null;

  return createPortal(<div
    ref={menuRef}
    className="context-menu row-popover"
    role="menu"
    aria-label={label}
    style={{ position: 'fixed', top: position.y, left: position.x, right: 'auto', bottom: 'auto' }}
    onContextMenu={(event) => event.preventDefault()}
    onPointerDown={(event) => event.stopPropagation()}
  >
    {items.map((item) => item.kind === 'swatches' && item.swatches ? <div key={item.id} className="group-color-menu" role="group" aria-label={item.label}>
      {item.swatches.colors.map((color) => <button
        key={color}
        type="button"
        className={`group-color-swatch ${color}${item.swatches!.selected === color ? ' selected' : ''}`}
        disabled={item.disabled}
        onClick={() => {
          if (item.disabled) return;
          item.swatches!.onSelectColor(color);
          onClose();
        }}
        aria-label={`${item.label}: ${item.swatches!.labels[color]}`}
        title={item.swatches!.labels[color]}
      />)}
    </div> : <button
      key={item.id}
      type="button"
      role="menuitem"
      disabled={item.disabled}
      className={item.danger ? 'danger' : undefined}
      onClick={() => {
        if (item.disabled) return;
        item.onSelect();
        onClose();
      }}
    >{item.icon} {item.label}</button>)}
  </div>, document.body);
}
