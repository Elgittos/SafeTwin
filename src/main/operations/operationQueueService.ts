import fsp from 'node:fs/promises';
import path from 'node:path';
import type {
  CleanupPreview,
  CleanupPreviewInput,
  CreateCleanupOperationInput,
  CreateCopyOperationInput,
  FileCompareItem,
  OperationQueueItem,
  OperationSnapshot,
  OperationState,
  RecoveryReport,
} from '../../shared/types';
import type { SqliteDatabase } from '../db/sqlite';
import { ScannerService } from '../scanner/scannerService';
import { FolderPairService } from '../services/folderPairService';
import { createAvailableConflictDuplicatePath, getTempCopyPath } from './destinationPlanner';
import { FileCopyService, OperationCancelledError } from './fileCopyService';
import { OperationLogger } from './operationLogger';
import { type NewOperationItem, OperationRepository } from './operationRepository';

interface QueueController {
  paused: boolean;
  cancelled: boolean;
  processing: boolean;
}

export interface OperationQueueDependencies {
  trashItem: (itemPath: string) => Promise<void>;
}

const normalizeRelativePath = (relativePath: string): string => relativePath.replaceAll('\\', '/').toLowerCase();

const isInsideSelectedFolder = (file: FileCompareItem, selectedFolderPaths: string[]): boolean => {
  const displayPath = file.displayPath.replaceAll('\\', '/');
  return selectedFolderPaths.some((folderPath) => {
    const normalizedFolder = folderPath.replaceAll('\\', '/').replace(/\/+$/, '');
    return displayPath === normalizedFolder || displayPath.startsWith(`${normalizedFolder}/`);
  });
};

const filterSelectedFiles = (
  files: FileCompareItem[],
  selectedRelativePaths: string[],
  selectedFolderPaths: string[] = [],
): FileCompareItem[] => {
  const selectedPaths = new Set(selectedRelativePaths.map(normalizeRelativePath));

  return files.filter(
    (file) => selectedPaths.has(normalizeRelativePath(file.relativePath)) || isInsideSelectedFolder(file, selectedFolderPaths),
  );
};

const getItemFailureMessage = (error: unknown): string => {
  if (error instanceof OperationCancelledError) {
    return 'Cancelled by user.';
  }

  return error instanceof Error ? error.message : 'Operation item failed.';
};

export class OperationQueueService {
  private readonly repository: OperationRepository;
  private readonly copyService = new FileCopyService();
  private readonly controllers = new Map<number, QueueController>();

  constructor(
    db: SqliteDatabase,
    private readonly folderPairs: FolderPairService,
    private readonly scanner: ScannerService,
    private readonly logger: OperationLogger,
    private readonly dependencies: OperationQueueDependencies,
  ) {
    this.repository = new OperationRepository(db);
  }

  async createCopyOperation(input: CreateCopyOperationInput): Promise<OperationSnapshot> {
    const pair = this.folderPairs.getFolderPair(input.folderPairId);
    const status = this.folderPairs.getLastStatus(pair.id);

    if (!status.lastScan) {
      throw new Error('Run a scan before creating a copy operation.');
    }

    const candidates = filterSelectedFiles(status.lastScan.files, input.selectedRelativePaths).filter(
      (file) => file.state === 'missingInBackup' || file.state === 'conflictSamePathDifferentContent',
    );

    if (candidates.length === 0) {
      throw new Error('Select missing or conflict files before creating a copy operation.');
    }

    const operation = this.repository.createOperation(pair.id, 'copy');

    for (const file of candidates) {
      if (!file.originPath) {
        continue;
      }

      const action = file.state === 'missingInBackup' ? 'copyMissing' : 'copyConflictDuplicate';
      const destinationPath =
        action === 'copyMissing'
          ? path.join(pair.backupPath, file.relativePath)
          : await createAvailableConflictDuplicatePath(file.backupPath ?? path.join(pair.backupPath, file.relativePath));
      const verificationLevel = input.verificationLevel ?? (status.lastScan.mode === 'deep' ? 'strong' : 'auto');
      const item: NewOperationItem = {
        action,
        relativePath: file.relativePath,
        sourcePath: file.originPath,
        destinationPath,
        tempPath: getTempCopyPath(destinationPath),
        bytesTotal: file.sizeBytes,
        verificationLevel,
      };

      this.repository.createOperationItem(operation.id, item);
    }

    return this.repository.getSnapshot(operation.id);
  }

  createCleanupPreview(input: CleanupPreviewInput): CleanupPreview {
    const status = this.folderPairs.getLastStatus(input.folderPairId);

    if (!status.lastScan) {
      throw new Error('Run a scan before opening cleanup mode.');
    }

    const items = filterSelectedFiles(
      status.lastScan.files,
      input.selectedRelativePaths,
      input.selectedFolderPaths ?? [],
    )
      .filter((file) => file.state === 'backupOnly' && file.backupPath)
      .map((file) => ({
        relativePath: file.relativePath,
        displayPath: file.displayPath,
        backupPath: file.backupPath ?? '',
        sizeBytes: file.sizeBytes,
      }));

    return {
      filesSelected: items.length,
      foldersSelected: input.selectedFolderPaths?.length ?? 0,
      totalSize: items.reduce((total, item) => total + item.sizeBytes, 0),
      items,
    };
  }

