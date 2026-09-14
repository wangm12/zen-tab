import { BOOKMARK_WORKSPACE_PERMISSIONS } from '../shared/bookmark-favicon';
import { TabRecord, ToastMessage, ZenTabMessage } from '../shared/types';
import { Translator } from './i18n';

export type FileDroppedTabDeps = {
  openTabs: Array<Pick<TabRecord, 'tabId' | 'title' | 'url'>>;
  request: <T = unknown>(message: ZenTabMessage) => Promise<T>;
  showToast: (toast: ToastMessage) => void;
  t: Translator;
  requestBookmarksPermission?: () => Promise<boolean>;
};

export async function fileDroppedTab(
  tabId: number,
  folderId: string | undefined,
  {
    openTabs,
    request,
    showToast,
    t,
    requestBookmarksPermission = () => chrome.permissions.request(BOOKMARK_WORKSPACE_PERMISSIONS),
  }: FileDroppedTabDeps,
): Promise<void> {
  const tab = openTabs.find((item) => item.tabId === tabId);
  if (!tab?.url) return;

  let granted = false;
  try {
    granted = await requestBookmarksPermission();
  } catch {
    granted = false;
  }
  if (!granted) {
    showToast({ id: `${Date.now()}`, tone: 'warning', message: t('permissionDenied') });
    return;
  }

  try {
    const result = await request<{ created: number }>({
      type: 'CREATE_BOOKMARKS',
      ...(folderId ? { folderId } : {}),
      tabs: [{ title: tab.title, url: tab.url }],
    });
    showToast({
      id: `${Date.now()}`,
      tone: result.created > 0 ? 'success' : 'neutral',
      message: t('bookmarksCreated', { count: result.created }),
      ...(result.created > 0 ? { action: 'undo' as const } : {}),
    });
  } catch (error) {
    showToast({
      id: `${Date.now()}`,
      tone: 'error',
      message: error instanceof Error ? error.message : t('actionFailed'),
    });
  }
}
