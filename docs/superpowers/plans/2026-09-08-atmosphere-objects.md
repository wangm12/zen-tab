# Atmosphere + Object Surfaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Zen Tab side panel a quiet particle field and turn groups, bookmark folders, and search into colored objects — without a new-tab canvas or a canvas per tab row.

**Architecture:** Pure helpers in `src/shared/atmosphere.ts` own particle sampling, surface colors, favicon stacks, and static SVG dot textures. One live `AtmosphereCanvas` sits behind `.app-shell`. Group and folder rows consume CSS wash + cached textures + `FaviconStack`. Tab and bookmark URL rows stay list rows. `atmosphereEnabled` is a normal settings boolean.

**Tech Stack:** Existing React 18 side panel, Zustand store, Vitest, CSS tokens. No `pixi.js`, no `gsap`, no new dependencies.

## Global Constraints

- Side panel only. No new-tab override, pixel clock, burning clock, garden, Pixi, or GSAP.
- At most one live `requestAnimationFrame` canvas. No particle canvas on tab rows.
- Unified search results stay a list. Stash rows stay rows.
- Chartreuse remains the only signal color for selection, focus, and primary actions. Group/folder washes are supporting color.
- Every new user-facing string exists in both `en` and `zh` in `src/sidepanel/i18n.ts`.
- TDD: write the failing test, watch it fail, then implement.
- Do not commit unless the user explicitly asks. Skip commit steps if they have not.
- Do not edit `docs/plan/` or the Oh My Tab UX plan file.
- Work from `/Users/mingjie/Documents/github/personal-projects/chrome-ext/zen-tab`.

## File map

| File | Responsibility |
|---|---|
| Create: `src/shared/atmosphere.ts` | Particle cells, motion gate, group/folder colors, favicon stack, SVG dot texture |
| Create: `src/shared/atmosphere.test.ts` | Unit tests for those helpers |
| Create: `src/sidepanel/AtmosphereCanvas.tsx` | The single live 2d canvas |
| Create: `src/sidepanel/FaviconStack.tsx` | Up to 3 overlapping 16px favicons |
| Modify: `src/shared/types.ts` | `atmosphereEnabled` on settings + default `true` |
| Modify: `src/shared/storage.ts` | Parse `atmosphereEnabled` as boolean |
| Modify: `src/shared/storage.test.ts` | Default / invalid fallback |
| Modify: `src/sidepanel/i18n.ts` | `atmosphere`, `atmosphereDescription` |
| Modify: `src/sidepanel/SettingsPanel.tsx` | Appearance toggle |
| Modify: `src/sidepanel/App.tsx` | Mount atmosphere behind shell |
| Modify: `src/sidepanel/styles.css` | Search stage, group/folder surfaces, canvas, favicon stack |
| Modify: `src/sidepanel/TabTree.tsx` | Group object row + stack + virtualizer size |
| Modify: `src/sidepanel/BookmarkList.tsx` | Folder / inbox object headers |

---

### Task 1: Atmosphere helpers

**Files:**
- Create: `src/shared/atmosphere.ts`
- Test: `src/shared/atmosphere.test.ts`

**Interfaces:**
- Consumes: `GroupColor` from `src/shared/types.ts`
- Produces:
  - `ATMOSPHERE_PITCH = 9`
  - `ATMOSPHERE_CELL_TARGET = 120`
  - `sampleParticleCell(seed: number, x: number, y: number): { include: boolean; phase: number }`
  - `selectAtmosphereCells(columns: number, rows: number, seed: number, target?: number): Array<{ x: number; y: number; phase: number }>`
  - `shouldAnimateAtmosphere(input: { enabled: boolean; reducedMotion: boolean; documentHidden: boolean; visible: boolean }): boolean`
  - `groupSurfaceColor(color: GroupColor | 'none'): { wash: string; dot: string }`
  - `folderSurfaceColor(folderId: string): { wash: string; dot: string }`
  - `INBOX_SURFACE_COLOR: { wash: string; dot: string }`
  - `pickFaviconStack(icons: Array<string \| undefined>, limit?: number): string[]`
  - `collectFolderUrls(nodes: Array<{ kind: string; bookmark?: { url: string }; children?: unknown[] }>): string[]` — implement against `BookmarkForestNode` from `src/shared/bookmark-tree.ts`
  - `dotPatternDataUrl(color: string, pitch?: number): string`

