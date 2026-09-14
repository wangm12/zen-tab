import { describe, expect, test } from 'vitest';
import { dragAutoScrollDelta, placeListPlaceholder } from './list-dnd';

type Row =
  | { kind: 'header'; id: string }
  | { kind: 'item'; id: string }
  | { kind: 'placeholder' };

const rows: Row[] = [
  { kind: 'header', id: 'group' },
  { kind: 'item', id: 'a' },
  { kind: 'item', id: 'b' },
  { kind: 'item', id: 'c' },
];

function ids(next: Row[]): Array<string> {
  return next.map((row) => row.kind === 'item' ? row.id : row.kind === 'header' ? row.id : 'placeholder');
}

function place(draggedId: string, dest: Parameters<typeof placeListPlaceholder<Row, string>>[1]['dest']): Row[] {
  return placeListPlaceholder(rows, {
    dest,
    isPlaceholder: (row) => row.kind === 'placeholder',
    isDragged: (row) => row.kind === 'item' && row.id === draggedId,
    itemId: (row) => row.kind === 'item' ? row.id : undefined,
    headerId: (row) => row.kind === 'header' ? row.id : undefined,
    placeholder: { kind: 'placeholder' },
  });
}

describe('placeListPlaceholder', () => {
  test('opens a gap and removes the dragged item', () => {
    expect(ids(place('c', { type: 'origin' }))).toEqual(['group', 'a', 'b', 'placeholder']);
    expect(ids(place('c', { type: 'before', id: 'a' }))).toEqual(['group', 'placeholder', 'a', 'b']);
    expect(ids(place('c', { type: 'after', id: 'a' }))).toEqual(['group', 'a', 'placeholder', 'b']);
    expect(ids(place('c', { type: 'end' }))).toEqual(['group', 'a', 'b', 'placeholder']);
    expect(ids(place('c', { type: 'after-header', id: 'group' }))).toEqual(['group', 'placeholder', 'a', 'b']);
  });

  test('removes every row marked as dragged, including a subtree', () => {
    const tree: Row[] = [
      { kind: 'header', id: 'eng' },
      { kind: 'item', id: 'child-1' },
      { kind: 'item', id: 'child-2' },
      { kind: 'header', id: 'design' },
    ];
    const next = placeListPlaceholder(tree, {
      dest: { type: 'after-header', id: 'design' },
      isPlaceholder: (row) => row.kind === 'placeholder',
      isDragged: (row) => row.kind === 'header' && row.id === 'eng' || row.kind === 'item' && row.id.startsWith('child-'),
      itemId: (row) => row.kind === 'item' ? row.id : undefined,
      headerId: (row) => row.kind === 'header' ? row.id : undefined,
      placeholder: { kind: 'placeholder' },
    });
    expect(ids(next)).toEqual(['design', 'placeholder']);
  });
});

describe('dragAutoScrollDelta', () => {
  test('scrolls when the pointer is in the scroller edge', () => {
    expect(dragAutoScrollDelta(10, 0, 400)).toBe(-16);
    expect(dragAutoScrollDelta(390, 0, 400)).toBe(16);
    expect(dragAutoScrollDelta(200, 0, 400)).toBe(0);
  });
});
