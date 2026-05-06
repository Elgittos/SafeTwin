import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { initializeSchema } from '../src/main/db/schema';
import { openDatabase, type SqliteDatabase } from '../src/main/db/sqlite';
import { IgnoreRuleService } from '../src/main/ignore/ignoreRules';
import { ScannerService } from '../src/main/scanner/scannerService';
import { FolderPairService } from '../src/main/services/folderPairService';

let tempRoots: string[] = [];

const writeFile = async (filePath: string, content: string, mtime: Date) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
  await fs.utimes(filePath, mtime, mtime);
};

describe('ScannerService', () => {
  afterEach(async () => {
    for (const root of tempRoots) {
      await fs.rm(root, { recursive: true, force: true });
    }
    tempRoots = [];
  });

  it('scans folders, persists entries, and can reload the latest status from cache', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'safetwin-scan-'));
    tempRoots.push(root);

    const originPath = path.join(root, 'origin');
    const backupPath = path.join(root, 'backup');
    const mtime = new Date('2026-05-06T12:00:00.000Z');
    await fs.mkdir(originPath, { recursive: true });
    await fs.mkdir(backupPath, { recursive: true });
    await writeFile(path.join(originPath, 'same.txt'), 'same', mtime);
    await writeFile(path.join(backupPath, 'same.txt'), 'same', mtime);
    await writeFile(path.join(originPath, 'missing.txt'), 'missing', mtime);
    await writeFile(path.join(backupPath, 'backup-only.txt'), 'backup only', mtime);
    await writeFile(path.join(originPath, 'nested', 'conflict.txt'), 'origin', mtime);
    await writeFile(path.join(backupPath, 'nested', 'conflict.txt'), 'backup-changed', mtime);
    await writeFile(path.join(originPath, '~$draft.docx'), 'lock', mtime);

    const db: SqliteDatabase = openDatabase(path.join(root, 'cache.sqlite'));
    initializeSchema(db);

    try {
      const ignoreRules = new IgnoreRuleService(db);
      ignoreRules.initialize();
      const folderPairs = new FolderPairService(db);
      const scanner = new ScannerService(db, ignoreRules);
      const pair = folderPairs.saveFolderPair({
        name: 'Origin to Backup',
        originPath,
        backupPath,
      });

      const progressMessages: string[] = [];
      const result = await scanner.scanPair(pair, 'metadata', {
        onProgress: (progress) => {
          progressMessages.push(progress.phase);
        },
      });
      folderPairs.markScanned(pair.id, result.completedAt);

      expect(progressMessages).toContain('walking');
      expect(progressMessages).toContain('complete');
      expect(result.summary).toMatchObject({
        missingInBackup: 1,
        backupOnly: 1,
        identical: 1,
        conflicts: 1,
        ignored: 1,
      });
      expect(result.ignoredFiles).toEqual([{ path: '~$draft.docx', reason: 'Office lock file' }]);
      expect(db.get<{ count: number }>('SELECT COUNT(*) AS count FROM file_entries')?.count).toBe(7);
      expect(db.get<{ count: number }>('SELECT COUNT(*) AS count FROM compare_results')?.count).toBe(5);

      const cached = folderPairs.getLastStatus(pair.id);
      expect(cached.lastScan?.summary.conflicts).toBe(1);
      expect(cached.lastScan?.files.find((file) => file.relativePath.includes('conflict'))?.state).toBe(
        'conflictSamePathDifferentContent',
      );
    } finally {
      db.close();
    }
  });
});
