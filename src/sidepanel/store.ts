import { create } from 'zustand';
import { emptySnapshot } from '../shared/tab-record';
import {
  CleanupProposal,
  GroupProposal,
  ZenTabEvent,
  ZenTabMessage,
  ZenTabSettings,
  ZenTabSnapshot,
  ToastMessage,
  GroupScanProgress,
} from '../shared/types';
import { readLocalSnapshot } from './local-snapshot';

const PENDING_BOOKMARK_FILING_KEY = 'zen-tab.pending-bookmark-filing';
const WORKER_SNAPSHOT_TIMEOUT_MS = 8_000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

export type AppSection = 'tabs' | 'stashes' | 'bookmarks';

export function showsUnifiedSearch(section: AppSection, search: string): boolean {
  return Boolean(search.trim()) && section !== 'stashes';
}
type Modal = 'group' | 'cleanup' | 'settings' | null;

type ZenTabStore = {
  snapshot: ZenTabSnapshot | null;
  selectedWindowId: number | null;
  section: AppSection;
  search: string;
  modal: Modal;
  groupProposal: GroupProposal | null;
  cleanupProposal: CleanupProposal | null;
  groupScanProgress: GroupScanProgress | null;
  restoreProgress: Extract<ZenTabEvent, { type: 'RESTORE_PROGRESS' }> | null;
  bookmarkEpoch: number;
  bookmarkFilingSuggestion: Extract<ZenTabEvent, { type: 'BOOKMARK_FILING_SUGGESTED' }> | null;
  busy: string | null;
  toast: ToastMessage | null;
  error: string | null;
  load: () => Promise<void>;
  applyEvent: (event: ZenTabEvent) => void;
  request: <T = unknown>(message: ZenTabMessage) => Promise<T>;
  setSection: (section: AppSection, options?: { keepSearch?: boolean }) => void;
  setSearch: (search: string) => void;
  setModal: (modal: Modal) => void;
  setGroupProposal: (proposal: GroupProposal | null) => void;
  setCleanupProposal: (proposal: CleanupProposal | null) => void;
  setBusy: (busy: string | null) => void;
  showToast: (toast: ToastMessage) => void;
  updateSettings: (patch: Partial<ZenTabSettings>) => Promise<void>;
};

export const useZenTabStore = create<ZenTabStore>((set, get) => ({
  snapshot: emptySnapshot(),
  selectedWindowId: null,
  section: 'tabs',
  search: '',
  modal: null,
  groupProposal: null,
  cleanupProposal: null,
  groupScanProgress: null,
  restoreProgress: null,
  bookmarkEpoch: 0,
  bookmarkFilingSuggestion: null,
  busy: null,
  toast: null,
  error: null,
  async load() {
    try {
      const local = await readLocalSnapshot();
      set((state) => ({
        snapshot: local,
        selectedWindowId: state.selectedWindowId ?? local.windows[0]?.windowId ?? null,
        error: null,
      }));
    } catch {
      // The worker snapshot can still recover a cold first paint.
    }
    try {
      const [snapshot, pendingStorage] = await Promise.all([
        withTimeout(get().request<ZenTabSnapshot>({ type: 'GET_SNAPSHOT' }), WORKER_SNAPSHOT_TIMEOUT_MS, 'Zen Tab is still waking up.'),
        chrome.storage.session.get(PENDING_BOOKMARK_FILING_KEY),
      ]);
      const pending = pendingStorage[PENDING_BOOKMARK_FILING_KEY] as ZenTabEvent | undefined;
      set((state) => ({
        snapshot,
        selectedWindowId: state.selectedWindowId && snapshot.windows.some((window) => window.windowId === state.selectedWindowId)
          ? state.selectedWindowId
          : snapshot.windows[0]?.windowId ?? state.selectedWindowId,
        ...(pending?.type === 'BOOKMARK_FILING_SUGGESTED' ? { bookmarkFilingSuggestion: pending } : {}),
        error: null,
      }));
      await chrome.storage.session.remove(PENDING_BOOKMARK_FILING_KEY);
    } catch (error) {
      if (!get().snapshot?.windows.length) {
        set({ error: error instanceof Error ? error.message : 'Unable to read browser tabs.' });
      }
    }
  },
  applyEvent(event) {
    if (event.type === 'SNAPSHOT_UPDATED') {
      set((state) => ({
        snapshot: event.snapshot,
        selectedWindowId: state.selectedWindowId && event.snapshot.windows.some((window) => window.windowId === state.selectedWindowId)
          ? state.selectedWindowId
          : event.snapshot.windows[0]?.windowId ?? null,
        error: null,
      }));
    }
    if (event.type === 'TOAST') set({ toast: event.toast });
    if (event.type === 'BOOKMARKS_UPDATED') set((state) => ({ bookmarkEpoch: state.bookmarkEpoch + 1 }));
    if (event.type === 'BOOKMARK_FILING_SUGGESTED') set({ bookmarkFilingSuggestion: event });
    if (event.type === 'GROUP_SCAN_PROGRESS') set({ groupScanProgress: event });
    if (event.type === 'RESTORE_PROGRESS') set({ restoreProgress: event });
  },
  async request<T>(message: ZenTabMessage) {
    const response = await chrome.runtime.sendMessage({ ...message }) as { ok: boolean; data?: T; error?: string };
    if (!response?.ok) throw new Error(response?.error ?? 'Zen Tab could not complete that action.');
    return response.data as T;
  },
  setSection(section, options) {
    set(options?.keepSearch ? { section } : { section, search: '' });
  },
  setSearch(search) { set({ search }); },
  setModal(modal) { set({ modal }); },
  setGroupProposal(groupProposal) { set({ groupProposal }); },
  setCleanupProposal(cleanupProposal) { set({ cleanupProposal }); },
  setBusy(busy) { set({ busy }); },
  showToast(toast) { set({ toast }); },
  async updateSettings(patch) {
    const settings = await get().request<ZenTabSettings>({ type: 'UPDATE_SETTINGS', patch });
    set((state) => ({ snapshot: state.snapshot ? { ...state.snapshot, settings } : state.snapshot }));
  },
}));
