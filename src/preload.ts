import { contextBridge, ipcRenderer } from 'electron';
import type { SafeTwinApi, SaveFolderPairInput, ScanMode } from './shared/types';

const api: SafeTwinApi = {
  chooseFolder: () => ipcRenderer.invoke('safetwin:choose-folder'),
  listFolderPairs: () => ipcRenderer.invoke('safetwin:list-folder-pairs'),
  saveFolderPair: (input: SaveFolderPairInput) => ipcRenderer.invoke('safetwin:save-folder-pair', input),
  scanPair: (pairId: number, mode: ScanMode = 'metadata') => ipcRenderer.invoke('safetwin:scan-pair', pairId, mode),
  getIgnoredFiles: (pairId: number) => ipcRenderer.invoke('safetwin:get-ignored-files', pairId),
  getLastStatus: (pairId: number) => ipcRenderer.invoke('safetwin:get-last-status', pairId),
};

contextBridge.exposeInMainWorld('safetwin', api);
