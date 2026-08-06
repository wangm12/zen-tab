export type GroupColor = chrome.tabGroups.ColorEnum;

export type TabRecord = {
  tabId: number;
  windowId: number;
  incognito: boolean;
  url: string;
  canonicalUrl: string | null;
  title: string;
  favIconUrl?: string;
  groupId: number;
  pinned: boolean;
  active: boolean;
  audible: boolean;
  discarded: boolean;
  autoDiscardable: boolean;
  muted: boolean;
  index: number;
  status?: chrome.tabs.Tab['status'];
  lastAccessed?: number;
  createdAt: number;
};

export type TabGroupRecord = {
  groupId: number;
  windowId: number;
  title: string;
  color: GroupColor;
  collapsed: boolean;
};

export type WindowSnapshot = {
  windowId: number;
  focused: boolean;
  incognito: boolean;
  tabs: TabRecord[];
  groups: TabGroupRecord[];
};

export type DuplicateScope = 'same-window' | 'all-normal-windows';
export type Language = 'en' | 'zh';
export type ThemePreference = 'system' | 'light' | 'dark';

export type ZenTabSettings = {
  language: Language;
  theme: ThemePreference;
  duplicateEnabled: boolean;
  duplicateScope: DuplicateScope;
  ignoredDomains: string[];
  protectedDomains: string[];
  deepAnalysisEnabled: boolean;
  aiProvider: 'local' | 'groq';
  groqModel: string;
  incognitoEnabled: boolean;
};

export const DEFAULT_SETTINGS: ZenTabSettings = {
  language: 'en',
  theme: 'system',
  duplicateEnabled: true,
  duplicateScope: 'all-normal-windows',
  ignoredDomains: [],
  protectedDomains: ['figma.com', 'docs.google.com', 'meet.google.com', 'slack.com', 'discord.com', 'linear.app', 'notion.so', 'zoom.us', 'teams.microsoft.com', 'miro.com', 'localhost'],
  deepAnalysisEnabled: false,
  aiProvider: 'local',
  groqModel: 'llama-3.3-70b-versatile',
  incognitoEnabled: false,
};

export type StashedTab = {
  tabId?: number;
  url: string;
  title: string;
  windowId: number;
  favIconUrl?: string;
  index: number;
  active: boolean;
  pinned: boolean;
  muted: boolean;
  groupId: number;
  groupTitle?: string;
  groupColor?: GroupColor;
  groupCollapsed?: boolean;
};

export type StashRecord = {
  version: 1;
  id: string;
  name: string;
  createdAt: number;
  sourceWindowId: number;
  incognito: boolean;
  scope?: 'window' | 'group' | 'tabs';
  sourceGroupId?: number;
  sourceGroupTitle?: string;
  activeTabId?: number;
  tabs: StashedTab[];
};

export type ActionJournal = {
  actionId: string;
  type: 'duplicate' | 'group' | 'cleanup' | 'stash';
  createdAt: number;
  affectedTabIds: number[];
  restoreData?: unknown;
  expiresAt: number;
};

export type TabRestoreDescriptor = StashedTab;

export type ProjectTabInput = {
  tabId: number;
  title: string;
  url: string;
  canonicalUrl: string | null;
  summary?: string;
  lastAccessed?: number;
};

export type GroupEvidence = {
  label: string;
  detail: string;
};

export type ProjectGroupProposal = {
  name: string;
  tabIds: number[];
  confidence: 'high' | 'medium' | 'low';
  score: number;
  evidence: GroupEvidence[];
};

export type GroupProposal = {
  proposalId: string;
  provider: 'local-heuristic' | 'local-model' | 'groq';
  groups: ProjectGroupProposal[];
  unclassifiedTabIds: number[];
  analyzedTabCount: number;
  createdAt: number;
  sourceWindowId?: number;
  analyzedTabIds?: number[];
};

export type CleanupCandidate = {
  tabId: number;
  title: string;
  url: string;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  evidence: string[];
  protected: boolean;
};

export type CleanupProposal = {
  proposalId: string;
  candidates: CleanupCandidate[];
  createdAt: number;
  sourceWindowId: number;
  analyzedTabIds: number[];
  expiresAt: number;
};

export type ToastMessage = {
  id: string;
  tone: 'neutral' | 'success' | 'warning' | 'error';
  message: string;
  action?: 'undo' | 'open-settings';
};

export type ZenTabSnapshot = {
  windows: WindowSnapshot[];
  stashes: StashRecord[];
  settings: ZenTabSettings;
  hasGroqApiKey: boolean;
  lastAction?: ActionJournal;
};

export type GroupScanProgress = {
  type: 'GROUP_SCAN_PROGRESS';
  windowId: number;
  scanned: number;
  total: number;
  mode: 'adaptive' | 'full';
};

export type ZenTabMessage =
  | { type: 'GET_SNAPSHOT' }
  | { type: 'RUN_GROUP_ANALYSIS'; windowId: number; deepScanAll?: boolean }
  | { type: 'APPLY_GROUP_PROPOSAL'; proposal: GroupProposal }
  | { type: 'RUN_CLEANUP_ANALYSIS'; windowId: number }
  | { type: 'APPLY_CLEANUP'; proposalId: string; tabIds: number[] }
  | { type: 'STASH'; windowId: number; scope: 'window' | 'group' | 'tabs'; groupId?: number; tabIds?: number[]; includePinned?: boolean; includeActive?: boolean }
  | { type: 'STASH_WINDOW'; windowId: number; includePinned?: boolean; includeActive?: boolean }
  | { type: 'RESTORE_STASH'; stashId: string }
  | { type: 'DELETE_STASH'; stashId: string }
  | { type: 'UNDO_ACTION' }
  | { type: 'UPDATE_SETTINGS'; patch: Partial<ZenTabSettings> }
  | { type: 'UPDATE_GROQ_KEY'; apiKey: string }
  | { type: 'CLOSE_TABS'; tabIds: number[] }
  | { type: 'MOVE_TAB'; tabId: number; windowId: number; index: number }
  | { type: 'GROUP_TAB'; tabId: number; groupId: number }
  | { type: 'UPDATE_TAB'; tabId: number; windowId?: number; action: 'activate' | 'mute' | 'unmute' | 'pin' | 'unpin' | 'discard' | 'close' };

export type ZenTabEvent =
  | { type: 'SNAPSHOT_UPDATED'; snapshot: ZenTabSnapshot }
  | { type: 'TOAST'; toast: ToastMessage }
  | { type: 'GROUP_SCAN_PROGRESS'; windowId: number; scanned: number; total: number; mode: 'adaptive' | 'full' }
  | { type: 'RESTORE_PROGRESS'; stashId: string; completed: number; total: number };

export type ProviderCapabilities = {
  available: boolean;
  name: 'local-model' | 'groq' | 'heuristic';
  supportsSummaries: boolean;
};

export type AIProvider = {
  getCapabilities(): Promise<ProviderCapabilities>;
  proposeProjects(input: ProjectTabInput[]): Promise<GroupProposal>;
  proposeCleanup(input: ProjectTabInput[], protectedDomains: string[]): Promise<CleanupCandidate[]>;
  summarizeTabs(input: ProjectTabInput[]): Promise<Array<{ tabId: number; summary: string }>>;
};