- [ ] **Step 1: Write the failing test**

Create `src/shared/atmosphere.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  collectFolderUrls,
  folderSurfaceColor,
  groupSurfaceColor,
  pickFaviconStack,
  sampleParticleCell,
  selectAtmosphereCells,
  shouldAnimateAtmosphere,
  dotPatternDataUrl,
  ATMOSPHERE_CELL_TARGET,
} from './atmosphere';

describe('sampleParticleCell', () => {
  it('is deterministic for a fixed seed', () => {
    expect(sampleParticleCell(7, 3, 4)).toEqual(sampleParticleCell(7, 3, 4));
    expect(sampleParticleCell(7, 3, 4)).not.toEqual(sampleParticleCell(8, 3, 4));
  });
});

describe('selectAtmosphereCells', () => {
  it('keeps a sparse field near the target count', () => {
    const cells = selectAtmosphereCells(40, 80, 11);
    expect(cells.length).toBeGreaterThan(40);
    expect(cells.length).toBeLessThanOrEqual(ATMOSPHERE_CELL_TARGET);
    expect(new Set(cells.map((cell) => `${cell.x},${cell.y}`)).size).toBe(cells.length);
  });
});

describe('shouldAnimateAtmosphere', () => {
  it('runs only when enabled, visible, and motion is allowed', () => {
    expect(shouldAnimateAtmosphere({ enabled: true, reducedMotion: false, documentHidden: false, visible: true })).toBe(true);
    expect(shouldAnimateAtmosphere({ enabled: false, reducedMotion: false, documentHidden: false, visible: true })).toBe(false);
    expect(shouldAnimateAtmosphere({ enabled: true, reducedMotion: true, documentHidden: false, visible: true })).toBe(false);
    expect(shouldAnimateAtmosphere({ enabled: true, reducedMotion: false, documentHidden: true, visible: true })).toBe(false);
    expect(shouldAnimateAtmosphere({ enabled: true, reducedMotion: false, documentHidden: false, visible: false })).toBe(false);
  });
});

describe('surface colors', () => {
  it('maps chrome group colors and keeps folder color stable', () => {
    expect(groupSurfaceColor('blue').wash).toMatch(/oklch/);
    expect(groupSurfaceColor('none').dot).toMatch(/oklch/);
    expect(folderSurfaceColor('folder-a')).toEqual(folderSurfaceColor('folder-a'));
    expect(folderSurfaceColor('folder-a').dot).not.toEqual(folderSurfaceColor('folder-b').dot);
  });
});

describe('pickFaviconStack', () => {
  it('returns at most three non-empty icons in order', () => {
    expect(pickFaviconStack(['a', '', undefined, 'b', 'c', 'd'])).toEqual(['a', 'b', 'c']);
    expect(pickFaviconStack([])).toEqual([]);
  });
});

describe('collectFolderUrls', () => {
  it('walks nested folder nodes in document order', () => {
    expect(collectFolderUrls([
      { kind: 'bookmark', bookmark: { url: 'https://a.example' } },
      { kind: 'folder', folder: { id: 'nested' }, children: [
        { kind: 'bookmark', bookmark: { url: 'https://b.example' } },
      ] },
    ])).toEqual(['https://a.example', 'https://b.example']);
  });
});

describe('dotPatternDataUrl', () => {
  it('emits a repeating svg data url for the given color', () => {
    const url = dotPatternDataUrl('oklch(66% 0.11 250)');
    expect(url.startsWith('url("data:image/svg+xml,')).toBe(true);
    expect(decodeURIComponent(url)).toContain('oklch(66% 0.11 250)');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/atmosphere.test.ts`

Expected: FAIL, `Failed to load url ./atmosphere`

- [ ] **Step 3: Write minimal implementation**

Create `src/shared/atmosphere.ts`:

