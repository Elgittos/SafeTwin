import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { initializeSchema } from '../src/main/db/schema';
import { openDatabase } from '../src/main/db/sqlite';
import { IgnoreRuleService } from '../src/main/ignore/ignoreRules';
import { OperationLogger } from '../src/main/operations/operationLogger';
import { OperationQueueService } from '../src/main/operations/operationQueueService';
import { OperationRepository } from '../src/main/operations/operationRepository';
import { ScannerService } from '../src/main/scanner/scannerService';
import { FolderPairService } from '../src/main/services/folderPairService';
import type { FolderPair, OperationSnapshot } from '../src/shared/types';

let tempRoots: string[] = [];

const writeFile = async (filePath: string, content: string, mtime: Date) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
  await fs.utimes(filePath, mtime, mtime);
};

const waitForTerminalOperation = async (
  operations: OperationQueueService,
  operationId: number,
): Promise<OperationSnapshot> => {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const snapshot = operations.getOperation(operationId);

    if (['completed', 'failed', 'cancelled'].includes(snapshot.operation.state)) {
      return snapshot;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
  }

  throw new Error('Operation did not finish.');
};

const setupServices = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'safetwin-ops-'));
  tempRoots.push(root);

  const db = openDatabase(path.join(root, 'cache.sqlite'));
  initializeSchema(db);
  const ignoreRules = new IgnoreRuleService(db);
  ignoreRules.initialize();
  const folderPairs = new FolderPairService(db);
  const scanner = new ScannerService(db, ignoreRules);
  const trashRoot = path.join(root, 'trash');
  const logger = new OperationLogger(db, path.join(root, 'logs', 'operations.jsonl'));
  const operations = new OperationQueueService(db, folderPairs, scanner, logger, {
    trashItem: async (itemPath: string) => {
      await fs.mkdir(trashRoot, { recursive: true });
      await fs.rename(itemPath, path.join(trashRoot, path.basename(itemPath)));
    },
  });

  return {
    root,
    db,
    folderPairs,
    scanner,
    operations,
    trashRoot,
  };
};

const createScannedPair = async (
  folderPairs: FolderPairService,
  scanner: ScannerService,
  root: string,
): Promise<FolderPair> => {
  const originPath = path.join(root, 'origin');
  const backupPath = path.join(root, 'backup');
  const mtime = new Date('2026-05-06T12:00:00.000Z');
  await fs.mkdir(originPath, { recursive: true });
  await fs.mkdir(backupPath, { recursive: true });
  await writeFile(path.join(originPath, 'missing.txt'), 'missing', mtime);
  await writeFile(path.join(originPath, 'nested', 'conflict.txt'), 'origin', mtime);
  await writeFile(path.join(backupPath, 'nested', 'conflict.txt'), 'backup-changed', mtime);
  await writeFile(path.join(backupPath, 'backup-only.txt'), 'backup only', mtime);

  const pair = folderPairs.saveFolderPair({
    name: 'Origin to Backup',
    originPath,
    backupPath,
  });
  const result = await scanner.scanPair(pair);
  folderPairs.markScanned(pair.id, result.completedAt);

  return pair;
};

