export function canUseBookmarksApi(bookmarks: { onCreated?: unknown } | undefined): boolean {
  return Boolean(bookmarks?.onCreated);
}