```ts
import { BookmarkForestNode } from './bookmark-tree';
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

export function collectFolderUrls(nodes: BookmarkForestNode[]): string[] {
  const urls: string[] = [];
  const walk = (items: BookmarkForestNode[]) => {
    for (const node of items) {
      if (node.kind === 'bookmark') urls.push(node.bookmark.url);
      else walk(node.children);
    }
  };
  walk(nodes);
  return urls;
}

export function dotPatternDataUrl(color: string, pitch = ATMOSPHERE_PITCH): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pitch}" height="${pitch}"><rect width="2" height="2" x="1" y="1" fill="${color}" fill-opacity="0.34"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
```

If `collectFolderUrls` types fail on the inline test fixture, widen the parameter to:

```ts
export function collectFolderUrls(nodes: ReadonlyArray<{
  kind: string;
  bookmark?: { url: string };
  children?: readonly unknown[];
}>): string[]
```

and walk the same way. Prefer the `BookmarkForestNode` version if the test fixture is typed as that.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shared/atmosphere.test.ts`

Expected: PASS, all tests green.

- [ ] **Step 5: Commit only if the user asked**

```bash
git add src/shared/atmosphere.ts src/shared/atmosphere.test.ts
git commit -m "$(cat <<'EOF'
Add atmosphere helpers for particles, surfaces, and favicon stacks.

