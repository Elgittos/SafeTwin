import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { initializeSchema } from '../src/main/db/schema';
import { openDatabase } from '../src/main/db/sqlite';
import { IgnoreRuleService } from '../src/main/ignore/ignoreRules';
import { summarizeDirectoryDifferences } from '../src/main/scanner/quickDiffService';
import { ScannerService } from '../src/main/scanner/scannerService';
import { FolderPairService } from '../src/main/services/folderPairService';

let tempRoots: string[] = [];

const writeFile = async (filePath: string, content: string, mtime: Date) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
  await fs.utimes(filePath, mtime, mtime);
};

describe('summarizeDirectoryDifferences', () => {
  afterEach(async () => {
    for (const root of tempRoots) {
      await fs.rm(root, { recursive: true, force: true });
    }
    tempRoots = [];
  });

  it('matches full scanner folder counts for visible folder markers', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'safetwin-quick-'));
    tempRoots.push(root);
    const db = openDatabase(path.join(root, 'cache.sqlite'));
    const originPath = path.join(root, 'origin');
    const backupPath = path.join(root, 'backup');
    const mtime = new Date('2026-05-06T12:00:00.000Z');

    try {
      initializeSchema(db);
      const ignoreRules = new IgnoreRuleService(db);
      ignoreRules.initialize();
      const folderPairs = new FolderPairService(db);
      const scanner = new ScannerService(db, ignoreRules);

      await writeFile(path.join(originPath, 'Documents', 'same.txt'), 'same', mtime);
      await writeFile(path.join(backupPath, 'Documents', 'same.txt'), 'same', mtime);
      await writeFile(path.join(originPath, 'Documents', 'ignored.tmp'), 'ignored origin', mtime);
      await writeFile(path.join(backupPath, 'Documents', 'ignored.tmp'), 'ignored backup', mtime);
      await writeFile(path.join(originPath, 'Media', 'missing.jpg'), 'missing', mtime);
      await writeFile(path.join(originPath, 'Media', 'conflict.jpg'), 'origin', mtime);
      await writeFile(path.join(backupPath, 'Media', 'conflict.jpg'), 'backup', mtime);
      await writeFile(path.join(backupPath, 'Media', 'backup-only.jpg'), 'backup-only', mtime);

      const pair = folderPairs.saveFolderPair({
        name: 'Origin to Backup',
        originPath,
        backupPath,
      });
      const scanResult = await scanner.scanPair(pair);
      const quickFolders = await summarizeDirectoryDifferences(pair, '', ignoreRules);
      const quickMediaChildren = await summarizeDirectoryDifferences(pair, 'Media', ignoreRules);
      const scannerDocuments = scanResult.folders.find((folder) => folder.relativePath === 'Documents')?.counts;
      const quickDocuments = quickFolders.find((folder) => folder.relativePath === 'Documents')?.counts;
      const scannerMedia = scanResult.folders.find((folder) => folder.relativePath === 'Media')?.counts;
      const quickMedia = quickFolders.find((folder) => folder.relativePath === 'Media')?.counts;
      const scannerMediaRoot = scanResult.folders.find((folder) => folder.relativePath === 'Media')?.counts;
      const quickMediaRoot = quickMediaChildren.find((folder) => folder.relativePath === 'Media')?.counts;

      expect(quickDocuments?.missingInBackup).toBe(scannerDocuments?.missingInBackup);
      expect(quickDocuments?.backupOnly).toBe(scannerDocuments?.backupOnly);
      expect(quickDocuments?.conflicts).toBe(scannerDocuments?.conflicts);
      expect(quickDocuments?.ignored).toBe(scannerDocuments?.ignored);
      expect(quickMedia?.missingInBackup).toBe(scannerMedia?.missingInBackup);
      expect(quickMedia?.backupOnly).toBe(scannerMedia?.backupOnly);
      expect(quickMedia?.conflicts).toBe(scannerMedia?.conflicts);
      expect(quickMediaRoot?.missingInBackup).toBe(scannerMediaRoot?.missingInBackup);
      expect(quickMediaRoot?.backupOnly).toBe(scannerMediaRoot?.backupOnly);
      expect(quickMediaRoot?.conflicts).toBe(scannerMediaRoot?.conflicts);
    } finally {
      db.close();
    }
  });
});
