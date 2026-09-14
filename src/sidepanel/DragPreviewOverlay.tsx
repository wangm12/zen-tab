import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function DragPreviewOverlay({
  x,
  y,
  icon,
  title,
}: {
  x: number;
  y: number;
  icon: ReactNode;
  title: string;
}) {
  return createPortal(
    <div className="tab-drag-overlay" style={{ left: x + 12, top: y + 12 }} aria-hidden="true">
      <div className="tab-drag-preview">
        {icon}
        <span>{title}</span>
      </div>
    </div>,
    document.body,
  );
}