  async createCleanupOperation(input: CreateCleanupOperationInput): Promise<OperationSnapshot> {
    const pair = this.folderPairs.getFolderPair(input.folderPairId);
    const refreshed = await this.scanner.scanPair(pair);
    this.folderPairs.markScanned(pair.id, refreshed.completedAt);
    const preview = this.createCleanupPreview(input);

    if (preview.items.length === 0) {
      throw new Error('Selected cleanup items are no longer backup-only after the final rescan.');
    }

    const operation = this.repository.createOperation(pair.id, 'cleanup');

    for (const file of preview.items) {
      this.repository.createOperationItem(operation.id, {
        action: 'cleanupBackupOnly',
        relativePath: file.relativePath,
        sourcePath: file.backupPath,
        destinationPath: null,
        tempPath: null,
        bytesTotal: file.sizeBytes,
        verificationLevel: 'basic',
      });
    }

    return this.repository.getSnapshot(operation.id);
  }

  listOperations(folderPairId?: number): OperationSnapshot[] {
    return this.repository.listSnapshots(folderPairId);
  }

  getOperation(operationId: number): OperationSnapshot {
    return this.repository.getSnapshot(operationId);
  }

  async startOperation(operationId: number): Promise<OperationSnapshot> {
    const controller = this.getController(operationId);
    controller.cancelled = false;
    controller.paused = false;
    this.repository.updateOperationState(operationId, 'running');
    void this.processOperation(operationId);
    return this.repository.getSnapshot(operationId);
  }

  async pauseOperation(operationId: number): Promise<OperationSnapshot> {
    const controller = this.getController(operationId);
    controller.paused = true;
    this.repository.updateOperationState(operationId, 'paused');
    return this.repository.getSnapshot(operationId);
  }

  async resumeOperation(operationId: number): Promise<OperationSnapshot> {
    const controller = this.getController(operationId);
    controller.paused = false;
    controller.cancelled = false;
    this.repository.updateOperationState(operationId, 'running');
    void this.processOperation(operationId);
    return this.repository.getSnapshot(operationId);
  }

  async cancelOperation(operationId: number): Promise<OperationSnapshot> {
    const controller = this.getController(operationId);
    controller.cancelled = true;
    controller.paused = false;
    this.repository.cancelWaitingItems(operationId);
    this.repository.updateOperationState(operationId, 'cancelled');
    return this.repository.getSnapshot(operationId);
  }

  async retryFailedOperation(operationId: number): Promise<OperationSnapshot> {
    const controller = this.getController(operationId);
    controller.cancelled = false;
    controller.paused = false;
    this.repository.resetFailedItems(operationId);
    this.repository.updateOperationState(operationId, 'pending', null);
    return this.repository.getSnapshot(operationId);
  }

  async recoverInterruptedOperations(): Promise<RecoveryReport> {
    let abandonedTempFilesRemoved = 0;

    for (const tempPath of this.repository.listRecoverableTempPaths()) {
      try {
        await fsp.rm(tempPath, { force: true });
        abandonedTempFilesRemoved += 1;
      } catch {
        // Best-effort cleanup; failed item state still tells the user what happened.
      }
    }

    const interruptedItemsMarkedFailed = this.repository.markInterruptedRunningItemsFailed();
    const interruptedOperationsMarkedFailed = this.repository.markInterruptedRunningOperationsFailed();
    const report: RecoveryReport = {
      abandonedTempFilesRemoved,
      interruptedItemsMarkedFailed,
      interruptedOperationsMarkedFailed,
      pausedItems: this.repository.countItemsByState('paused'),
      failedItems: this.repository.countItemsByState('failed'),
    };

    if (abandonedTempFilesRemoved > 0 || interruptedItemsMarkedFailed > 0 || interruptedOperationsMarkedFailed > 0) {
      await this.logger.write({
        type: 'recovery',
        message: `Recovered ${abandonedTempFilesRemoved} temp files and ${interruptedItemsMarkedFailed} interrupted items.`,
        completedAt: new Date().toISOString(),
      });
    }

    return report;
  }

  private getController(operationId: number): QueueController {
    const existing = this.controllers.get(operationId);

    if (existing) {
      return existing;
    }

    const controller: QueueController = {
      paused: false,
      cancelled: false,
      processing: false,
    };
    this.controllers.set(operationId, controller);

    return controller;
  }

