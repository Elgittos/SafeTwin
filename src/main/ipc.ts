import { dialog, ipcMain } from 'electron';
import type { SaveFolderPairInput, ScanMode } from '../shared/types';
import { initializeSchema } from './db/schema';
import { openDatabase } from './db/sqlite';
import { IgnoreRuleService } from './ignore/ignoreRules';
import { ScannerService } from './scanner/scannerService';
import { FolderPairService } from './services/folderPairService';

export const registerIpcHandlers = (): void => {
  const db = openDatabase();
  initializeSchema(db);

  const ignoreRules = new IgnoreRuleService(db);
  ignoreRules.initialize();

  const folderPairs = new FolderPairService(db);
  const scanner = new ScannerService(db, ignoreRules);

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
};
