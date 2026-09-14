import { BookmarkFolderKind } from './types';

export function decideCreatedBookmarkAction(input: {
  isInbox: boolean;
}): 'suggest' | 'ignore' {
  return input.isInbox ? 'suggest' : 'ignore';
}

export function shouldSuppressCreatedBookmarkFiling(dest?: {
  folderKind?: BookmarkFolderKind;
  isInbox?: boolean;
}): boolean {
  if (!dest || dest.isInbox || dest.folderKind === 'other') return false;
  return dest.folderKind === 'bar' || dest.folderKind === 'folder';
}
