import { shell } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { TrashItemResult } from '../../shared/types';

const safeTimestamp = (): string => new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');

const uniqueFallbackPath = async (trashRoot: string, itemPath: string): Promise<string> => {
  const parsed = path.parse(itemPath);
  const baseName = `${parsed.name || 'item'} ${safeTimestamp()}${parsed.ext}`;

  for (let suffix = 1; suffix < 10_000; suffix += 1) {
    const candidate =
      suffix === 1
        ? path.join(trashRoot, baseName)
        : path.join(trashRoot, `${parsed.name || 'item'} ${safeTimestamp()} ${suffix}${parsed.ext}`);

    try {
      await fs.lstat(candidate);
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        return candidate;
      }

      throw error;
    }
  }

  throw new Error('Could not create a unique SafeTwin trash path.');
};

export const trashItemResilient = async (itemPath: string, trashRoot?: string): Promise<TrashItemResult> => {
  try {
    await shell.trashItem(itemPath);
    return {
      method: 'recycleBin',
      fallbackPath: null,
    };
  } catch {
    const fallbackRoot = trashRoot ?? path.join(path.dirname(itemPath), '.safetwin-trash');
    await fs.mkdir(fallbackRoot, { recursive: true });
    const fallbackPath = await uniqueFallbackPath(fallbackRoot, itemPath);
    await fs.rename(itemPath, fallbackPath);

    return {
      method: 'safeTwinTrash',
      fallbackPath,
    };
  }
};
