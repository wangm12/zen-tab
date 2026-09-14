import type { HTMLAttributes, ReactNode } from 'react';
import { formatTabDragId, type DragSurface } from '../shared/tab-dnd';
import { useTabDragOver } from './tab-drag-over';

export function DroppableSurface({
  surface,
  as: Tag = 'div',
  className,
  children,
  ...props
}: {
  surface: DragSurface;
  as?: 'div' | 'button' | 'header' | 'section';
  className?: string;
  children: ReactNode | ((isDropTarget: boolean) => ReactNode);
  type?: 'button' | 'submit' | 'reset';
} & Omit<HTMLAttributes<HTMLElement>, 'children' | 'className'>) {
  const id = formatTabDragId(surface);
  const over = useTabDragOver(id);
  return (
    <Tag
      data-tab-drop={id}
      className={over ? `${className ?? ''} drop-target`.trim() : className}
      {...props}
    >
      {typeof children === 'function' ? children(over) : children}
    </Tag>
  );
}
