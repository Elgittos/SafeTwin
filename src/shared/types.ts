export type FileCompareState =
  | 'identical'
  | 'missingInBackup'
  | 'backupOnly'
  | 'conflictSamePathDifferentContent'
  | 'ignored'
  | 'notLocalPlaceholder'
  | 'lockedOrUnreadable'
  | 'unstableChangingFile';

export type LocalAvailability =
  | 'localReady'
  | 'cloudPlaceholder'
  | 'unreadable'
  | 'locked'
  | 'specialSkipped';

export type ScanMode = 'metadata' | 'deep';

export type FolderSide = 'origin' | 'backup';

export interface FolderPair {
  id: number;
  name: string;
  originPath: string;
  backupPath: string;
  mirrorNavigationEnabled: boolean;
  reminderIntervalDays: number | null;
  lastScanAt: string | null;
  lastOperationAt: string | null;
}

export interface SaveFolderPairInput {
  id?: number;
  name: string;
  originPath: string;
  backupPath: string;
}

export interface IgnoredFile {
  path: string;
  reason: string;
}

export interface ScanSummary {
  missingInBackup: number;
  backupOnly: number;
  identical: number;
  conflicts: number;
  ignored: number;
  notLocalPlaceholder: number;
  lockedOrUnreadable: number;
  unstableChangingFile: number;
  totalMissingSize: number;
  totalBackupOnlySize: number;
}

export interface FileCompareItem {
  relativePath: string;
  displayPath: string;
  state: FileCompareState;
  originPath: string | null;
  backupPath: string | null;
  sizeBytes: number;
  reason: string;
}

export interface FolderCompareItem {
  relativePath: string;
  displayPath: string;
  counts: ScanSummary;
}

export interface ScanResult {
  scanRunId: number;
  folderPairId: number;
  mode: ScanMode;
  startedAt: string;
  completedAt: string;
  summary: ScanSummary;
  folders: FolderCompareItem[];
  files: FileCompareItem[];
  ignoredFiles: IgnoredFile[];
}

export interface LastStatus {
  folderPair: FolderPair;
  lastScan: ScanResult | null;
}

export interface ChooseFolderResult {
  canceled: boolean;
  path: string | null;
}

export interface SafeTwinApi {
  chooseFolder: () => Promise<ChooseFolderResult>;
  listFolderPairs: () => Promise<FolderPair[]>;
  saveFolderPair: (input: SaveFolderPairInput) => Promise<FolderPair>;
  scanPair: (pairId: number, mode?: ScanMode) => Promise<ScanResult>;
  getIgnoredFiles: (pairId: number) => Promise<IgnoredFile[]>;
  getLastStatus: (pairId: number) => Promise<LastStatus>;
}