EOF
)"
```

---

### Task 2: `atmosphereEnabled` setting

**Files:**
- Modify: `src/shared/types.ts` (settings type + `DEFAULT_SETTINGS`)
- Modify: `src/shared/storage.ts` (`settingsFromStored`)
- Modify: `src/shared/storage.test.ts`
- Modify: `src/sidepanel/i18n.ts`
- Modify: `src/sidepanel/SettingsPanel.tsx` (Appearance segment, after theme)

**Interfaces:**
- Consumes: existing `ZenTabSettings` / `Toggle`
- Produces: `atmosphereEnabled: boolean` default `true`; keys `atmosphere`, `atmosphereDescription`

- [ ] **Step 1: Write the failing storage test**

In `src/shared/storage.test.ts`, add inside `describe('storage validation'`:

```ts
  it('defaults atmosphere on and rejects non-boolean values', async () => {
    const unset = await loadSettings();
    expect(unset.atmosphereEnabled).toBe(true);
    storage['zen-tab.settings'] = { atmosphereEnabled: 'no' };
    const invalid = await loadSettings();
    expect(invalid.atmosphereEnabled).toBe(true);
    storage['zen-tab.settings'] = { atmosphereEnabled: false };
    const off = await loadSettings();
    expect(off.atmosphereEnabled).toBe(false);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/storage.test.ts`

Expected: FAIL, `atmosphereEnabled` undefined or not on the type.

- [ ] **Step 3: Add the setting**

In `src/shared/types.ts` add to `ZenTabSettings` and `DEFAULT_SETTINGS`:

```ts
atmosphereEnabled: boolean;
```

```ts
atmosphereEnabled: true,
```

In `src/shared/storage.ts` `settingsFromStored` return object, after `theme`:

```ts
atmosphereEnabled: typeof safeSettings.atmosphereEnabled === 'boolean' ? safeSettings.atmosphereEnabled : DEFAULT_SETTINGS.atmosphereEnabled,
```

In `src/sidepanel/i18n.ts` add `'atmosphere' | 'atmosphereDescription'` to `TranslationKey`.

English:

```ts
atmosphere: 'Atmosphere',
atmosphereDescription: 'A quiet field behind the panel. Turn off for a flatter look.',
```

Chinese:

```ts
atmosphere: '气氛',
atmosphereDescription: '侧栏背后一层很淡的点阵。关掉就是更平整的面板。',
```

In `src/sidepanel/SettingsPanel.tsx`, inside the appearance tabpanel, after the theme block:

```tsx
<div className="settings-section"><div className="settings-heading"><div><strong>{t('atmosphere')}</strong><span>{t('atmosphereDescription')}</span></div><Toggle label={t('atmosphere')} checked={settings.atmosphereEnabled} onChange={(checked) => safelyUpdate({ atmosphereEnabled: checked })} /></div></div>
```

`Toggle` is already imported from `./ui`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/shared/storage.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: exit 0. If i18n exhaustiveness fails, you missed a language map entry.

- [ ] **Step 5: Commit only if the user asked**

---

### Task 3: Atmosphere canvas

**Files:**
- Create: `src/sidepanel/AtmosphereCanvas.tsx`
- Modify: `src/sidepanel/App.tsx`
- Modify: `src/sidepanel/styles.css`

**Interfaces:**
- Consumes: `selectAtmosphereCells`, `shouldAnimateAtmosphere`, `ATMOSPHERE_PITCH` from `../shared/atmosphere`
- Consumes: `snapshot.settings.atmosphereEnabled` from `useZenTabStore`
- Produces: one canvas behind `.app-shell`

- [ ] **Step 1: Add CSS**

In `src/sidepanel/styles.css`, after `.app-shell`:

```css
.app-shell { isolation: isolate; }
.atmosphere-canvas {
  position: absolute;
  inset: 0;
  z-index: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.app-shell > :not(.atmosphere-canvas) { position: relative; z-index: 1; }
```

Existing `.app-shell` already has `position: relative`. Do not duplicate the whole rule; only add `isolation: isolate` onto the existing block.

- [ ] **Step 2: Implement `AtmosphereCanvas`**

Create `src/sidepanel/AtmosphereCanvas.tsx`:

```tsx
import { useEffect, useRef } from 'react';
import { ATMOSPHERE_PITCH, selectAtmosphereCells, shouldAnimateAtmosphere } from '../shared/atmosphere';

export function AtmosphereCanvas({ enabled }: { enabled: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const pointer = { x: -999, y: -999 };
    let visible = true;
    let frame = 0;
    let cells = selectAtmosphereCells(1, 1, 3);
    let lastBudget = 0;
    let interval = 1000 / 60;
    const observer = new IntersectionObserver((entries) => {
      visible = entries.some((entry) => entry.isIntersecting);
    });
    observer.observe(canvas);

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      const columns = Math.max(1, Math.ceil(width / ATMOSPHERE_PITCH));
      const rows = Math.max(1, Math.ceil(height / ATMOSPHERE_PITCH));
      cells = selectAtmosphereCells(columns, rows, 3);
    };

    const onPointer = (event: PointerEvent) => {
      const box = canvas.getBoundingClientRect();
      pointer.x = event.clientX - box.left;
      pointer.y = event.clientY - box.top;
    };

    const paint = (time: number) => {
      const start = performance.now();
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const style = getComputedStyle(document.documentElement);
      const accent = style.getPropertyValue('--accent').trim() || 'oklch(84% 0.14 118)';
      const dark = style.getPropertyValue('color-scheme').includes('dark');
      const alpha = dark ? 0.09 : 0.12;
      context.clearRect(0, 0, width, height);
      const drift = time / 9000;
      for (const cell of cells) {
        const px = cell.x * ATMOSPHERE_PITCH + 3;
        const py = ((cell.y * ATMOSPHERE_PITCH + drift * ATMOSPHERE_PITCH * 8 + cell.phase * 20) % (height + ATMOSPHERE_PITCH));
        const dx = px - pointer.x;
        const dy = py - pointer.y;
        const pull = Math.max(0, 1 - Math.hypot(dx, dy) / 90);
        const size = 2 + pull * 1.4;
        context.fillStyle = accent;
        context.globalAlpha = alpha + pull * 0.08;
        context.fillRect(px - size / 2 + pull * dx * -0.04, py - size / 2 + pull * dy * -0.04, size, size);
      }
      context.globalAlpha = 1;
      const spent = performance.now() - start;
      lastBudget = lastBudget * 0.8 + spent * 0.2;
      interval = lastBudget > 8 ? 1000 / 30 : 1000 / 60;
    };

    const tick = (time: number) => {
      const animate = shouldAnimateAtmosphere({
        enabled,
        reducedMotion: media.matches,
        documentHidden: document.hidden,
        visible,
      });
      if (animate) paint(time);
      else if (!enabled) context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
      frame = window.setTimeout(() => {
        frame = requestAnimationFrame(tick);
      }, interval) as unknown as number;
    };

    resize();
    if (enabled && !media.matches) frame = requestAnimationFrame(tick);
    else if (enabled) paint(0);
    const onResize = () => resize();
    window.addEventListener('pointermove', onPointer, { passive: true });
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onResize);
    media.addEventListener('change', onResize);
    return () => {
      window.clearTimeout(frame);
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onResize);
      media.removeEventListener('change', onResize);
    };
  }, [enabled]);

  if (!enabled) return null;
  return <canvas ref={canvasRef} className="atmosphere-canvas" aria-hidden="true" />;
}
```

Fix the loop so it does not leak mixed timeout/rAF ids. Use one rAF and skip paint when `performance.now() - lastPaint < interval`:

```ts
let lastPaint = 0;
let frame = 0;
const tick = (time: number) => {
  const animate = shouldAnimateAtmosphere({
    enabled,
    reducedMotion: media.matches,
    documentHidden: document.hidden,
    visible,
  });
  if (animate && time - lastPaint >= interval) {
    lastPaint = time;
    paint(time);
  }
  if (!animate && !enabled) context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  frame = requestAnimationFrame(tick);
};
```

Cleanup: `cancelAnimationFrame(frame)` only.

When `enabled` is false, the component returns `null` (no canvas). When reduced motion is on and enabled is true, paint once after resize and do not start rAF — gate that with `shouldAnimateAtmosphere`.

- [ ] **Step 3: Mount in App**

In `src/sidepanel/App.tsx`:

```ts
import { AtmosphereCanvas } from './AtmosphereCanvas';
```

In both the `!snapshot` shell and the main `app-shell`:

```tsx
<main className="app-shell">
  <AtmosphereCanvas enabled={snapshot?.settings.atmosphereEnabled ?? true} />
  ...
