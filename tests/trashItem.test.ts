import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  shell: {
    trashItem: vi.fn(),
  },
}));

import { shell } from 'electron';
import { trashItemResilient } from '../src/main/platform/trashItem';

let tempRoots: string[] = [];

describe('trashItemResilient', () => {
  afterEach(async () => {
    vi.mocked(shell.trashItem).mockReset();

    for (const root of tempRoots) {
      await fs.rm(root, { recursive: true, force: true });
    }

    tempRoots = [];
  });

  it('uses the OS recycle bin when available', async () => {
    vi.mocked(shell.trashItem).mockResolvedValue(undefined);
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'safetwin-trash-'));
    tempRoots.push(root);
    const itemPath = path.join(root, 'file.txt');
    await fs.writeFile(itemPath, 'content');

    const result = await trashItemResilient(itemPath, path.join(root, '.safetwin-trash'));

    expect(result).toEqual({ method: 'recycleBin', fallbackPath: null });
    expect(shell.trashItem).toHaveBeenCalledWith(itemPath);
  });

  it('moves to SafeTwin local trash when the recycle bin rejects the item', async () => {
    vi.mocked(shell.trashItem).mockRejectedValue(new Error('Failed to perform delete operation'));
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'safetwin-trash-'));
    tempRoots.push(root);
    const itemPath = path.join(root, 'file.txt');
    await fs.writeFile(itemPath, 'content');

    const result = await trashItemResilient(itemPath, path.join(root, '.safetwin-trash'));

    expect(result.method).toBe('safeTwinTrash');
    expect(result.fallbackPath).toContain('.safetwin-trash');
    await expect(fs.readFile(result.fallbackPath ?? '', 'utf8')).resolves.toBe('content');
    await expect(fs.stat(itemPath)).rejects.toThrow();
  });
});
