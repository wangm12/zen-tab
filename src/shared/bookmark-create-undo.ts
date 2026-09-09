export type CreatedBookmarkRef = { id: string };

export function shouldIgnoreBookmarkCreated(suppressCount: number): boolean {
  return suppressCount > 0;
}

export async function withBookmarkCreatedFilingSuppressed<T>(
  createCount: number,
  adjust: (delta: number) => void,
  work: () => Promise<T>,
): Promise<T> {
  adjust(createCount);
  try {
    return await work();
  } finally {
    adjust(-createCount);
  }
}

export async function restoreCreatedBookmarkIds(
  created: CreatedBookmarkRef[],
  deps: {
    get: (id: string) => Promise<unknown>;
    remove: (id: string) => Promise<void>;
    checkpoint: (remaining: CreatedBookmarkRef[]) => Promise<void>;
  },
): Promise<void> {
  const remaining = [...created];
  while (remaining.length) {
    const item = remaining[0];
    try {
      await deps.get(item.id);
    } catch {
      remaining.shift();
      await deps.checkpoint([...remaining]);
      continue;
    }
    try {
      await deps.remove(item.id);
      remaining.shift();
      await deps.checkpoint([...remaining]);
    } catch (error) {
      await deps.checkpoint([...remaining]);
      throw error;
    }
  }
}
