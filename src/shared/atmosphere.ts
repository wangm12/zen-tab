import { GroupColor } from './types';

export const ATMOSPHERE_PITCH = 9;
export const ATMOSPHERE_CELL_TARGET = 120;

export function sampleParticleCell(seed: number, x: number, y: number): { include: boolean; phase: number } {
  const n = Math.sin(x * 12.9898 + y * 78.233 + seed * 45.164) * 43758.5453;
  const fract = n - Math.floor(n);
  return { include: fract > 0.72, phase: fract };
}

export function selectAtmosphereCells(
  columns: number,
  rows: number,
  seed: number,
  target = ATMOSPHERE_CELL_TARGET,
): Array<{ x: number; y: number; phase: number }> {
  const ranked: Array<{ x: number; y: number; phase: number; score: number }> = [];
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const cell = sampleParticleCell(seed, x, y);
      if (!cell.include) continue;
      ranked.push({ x, y, phase: cell.phase, score: cell.phase });
    }
  }
  return ranked.sort((left, right) => right.score - left.score).slice(0, target).map(({ x, y, phase }) => ({ x, y, phase }));
}

export function shouldAnimateAtmosphere(input: {
  enabled: boolean;
  reducedMotion: boolean;
  documentHidden: boolean;
  visible: boolean;
}): boolean {
  return input.enabled && !input.reducedMotion && !input.documentHidden && input.visible;
}

const GROUP_DOT: Record<GroupColor | 'none', string> = {
  none: 'oklch(57% 0.008 90)',
  grey: 'oklch(62% 0.01 90)',
  blue: 'oklch(66% 0.11 250)',
  cyan: 'oklch(70% 0.1 195)',
  green: 'oklch(65% 0.11 145)',
  yellow: 'oklch(80% 0.12 82)',
  orange: 'oklch(68% 0.12 55)',
  red: 'oklch(72% 0.13 28)',
  pink: 'oklch(68% 0.1 350)',
  purple: 'oklch(66% 0.1 310)',
};

function washFromDot(dot: string): string {
  return `color-mix(in oklch, ${dot} 12%, var(--surface))`;
}

export function groupSurfaceColor(color: GroupColor | 'none'): { wash: string; dot: string } {
  const dot = GROUP_DOT[color] ?? GROUP_DOT.none;
  return { wash: washFromDot(dot), dot };
}

export function folderSurfaceColor(folderId: string): { wash: string; dot: string } {
  let hash = 0;
  for (const char of folderId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  const dot = `oklch(64% 0.08 ${hue})`;
  return { wash: washFromDot(dot), dot };
}

export const INBOX_SURFACE_COLOR = groupSurfaceColor('none');

export function pickFaviconStack(icons: Array<string | undefined>, limit = 3): string[] {
  const next: string[] = [];
  for (const icon of icons) {
    if (!icon) continue;
    next.push(icon);
    if (next.length === limit) break;
  }
  return next;
}

export function collectFolderUrls(nodes: ReadonlyArray<{
  kind: string;
  bookmark?: { url: string };
  folder?: unknown;
  children?: readonly unknown[];
}>, limit = Number.POSITIVE_INFINITY): string[] {
  const urls: string[] = [];
  const walk = (items: typeof nodes) => {
    for (const node of items) {
      if (urls.length >= limit) return;
      if (node.kind === 'bookmark') urls.push(node.bookmark!.url);
      else walk((node.children ?? []) as typeof nodes);
    }
  };
  walk(nodes);
  return urls;
}

export function dotPatternDataUrl(color: string, pitch = ATMOSPHERE_PITCH): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pitch}" height="${pitch}"><rect width="2" height="2" x="1" y="1" fill="${color}" fill-opacity="0.34"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

export function firstViewportIndex(
  items: ReadonlyArray<{ index: number; start: number; size: number }>,
  scrollOffset: number,
): number {
  return items.find((item) => item.start + item.size > scrollOffset)?.index ?? -1;
}

export function stickyHeaderHasScrolledAway(
  headerStart: number,
  headerSize: number,
  scrollOffset: number,
): boolean {
  return headerStart + headerSize <= scrollOffset;
}

export function resolveStickyGroup<T extends { kind: string }>(
  rows: readonly T[],
  firstVisibleIndex: number,
  headerKinds: readonly string[] = ['group'],
): T | null {
  if (firstVisibleIndex < 0 || rows.length === 0) return null;
  for (let i = firstVisibleIndex; i >= 0; i -= 1) {
    const row = rows[i];
    if (row && headerKinds.includes(row.kind)) return row;
  }
  return null;
}