```

The empty snapshot from `emptySnapshot()` uses `DEFAULT_SETTINGS.atmosphereEnabled === true`, so the field can appear before worker settings arrive.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`

Expected: exit 0.

- [ ] **Step 5: Commit only if the user asked**

---

### Task 4: Search stage

**Files:**
- Modify: `src/sidepanel/styles.css` (`.search-box` / `.search-box:focus-within`)

**Interfaces:**
- Consumes: existing `.search-box` used by App, CommandPalette, StashList
- Produces: taller stage chrome; no new markup

- [ ] **Step 1: Replace the search-box metrics**

Current rule starts at `.search-box {` around line 236. Change to:

```css
.search-box {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 44px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  color: var(--text-dim);
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--accent) 0%, transparent);
  transition: border-color 140ms ease, background 140ms ease, box-shadow 140ms ease;
}
.search-box:focus-within {
  border-color: var(--accent);
  background: var(--surface-2);
  box-shadow: inset 0 0 0 1px var(--accent-soft);
}
.search-box input { min-width: 0; flex: 1; border: 0; outline: 0; background: transparent; color: var(--text); font-size: 12px; }
```

Do not change CommandPalette into mosaic tiles. `.palette-search` may keep the same class and inherit the taller box; that is intended.

- [ ] **Step 2: Confirm no type/test fallout**

Run: `npx vitest run src/sidepanel/palette.test.ts src/sidepanel/store.test.ts`

Expected: PASS.

- [ ] **Step 3: Commit only if the user asked**

---

### Task 5: Group objects + favicon stack

**Files:**
- Create: `src/sidepanel/FaviconStack.tsx`
- Modify: `src/sidepanel/TabTree.tsx`
- Modify: `src/sidepanel/styles.css`

**Interfaces:**
- Consumes: `pickFaviconStack`, `groupSurfaceColor`, `dotPatternDataUrl` from `../shared/atmosphere`
- Produces: `FaviconStack({ icons: string[] })`; group rows 44px with wash + stack

- [ ] **Step 1: Add a helper test for group row icon picking**

In `src/shared/atmosphere.test.ts` add:

```ts
describe('group tab icons', () => {
  it('reads favicons from matching tabs in strip order', () => {
    expect(pickFaviconStack([
      undefined,
      'https://a/favicon.ico',
      'https://b/favicon.ico',
    ])).toEqual(['https://a/favicon.ico', 'https://b/favicon.ico']);
  });
});
```

This already passes if Task 1 is done. Keep it as the contract GroupRow will use.

- [ ] **Step 2: Create `FaviconStack`**

```tsx
export function FaviconStack({ icons }: { icons: string[] }) {
  if (!icons.length) return null;
  return (
    <span className="favicon-stack" aria-hidden="true">
      {icons.map((src) => <img key={src} src={src} alt="" className="favicon-stack-icon" />)}
    </span>
  );
}
```

