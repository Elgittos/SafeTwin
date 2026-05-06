import { contextBridge, ipcRenderer } from 'electron';
import type {
  CleanupPreviewInput,
  CreateCleanupOperationInput,
  CreateCopyOperationInput,
  SafeTwinApi,
  SaveFolderPairInput,
  ScanMode,
  UpdateFolderPairSettingsInput,
} from './shared/types';

const api: SafeTwinApi = {
  chooseFolder: () => ipcRenderer.invoke('safetwin:choose-folder'),
  listFolderPairs: () => ipcRenderer.invoke('safetwin:list-folder-pairs'),
  saveFolderPair: (input: SaveFolderPairInput) => ipcRenderer.invoke('safetwin:save-folder-pair', input),
  updateFolderPairSettings: (input: UpdateFolderPairSettingsInput) =>
    ipcRenderer.invoke('safetwin:update-folder-pair-settings', input),
  listIgnoreRules: () => ipcRenderer.invoke('safetwin:list-ignore-rules'),
  setIgnoreRuleCategoryEnabled: (category: string, enabled: boolean) =>
    ipcRenderer.invoke('safetwin:set-ignore-rule-category-enabled', category, enabled),
  scanPair: (pairId: number, mode: ScanMode = 'metadata') => ipcRenderer.invoke('safetwin:scan-pair', pairId, mode),
  getIgnoredFiles: (pairId: number) => ipcRenderer.invoke('safetwin:get-ignored-files', pairId),
  getLastStatus: (pairId: number) => ipcRenderer.invoke('safetwin:get-last-status', pairId),
  createCopyOperation: (input: CreateCopyOperationInput) => ipcRenderer.invoke('safetwin:create-copy-operation', input),
  createCleanupPreview: (input: CleanupPreviewInput) => ipcRenderer.invoke('safetwin:create-cleanup-preview', input),
  createCleanupOperation: (input: CreateCleanupOperationInput) =>
    ipcRenderer.invoke('safetwin:create-cleanup-operation', input),
  listOperations: (folderPairId?: number) => ipcRenderer.invoke('safetwin:list-operations', folderPairId),
  getOperation: (operationId: number) => ipcRenderer.invoke('safetwin:get-operation', operationId),
  startOperation: (operationId: number) => ipcRenderer.invoke('safetwin:start-operation', operationId),
  pauseOperation: (operationId: number) => ipcRenderer.invoke('safetwin:pause-operation', operationId),
  resumeOperation: (operationId: number) => ipcRenderer.invoke('safetwin:resume-operation', operationId),
  cancelOperation: (operationId: number) => ipcRenderer.invoke('safetwin:cancel-operation', operationId),
  retryFailedOperation: (operationId: number) => ipcRenderer.invoke('safetwin:retry-failed-operation', operationId),
  recoverOperations: () => ipcRenderer.invoke('safetwin:recover-operations'),
  openFolder: (folderPath: string) => ipcRenderer.invoke('safetwin:open-folder', folderPath),
  showItemInFolder: (itemPath: string) => ipcRenderer.invoke('safetwin:show-item-in-folder', itemPath),
};

contextBridge.exposeInMainWorld('safetwin', api);
