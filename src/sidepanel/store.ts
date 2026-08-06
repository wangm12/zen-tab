import { create } from 'zustand';
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

type AppSection = 'tabs' | 'stashes';
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
  busy: string | null;
  toast: ToastMessage | null;
  error: string | null;
  load: () => Promise<void>;
  applyEvent: (event: ZenTabEvent) => void;
  request: <T = unknown>(message: ZenTabMessage) => Promise<T>;
  setSection: (section: AppSection) => void;
  setSearch: (search: string) => void;
  setModal: (modal: Modal) => void;
  setGroupProposal: (proposal: GroupProposal | null) => void;
  setCleanupProposal: (proposal: CleanupProposal | null) => void;
  setBusy: (busy: string | null) => void;
  showToast: (toast: ToastMessage) => void;
  updateSettings: (patch: Partial<ZenTabSettings>) => Promise<void>;
};

export const useZenTabStore = create<ZenTabStore>((set, get) => ({
  snapshot: null,
  selectedWindowId: null,
  section: 'tabs',
  search: '',
  modal: null,
  groupProposal: null,
  cleanupProposal: null,
  groupScanProgress: null,
  busy: null,
  toast: null,
  error: null,
  async load() {
    try {
      const snapshot = await get().request<ZenTabSnapshot>({ type: 'GET_SNAPSHOT' });
      set((state) => ({
        snapshot,
        selectedWindowId: state.selectedWindowId ?? snapshot.windows[0]?.windowId ?? null,
        error: null,
      }));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unable to read browser tabs.' });
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
    if (event.type === 'GROUP_SCAN_PROGRESS') set({ groupScanProgress: event });
  },
  async request<T>(message: ZenTabMessage) {
    const response = await chrome.runtime.sendMessage({ ...message }) as { ok: boolean; data?: T; error?: string };
    if (!response?.ok) throw new Error(response?.error ?? 'Zen Tab could not complete that action.');
    return response.data as T;
  },
  setSection(section) { set({ section, search: '' }); },
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