- [ ] **Step 3: CSS for surfaces and stack**

Add to `src/sidepanel/styles.css`:

```css
.group-row-shell {
  position: relative;
  display: flex;
  align-items: stretch;
  width: 100%;
  min-height: 44px;
  margin: 4px 0;
  border-radius: 10px;
  background: var(--group-wash, var(--surface));
  background-image: var(--group-dots, none);
  overflow: hidden;
}
.group-row-shell.has-rail { box-shadow: inset 3px 0 0 var(--group-dot, var(--text-dim)); }
.group-row-shell:not(.has-rail) { background: color-mix(in oklch, var(--surface-2) 80%, transparent); }
.group-rail { display: none; }
.group-row { display: flex; align-items: center; width: auto; min-height: 44px; flex: 1; gap: var(--space-2); padding: 0 10px; border: 0; border-radius: 10px; background: transparent; color: var(--text-muted); text-align: left; }
.favicon-stack { display: flex; flex: 0 0 auto; align-items: center; padding-left: 8px; }
.favicon-stack-icon { width: 16px; height: 16px; margin-left: -8px; border-radius: 4px; object-fit: contain; background: var(--surface); box-shadow: 0 0 0 1px var(--border-soft); }
.favicon-stack-icon:first-child { margin-left: 0; }
```

Keep existing hover / drop-target / popover rules. If an old `.group-row-shell` / `.group-row` / `.group-rail` block conflicts, replace those three rules rather than duplicating.

Virtualizer in `TabTree.tsx` currently:

```ts
estimateSize: (index) => rows[index].kind === 'group' ? 38 : 46
```

Change group estimate to `52`.

- [ ] **Step 4: Thread icons into the group row**

In `TreeRow`:

```ts
| { kind: 'group'; id: number; name: string; color: string; count: number; collapsed: boolean; synthetic?: boolean; icons: string[] }
```

When pushing a real group:

```ts
next.push({
  kind: 'group',
  id: group.groupId,
  name: group.title || t('untitledGroup'),
  color: group.color,
  count: tabs.length,
  collapsed: group.collapsed,
  icons: pickFaviconStack(tabs.map((tab) => tab.favIconUrl)),
});
```

Synthetic:

```ts
icons: pickFaviconStack(matchingUngrouped.map((tab) => tab.favIconUrl)),
```

Import `pickFaviconStack`, `groupSurfaceColor`, `dotPatternDataUrl` from `../shared/atmosphere` and `FaviconStack` from `./FaviconStack`.

On the group shell:

```tsx
const surface = groupSurfaceColor(row.synthetic ? 'none' : row.color as GroupColor);
return <div
  className={row.synthetic ? 'group-row-shell' : 'group-row-shell has-rail'}
  style={{ '--group-wash': surface.wash, '--group-dot': surface.dot, '--group-dots': dotPatternDataUrl(surface.dot) } as React.CSSProperties}
  onContextMenu={openGroupContextMenu}
>
  <button ...>
    ...
    <span className="group-name">{row.name}</span>
    <span className="group-count">{row.count}</span>
    <FaviconStack icons={row.icons} />
  </button>
  ...
</div>;
```

