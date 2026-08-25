export interface PreviewLoadResult<T> {
  failed: T[];
  completed: number;
  total: number;
}

/** Decode a bounded batch without retaining image objects or exceeding concurrency. */
export async function decodePreviews<T>(items: readonly T[], decode: (item: T) => Promise<boolean>, concurrency = 6, onProgress: (completed: number, total: number) => void = () => {}): Promise<PreviewLoadResult<T>> {
  const queue = [...items];
  const failed: T[] = [];
  const total = queue.length;
  let completed = 0;
  const worker = async (): Promise<void> => {
    while (queue.length) {
      const item = queue.shift();
      if (item === undefined) return;
      let success = false;
      try { success = await decode(item); } catch { success = false; }
      if (!success) failed.push(item);
      completed += 1;
      onProgress(completed, total);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, Math.floor(concurrency) || 1), Math.max(1, total)) }, worker));
  return { failed, completed, total };
}
