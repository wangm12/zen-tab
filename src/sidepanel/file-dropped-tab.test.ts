import { describe, expect, test, vi } from 'vitest';
import { TabRecord } from '../shared/types';
import { Translator } from './i18n';
import { bookmarkNavTabDragOver, fileDroppedTab } from './file-dropped-tab';

const t = ((key: string) => key) as Translator;

function setup(overrides: {
  openTabs?: Array<Pick<TabRecord, 'tabId' | 'title' | 'url'>>;
  created?: number;
  granted?: boolean;
} = {}) {
  const request = vi.fn().mockResolvedValue({ created: overrides.created ?? 1 });
  const showToast = vi.fn();
  const requestBookmarksPermission = vi.fn().mockResolvedValue(overrides.granted ?? true);
  return {
    request,
    showToast,
    requestBookmarksPermission,
    deps: {
      openTabs: overrides.openTabs ?? [{ tabId: 7, title: 'Docs', url: 'https://example.com/docs' }],
      request,
      showToast,
      t,
      requestBookmarksPermission,
    },
  };
}

describe('fileDroppedTab', () => {
  test('skips a missing tab', async () => {
    const { request, requestBookmarksPermission, deps } = setup();
    await fileDroppedTab(99, undefined, deps);
    expect(requestBookmarksPermission).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  test('skips an empty url', async () => {
    const { request, requestBookmarksPermission, deps } = setup({
      openTabs: [{ tabId: 7, title: 'Blank', url: '' }],
    });
    await fileDroppedTab(7, undefined, deps);
    expect(requestBookmarksPermission).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  test('toasts permissionDenied and does not create when bookmarks are denied', async () => {
    const { request, showToast, deps } = setup({ granted: false });
    await fileDroppedTab(7, undefined, deps);
    expect(request).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({
      message: 'permissionDenied',
    }));
  });

  test('creates in Other Bookmarks when folderId is omitted', async () => {
    const { request, showToast, deps } = setup();
    await fileDroppedTab(7, undefined, deps);
    expect(request).toHaveBeenCalledWith({
      type: 'CREATE_BOOKMARKS',
      tabs: [{ title: 'Docs', url: 'https://example.com/docs' }],
    });
    expect(request.mock.calls[0][0]).not.toHaveProperty('folderId');
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({
      message: 'bookmarksCreated',
      action: 'undo',
    }));
  });

  test('creates in the target folder and omits undo when created is 0', async () => {
    const { request, showToast, deps } = setup({ created: 0 });
    await fileDroppedTab(7, 'folder-9', deps);
    expect(request).toHaveBeenCalledWith({
      type: 'CREATE_BOOKMARKS',
      folderId: 'folder-9',
      tabs: [{ title: 'Docs', url: 'https://example.com/docs' }],
    });
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({
      message: 'bookmarksCreated',
    }));
    expect(showToast.mock.calls[0][0]).not.toHaveProperty('action');
  });
});

describe('bookmarkNavTabDragOver', () => {
  test('reveals bookmarks while a tab drag is still held so tray and folders can receive it', () => {
    expect(bookmarkNavTabDragOver(['text/plain'], 'tabs')).toEqual({ accept: false, switchToBookmarks: false });
    expect(bookmarkNavTabDragOver(['text/tab-id'], 'tabs')).toEqual({ accept: true, switchToBookmarks: true });
    expect(bookmarkNavTabDragOver(['text/tab-id'], 'stashes')).toEqual({ accept: true, switchToBookmarks: true });
    expect(bookmarkNavTabDragOver(['text/tab-id'], 'bookmarks')).toEqual({ accept: true, switchToBookmarks: false });
  });
});
