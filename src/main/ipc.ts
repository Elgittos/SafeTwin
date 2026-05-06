import { dialog, ipcMain, shell } from 'electron';
import type {
  CleanupPreviewInput,
  CreateCleanupOperationInput,
  CreateCopyOperationInput,
  SaveFolderPairInput,
  ScanMode,
} from '../shared/types';
import { initializeSchema } from './db/schema';
import { getOperationsLogPath, openDatabase } from './db/sqlite';
import { IgnoreRuleService } from './ignore/ignoreRules';
import { OperationLogger } from './operations/operationLogger';
import { OperationQueueService } from './operations/operationQueueService';
import { ScannerService } from './scanner/scannerService';
import { FolderPairService } from './services/folderPairService';

export const registerIpcHandlers = async (): Promise<void> => {
  const db = openDatabase();
  initializeSchema(db);

  const ignoreRules = new IgnoreRuleService(db);
  ignoreRules.initialize();

  const folderPairs = new FolderPairService(db);
  const scanner = new ScannerService(db, ignoreRules);
  const operationLogger = new OperationLogger(db, getOperationsLogPath());
  const operations = new OperationQueueService(db, folderPairs, scanner, operationLogger, {
    trashItem: (itemPath: string) => shell.trashItem(itemPath),
  });
  await operations.recoverInterruptedOperations();

  ipcMain.handle('safetwin:choose-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    });

    return {
      canceled: result.canceled,
      path: result.filePaths[0] ?? null,
    };
  });

  ipcMain.handle('safetwin:list-folder-pairs', () => folderPairs.listFolderPairs());

  ipcMain.handle('safetwin:save-folder-pair', (_event, input: SaveFolderPairInput) =>
    folderPairs.saveFolderPair(input),
  );

  ipcMain.handle('safetwin:scan-pair', async (_event, pairId: number, mode: ScanMode = 'metadata') => {
    const pair = folderPairs.getFolderPair(pairId);
    const result = await scanner.scanPair(pair, mode);
    folderPairs.markScanned(pair.id, result.completedAt);
    return result;
  });

  ipcMain.handle('safetwin:get-ignored-files', (_event, pairId: number) => folderPairs.getIgnoredFiles(pairId));

  ipcMain.handle('safetwin:get-last-status', (_event, pairId: number) => folderPairs.getLastStatus(pairId));

  ipcMain.handle('safetwin:create-copy-operation', (_event, input: CreateCopyOperationInput) =>
    operations.createCopyOperation(input),
  );

  ipcMain.handle('safetwin:create-cleanup-preview', (_event, input: CleanupPreviewInput) =>
    operations.createCleanupPreview(input),
  );

  ipcMain.handle('safetwin:create-cleanup-operation', (_event, input: CreateCleanupOperationInput) =>
    operations.createCleanupOperation(input),
  );

  ipcMain.handle('safetwin:list-operations', (_event, folderPairId?: number) => operations.listOperations(folderPairId));

  ipcMain.handle('safetwin:get-operation', (_event, operationId: number) => operations.getOperation(operationId));

  ipcMain.handle('safetwin:start-operation', (_event, operationId: number) => operations.startOperation(operationId));

  ipcMain.handle('safetwin:pause-operation', (_event, operationId: number) => operations.pauseOperation(operationId));

  ipcMain.handle('safetwin:resume-operation', (_event, operationId: number) => operations.resumeOperation(operationId));

  ipcMain.handle('safetwin:cancel-operation', (_event, operationId: number) => operations.cancelOperation(operationId));

  ipcMain.handle('safetwin:retry-failed-operation', (_event, operationId: number) =>
    operations.retryFailedOperation(operationId),
  );

  ipcMain.handle('safetwin:recover-operations', () => operations.recoverInterruptedOperations());

  ipcMain.handle('safetwin:open-folder', async (_event, folderPath: string) => {
    const errorMessage = await shell.openPath(folderPath);

    if (errorMessage) {
      throw new Error(errorMessage);
    }
  });

  ipcMain.handle('safetwin:show-item-in-folder', (_event, itemPath: string) => {
    shell.showItemInFolder(itemPath);
  });
};