Remove the visible `.group-rail` span (color moves to the inset box-shadow). Keep `has-rail` class for real groups.

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run src/shared/atmosphere.test.ts src/sidepanel/context-menu.test.ts && npm run typecheck`

Expected: PASS, exit 0.

- [ ] **Step 6: Commit only if the user asked**

---

### Task 6: Bookmark folder objects

**Files:**
- Modify: `src/sidepanel/BookmarkList.tsx`
- Modify: `src/sidepanel/styles.css`

**Interfaces:**
- Consumes: `collectFolderUrls`, `folderSurfaceColor`, `INBOX_SURFACE_COLOR`, `pickFaviconStack`, `dotPatternDataUrl`, `resolveBookmarkFavicon`, `FaviconStack`
- Produces: folder and inbox headers use the same surface recipe as groups

- [ ] **Step 1: Style folder headers as objects**

Replace / extend `.bookmark-group > header` in `src/sidepanel/styles.css`:

```css
.bookmark-group > header {
  display: flex;
  min-height: 44px;
  align-items: center;
  gap: 7px;
  margin: 4px 0;
  padding: 0 10px;
  border-radius: 10px;
  color: var(--text-dim);
  cursor: pointer;
  background: var(--group-wash, var(--surface));
  background-image: var(--group-dots, none);
  box-shadow: inset 3px 0 0 var(--group-dot, var(--text-dim));
}
.bookmark-group > header strong { min-width: 0; flex: 1; overflow: hidden; color: var(--text); font-size: 12px; font-weight: var(--weight-semibold); text-overflow: ellipsis; white-space: nowrap; }
.bookmark-group > header span { font-size: 10px; font-variant-numeric: tabular-nums; }
.bookmark-inbox > header { cursor: default; }
```

Bookmark URL rows (`.bookmark-row`) stay as they are.

- [ ] **Step 2: Apply colors and stacks in BookmarkList**

Import:

```ts
import { collectFolderUrls, dotPatternDataUrl, folderSurfaceColor, INBOX_SURFACE_COLOR, pickFaviconStack } from '../shared/atmosphere';
import { FaviconStack } from './FaviconStack';
```

Helper inside the component:

```ts
const iconsForUrls = (urls: string[]) => pickFaviconStack(urls.map((url) => resolveBookmarkFavicon(
  url,
  openTabs,
  faviconGranted ? chromeFaviconUrl(url, (path) => chrome.runtime.getURL(path)) : undefined,
)));
```

On folder header:

```tsx
const surface = folderSurfaceColor(node.folder.id);
const icons = iconsForUrls(collectFolderUrls(node.children));
<header
  style={{ '--group-wash': surface.wash, '--group-dot': surface.dot, '--group-dots': dotPatternDataUrl(surface.dot) } as React.CSSProperties}
  ...
>
  ...
  <strong>...</strong>
  <span>{node.count}</span>
  <FaviconStack icons={icons} />
</header>
```

On inbox header use `INBOX_SURFACE_COLOR` and `iconsForUrls(inbox.map((bookmark) => bookmark.url))`.

- [ ] **Step 3: Tests**

Run: `npx vitest run src/shared/atmosphere.test.ts src/shared/bookmark-tree.test.ts src/sidepanel/file-dropped-tab.test.ts && npm run typecheck`

Expected: PASS, exit 0.

- [ ] **Step 4: Commit only if the user asked**

---

### Task 7: Verification gate

**Files:** none new

- [ ] **Step 1: Full suite**

Run: `npx vitest run && npm run typecheck && npm run build`

Expected: all tests pass, tsc exit 0, vite build writes a consistent `dist/service-worker-loader.js` + matching hashed assets.

- [ ] **Step 2: Manual check after the user reloads the unpacked extension**

1. Open the side panel: the field is visible behind chrome, search is a 44px block.
2. A colored Chrome group reads as a surface with up to 3 favicons.
3. Bookmarks folder headers match that treatment; inbox uses the reserved ink wash.
4. Settings → Appearance → Atmosphere off removes the canvas and does not collapse layout.
5. macOS Reduce Motion (or `prefers-reduced-motion`) freezes the field.
6. A window with many tabs still first-paints from the local snapshot path; scrolling stays virtualized.

---

## Spec coverage

| Spec item | Task |
|---|---|
| One live atmosphere canvas, sparse ~120 cells, accent, drift + pointer | 1, 3 |
| Pause on hidden / reduced motion / invisible / setting off | 1, 2, 3 |
| Default atmosphere on + Appearance toggle + en/zh | 2 |
| Search 44px / 12px radius / accent-soft focus | 4 |
| Group 44px wash + static dots + favicon stack | 1, 5 |
| Ungrouped muted, no fake color | 5 |
| Folder hash color + inbox reserved color | 1, 6 |
| Tab / bookmark URL / stash rows unchanged | 4–6 |
| No Pixi/GSAP/new-tab/per-row canvas | Global + all tasks |
| ≤ 1 rAF canvas, 30fps fallback if frame > 8ms | 3 |
| Tests for sample / stack / folder color / reduced motion | 1 |
| Local snapshot first paint preserved | 7 (no change to `store.load`) |