  private async processOperation(operationId: number): Promise<void> {
    const controller = this.getController(operationId);

    if (controller.processing) {
      return;
    }

    controller.processing = true;

    try {
      let snapshot = this.repository.getSnapshot(operationId);

      for (const item of snapshot.items) {
        if (item.state !== 'pending') {
          continue;
        }

        if (controller.cancelled) {
          this.repository.updateItemState(item.id, 'cancelled', 'Cancelled by user.');
          continue;
        }

        await this.waitIfPaused(operationId, item.id, controller);

        if (controller.cancelled) {
          this.repository.updateItemState(item.id, 'cancelled', 'Cancelled by user.');
          continue;
        }

        this.repository.updateItemState(item.id, 'running', null);

        try {
          if (item.action === 'cleanupBackupOnly') {
            await this.runCleanupItem(item);
          } else {
            await this.runCopyItem(item, controller);
          }
        } catch (error) {
          const message = getItemFailureMessage(error);
          const state = error instanceof OperationCancelledError ? 'cancelled' : 'failed';
          this.repository.updateItemState(item.id, state, message, 'failed');

          if (error instanceof OperationCancelledError) {
            controller.cancelled = true;
          }
        }
      }

      snapshot = this.repository.getSnapshot(operationId);
      const finalState = this.resolveFinalState(snapshot);

      if (finalState === 'completed') {
        try {
          const completedAt = new Date().toISOString();
          this.folderPairs.markOperationAt(snapshot.operation.folderPairId, completedAt);
          const pair = this.folderPairs.getFolderPair(snapshot.operation.folderPairId);
          const scanResult = await this.scanner.scanPair(pair);
          this.folderPairs.markScanned(pair.id, scanResult.completedAt);
          this.repository.updateOperationState(operationId, 'completed');
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Refresh scan failed after operation.';
          this.repository.updateOperationState(operationId, 'failed', `Operation completed but refresh scan failed: ${message}`);
        }
      } else {
        this.repository.updateOperationState(
          operationId,
          finalState,
          finalState === 'failed' ? 'One or more items failed.' : null,
        );
      }
    } finally {
      controller.processing = false;
    }
  }

  private async waitIfPaused(operationId: number, itemId: number, controller: QueueController): Promise<void> {
    if (!controller.paused) {
      return;
    }

    this.repository.updateItemState(itemId, 'paused');

    while (controller.paused && !controller.cancelled) {
      await new Promise((resolve) => {
        setTimeout(resolve, 150);
      });
    }

    if (!controller.cancelled) {
      this.repository.updateOperationState(operationId, 'running');
      this.repository.updateItemState(itemId, 'running');
    }
  }

  private async runCopyItem(item: OperationQueueItem, controller: QueueController): Promise<void> {
    if (!item.sourcePath || !item.destinationPath) {
      throw new Error('Copy item is missing a source or destination path.');
    }

    const verificationState = await this.copyService.copySafely({
      action: item.action,
      sourcePath: item.sourcePath,
      destinationPath: item.destinationPath,
      verificationLevel: item.verificationLevel,
      isCancelled: () => controller.cancelled,
      waitIfPaused: async () => this.waitIfPaused(item.operationId, item.id, controller),
      onProgress: (progress) => {
        this.repository.updateItemProgress(item.id, progress.bytesDone, progress.currentSpeedBytesPerSecond);
      },
    });

    this.repository.updateItemVerification(item.id, verificationState);
    this.repository.updateItemState(item.id, 'completed', null, verificationState);
    await this.logger.write({
      type: 'copy',
      operationId: item.operationId,
      operationItemId: item.id,
      source: item.sourcePath,
      destination: item.destinationPath,
      bytes: item.bytesTotal,
      verification: verificationState,
      completedAt: new Date().toISOString(),
    });
  }

  private async runCleanupItem(item: OperationQueueItem): Promise<void> {
    if (!item.sourcePath) {
      throw new Error('Cleanup item is missing a backup path.');
    }

    await this.dependencies.trashItem(item.sourcePath);
    this.repository.updateItemProgress(item.id, item.bytesTotal, 0);
    this.repository.updateItemVerification(item.id, 'sizeVerified');
    this.repository.updateItemState(item.id, 'completed', null, 'sizeVerified');
    await this.logger.write({
      type: 'cleanup',
      operationId: item.operationId,
      operationItemId: item.id,
      source: item.sourcePath,
      destination: null,
      bytes: item.bytesTotal,
      verification: 'sizeVerified',
      completedAt: new Date().toISOString(),
    });
  }

  private resolveFinalState(snapshot: OperationSnapshot): OperationState {
    if (snapshot.items.some((item) => item.state === 'failed')) {
      return 'failed';
    }

    if (snapshot.items.some((item) => item.state === 'cancelled')) {
      return 'cancelled';
    }

    if (snapshot.items.some((item) => item.state === 'paused')) {
      return 'paused';
    }

    if (snapshot.items.every((item) => item.state === 'completed')) {
      return 'completed';
    }

    return 'pending';
  }
}