describe('OperationQueueService', () => {
  afterEach(async () => {
    for (const root of tempRoots) {
      await fs.rm(root, { recursive: true, force: true });
    }
    tempRoots = [];
  });

  it('copies missing files and conflict duplicates with verification and logs', async () => {
    const { root, db, folderPairs, scanner, operations } = await setupServices();

    try {
      const pair = await createScannedPair(folderPairs, scanner, root);
      const copyOperation = await operations.createCopyOperation({
        folderPairId: pair.id,
        selectedRelativePaths: ['missing.txt', path.join('nested', 'conflict.txt')],
        verificationLevel: 'strong',
      });

      await operations.startOperation(copyOperation.operation.id);
      const completed = await waitForTerminalOperation(operations, copyOperation.operation.id);

      expect(completed.operation.state).toBe('completed');
      expect(completed.items).toHaveLength(2);
      expect(completed.items.every((item) => item.verificationState === 'hashVerified')).toBe(true);
      await expect(fs.readFile(path.join(pair.backupPath, 'missing.txt'), 'utf8')).resolves.toBe('missing');

      const conflictDestination = completed.items.find((item) => item.action === 'copyConflictDuplicate')?.destinationPath;
      expect(conflictDestination).toContain('origin copy');
      await expect(fs.readFile(conflictDestination ?? '', 'utf8')).resolves.toBe('origin');

      const logText = await fs.readFile(path.join(root, 'logs', 'operations.jsonl'), 'utf8');
      expect(logText).toContain('"type":"copy"');
    } finally {
      db.close();
    }
  });

  it('previews and runs cleanup through the injected trash handler', async () => {
    const { root, db, folderPairs, scanner, operations, trashRoot } = await setupServices();

    try {
      const pair = await createScannedPair(folderPairs, scanner, root);
      const preview = operations.createCleanupPreview({
        folderPairId: pair.id,
        selectedRelativePaths: ['backup-only.txt'],
      });

      expect(preview).toMatchObject({
        filesSelected: 1,
        foldersSelected: 0,
      });

      const cleanupOperation = await operations.createCleanupOperation({
        folderPairId: pair.id,
        selectedRelativePaths: ['backup-only.txt'],
      });
      await operations.startOperation(cleanupOperation.operation.id);
      const completed = await waitForTerminalOperation(operations, cleanupOperation.operation.id);

      expect(completed.operation.state).toBe('completed');
      await expect(fs.readFile(path.join(trashRoot, 'backup-only.txt'), 'utf8')).resolves.toBe('backup only');
      await expect(fs.stat(path.join(pair.backupPath, 'backup-only.txt'))).rejects.toThrow();
    } finally {
      db.close();
    }
  });

  it('creates copy operations from selected folders', async () => {
    const { root, db, folderPairs, scanner, operations } = await setupServices();

    try {
      const pair = await createScannedPair(folderPairs, scanner, root);
      const copyOperation = await operations.createCopyOperation({
        folderPairId: pair.id,
        selectedRelativePaths: [],
        selectedFolderPaths: ['nested'],
        verificationLevel: 'basic',
      });

      expect(copyOperation.items).toHaveLength(1);
      expect(copyOperation.items[0].action).toBe('copyConflictDuplicate');
    } finally {
      db.close();
    }
  });

  it('copies one visible missing file without requiring a scan cache', async () => {
    const { root, db, folderPairs, operations } = await setupServices();
    const originPath = path.join(root, 'origin');
    const backupPath = path.join(root, 'backup');
    const mtime = new Date('2026-05-06T12:00:00.000Z');

    try {
      await fs.mkdir(backupPath, { recursive: true });
      await writeFile(path.join(originPath, 'single.txt'), 'single visible file', mtime);
      const pair = folderPairs.saveFolderPair({
        name: 'Origin to Backup',
        originPath,
        backupPath,
      });
      const copyOperation = await operations.createSingleCopyOperation({
        folderPairId: pair.id,
        relativePath: 'single.txt',
        action: 'copyMissing',
        verificationLevel: 'basic',
      });

      await operations.startOperation(copyOperation.operation.id);
      const completed = await waitForTerminalOperation(operations, copyOperation.operation.id);

      expect(completed.operation.state).toBe('completed');
      expect(completed.items).toHaveLength(1);
      expect(completed.items[0].action).toBe('copyMissing');
      await expect(fs.readFile(path.join(backupPath, 'single.txt'), 'utf8')).resolves.toBe('single visible file');
    } finally {
      db.close();
    }
  });

  it('creates copy operations from the root folder selection', async () => {
    const { root, db, folderPairs, scanner, operations } = await setupServices();

    try {
      const pair = await createScannedPair(folderPairs, scanner, root);
      const copyOperation = await operations.createCopyOperation({
        folderPairId: pair.id,
        selectedRelativePaths: [],
        selectedFolderPaths: [''],
        verificationLevel: 'basic',
      });

      expect(copyOperation.items.map((item) => item.action).sort()).toEqual([
        'copyConflictDuplicate',
        'copyMissing',
      ]);
    } finally {
      db.close();
    }
  });

  it('removes abandoned temp files and marks interrupted running rows failed', async () => {
    const { root, db, folderPairs, operations } = await setupServices();
    const repository = new OperationRepository(db);
    const pair = folderPairs.saveFolderPair({
      name: 'Recovery pair',
      originPath: path.join(root, 'origin'),
      backupPath: path.join(root, 'backup'),
    });
    const operation = repository.createOperation(pair.id, 'copy');
    const tempPath = path.join(root, 'abandoned.__safetwin_tmp__');
    await fs.writeFile(tempPath, 'partial');
    const item = repository.createOperationItem(operation.id, {
      action: 'copyMissing',
      relativePath: 'abandoned.txt',
      sourcePath: path.join(root, 'origin', 'abandoned.txt'),
      destinationPath: path.join(root, 'backup', 'abandoned.txt'),
      tempPath,
      bytesTotal: 7,
      verificationLevel: 'auto',
    });
    repository.updateOperationState(operation.id, 'running');
    repository.updateItemState(item.id, 'running');

    try {
      const report = await operations.recoverInterruptedOperations();

      expect(report.abandonedTempFilesRemoved).toBe(1);
      expect(report.interruptedItemsMarkedFailed).toBe(1);
      expect(report.interruptedOperationsMarkedFailed).toBe(1);
      await expect(fs.stat(tempPath)).rejects.toThrow();
      expect(repository.getSnapshot(operation.id).operation.state).toBe('failed');
    } finally {
      db.close();
    }
  });
});
