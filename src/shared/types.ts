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

export type VerificationState = 'notStarted' | 'sizeVerified' | 'hashVerified' | 'failed';

export type VerificationLevel = 'auto' | 'basic' | 'strong';

export type QueueItemState = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

export type OperationState = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

export type OperationType = 'copy' | 'cleanup';

export type OperationAction = 'copyMissing' | 'copyConflictDuplicate' | 'cleanupBackupOnly';

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
  mirrorNavigationEnabled?: boolean;
  reminderIntervalDays?: number | null;
}

export interface UpdateFolderPairSettingsInput {
  id: number;
  mirrorNavigationEnabled?: boolean;
  reminderIntervalDays?: number | null;
}

export interface IgnoredFile {
  path: string;
  reason: string;
}

export interface IgnoreRuleSetting {
  id: number;
  category: string;
  pattern: string;
  reason: string;
  enabled: boolean;
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

export interface DirectoryDiffSamples {
  missingInBackup: string[];
  backupOnly: string[];
  conflicts: string[];
  ignored: string[];
  skipped: string[];
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

export interface DirectoryDiffSummary {
  relativePath: string;
  displayPath: string;
  counts: ScanSummary;
  samples?: DirectoryDiffSamples;
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

export type ScanProgressPhase = 'starting' | 'walking' | 'caching' | 'comparing' | 'complete';

export interface ScanProgressEvent {
  folderPairId: number;
  scanRunId: number | null;
  mode: ScanMode;
  phase: ScanProgressPhase;
  side: FolderSide | 'both';
  currentPath: string;
  filesDiscovered: number;
  foldersDiscovered: number;
  ignored: number;
  skipped: number;
  message: string;
}

export interface OperationRecord {
  id: number;
  folderPairId: number;
  type: OperationType;
  state: OperationState;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
}

export interface OperationQueueItem {
  id: number;
  operationId: number;
  action: OperationAction;
  relativePath: string;
  sourcePath: string | null;
  destinationPath: string | null;
  tempPath: string | null;
  state: QueueItemState;
  bytesTotal: number;
  bytesDone: number;
  currentSpeedBytesPerSecond: number;
  verificationState: VerificationState;
  verificationLevel: VerificationLevel;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface OperationTotals {
  totalItems: number;
  pendingItems: number;
  runningItems: number;
  pausedItems: number;
  completedItems: number;
  failedItems: number;
  cancelledItems: number;
  bytesTotal: number;
  bytesDone: number;
  currentSpeedBytesPerSecond: number;
}

export interface OperationSnapshot {
  operation: OperationRecord;
  items: OperationQueueItem[];
  totals: OperationTotals;
}

export interface CreateCopyOperationInput {
  folderPairId: number;
  selectedRelativePaths: string[];
  selectedFolderPaths?: string[];
  verificationLevel?: VerificationLevel;
}

export interface CleanupPreviewInput {
  folderPairId: number;
  selectedRelativePaths: string[];
  selectedFolderPaths?: string[];
}

export interface CleanupPreviewItem {
  relativePath: string;
  displayPath: string;
  backupPath: string;
  sizeBytes: number;
}

export interface CleanupPreview {
  filesSelected: number;
  foldersSelected: number;
  totalSize: number;
  items: CleanupPreviewItem[];
}

export type CreateCleanupOperationInput = CleanupPreviewInput;

export interface RecoveryReport {
  abandonedTempFilesRemoved: number;
  interruptedItemsMarkedFailed: number;
  interruptedOperationsMarkedFailed: number;
  pausedItems: number;
  failedItems: number;
}

export interface LastStatus {
  folderPair: FolderPair;
  lastScan: ScanResult | null;
}

export interface ChooseFolderResult {
  canceled: boolean;
  path: string | null;
}

export interface DirectoryPreviewEntry {
  name: string;
  relativePath: string;
  absolutePath: string;
  kind: 'folder' | 'file';
  sizeBytes: number;
  mtimeMs: number;
}

export interface SafeTwinApi {
  chooseFolder: () => Promise<ChooseFolderResult>;
  listDirectory: (rootPath: string, relativePath?: string) => Promise<DirectoryPreviewEntry[]>;
  summarizeDirectoryDifferences: (folderPairId: number, relativePath?: string) => Promise<DirectoryDiffSummary[]>;
  listFolderPairs: () => Promise<FolderPair[]>;
  saveFolderPair: (input: SaveFolderPairInput) => Promise<FolderPair>;
  updateFolderPairSettings: (input: UpdateFolderPairSettingsInput) => Promise<FolderPair>;
  listIgnoreRules: () => Promise<IgnoreRuleSetting[]>;
  setIgnoreRuleCategoryEnabled: (category: string, enabled: boolean) => Promise<IgnoreRuleSetting[]>;
  scanPair: (pairId: number, mode?: ScanMode) => Promise<ScanResult>;
  getIgnoredFiles: (pairId: number) => Promise<IgnoredFile[]>;
  getLastStatus: (pairId: number) => Promise<LastStatus>;
  createCopyOperation: (input: CreateCopyOperationInput) => Promise<OperationSnapshot>;
  createCleanupPreview: (input: CleanupPreviewInput) => Promise<CleanupPreview>;
  createCleanupOperation: (input: CreateCleanupOperationInput) => Promise<OperationSnapshot>;
  listOperations: (folderPairId?: number) => Promise<OperationSnapshot[]>;
  getOperation: (operationId: number) => Promise<OperationSnapshot>;
  startOperation: (operationId: number) => Promise<OperationSnapshot>;
  pauseOperation: (operationId: number) => Promise<OperationSnapshot>;
  resumeOperation: (operationId: number) => Promise<OperationSnapshot>;
  cancelOperation: (operationId: number) => Promise<OperationSnapshot>;
  retryFailedOperation: (operationId: number) => Promise<OperationSnapshot>;
  recoverOperations: () => Promise<RecoveryReport>;
  openFolder: (folderPath: string) => Promise<void>;
  showItemInFolder: (itemPath: string) => Promise<void>;
  onScanProgress: (callback: (event: ScanProgressEvent) => void) => () => void;
}
