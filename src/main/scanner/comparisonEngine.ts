import path from 'node:path';
import { toDisplayPath } from '../../shared/pathKeys';
import type { FileCompareItem, FileCompareState, FolderCompareItem, ScanSummary } from '../../shared/types';
import type { ScannedFile } from './fileWalker';

export interface CompareInput {
  originFiles: ScannedFile[];
  backupFiles: ScannedFile[];
  ignoredFiles: ScannedFile[];
  skippedFiles: ScannedFile[];
}

export interface CompareOutput {
  summary: ScanSummary;
  folders: FolderCompareItem[];
  files: FileCompareItem[];
}

export const createEmptySummary = (): ScanSummary => ({
  missingInBackup: 0,
  backupOnly: 0,
  identical: 0,
  conflicts: 0,
  ignored: 0,
  notLocalPlaceholder: 0,
  lockedOrUnreadable: 0,
  unstableChangingFile: 0,
  totalMissingSize: 0,
  totalBackupOnlySize: 0,
});

export const incrementSummary = (summary: ScanSummary, state: FileCompareState, sizeBytes: number): void => {
  if (state === 'missingInBackup') {
    summary.missingInBackup += 1;
    summary.totalMissingSize += sizeBytes;
    return;
  }

  if (state === 'backupOnly') {
    summary.backupOnly += 1;
    summary.totalBackupOnlySize += sizeBytes;
    return;
  }

  if (state === 'identical') {
    summary.identical += 1;
    return;
  }

  if (state === 'conflictSamePathDifferentContent') {
    summary.conflicts += 1;
    return;
  }

  if (state === 'ignored') {
    summary.ignored += 1;
    return;
  }

  if (state === 'notLocalPlaceholder') {
    summary.notLocalPlaceholder += 1;
    return;
  }

  if (state === 'lockedOrUnreadable') {
    summary.lockedOrUnreadable += 1;
    return;
  }

  if (state === 'unstableChangingFile') {
    summary.unstableChangingFile += 1;
  }
};

const fileContentMatches = (origin: ScannedFile, backup: ScannedFile): boolean => {
  if (origin.hash && backup.hash) {
    return origin.hash === backup.hash;
  }

  return origin.size === backup.size && origin.mtimeMs === backup.mtimeMs;
};

const mapSkippedState = (file: ScannedFile): FileCompareState => {
  if (file.availabilityState === 'cloudPlaceholder') {
    return 'notLocalPlaceholder';
  }

  if (file.availabilityState === 'locked' || file.availabilityState === 'unreadable') {
    return 'lockedOrUnreadable';
  }

  if (file.availabilityState === 'unstable') {
    return 'unstableChangingFile';
  }

  return 'lockedOrUnreadable';
};

const createFileItem = (
  relativePath: string,
  state: FileCompareState,
  origin: ScannedFile | null,
  backup: ScannedFile | null,
  sizeBytes: number,
  reason: string,
): FileCompareItem => ({
  relativePath,
  displayPath: toDisplayPath(relativePath),
  state,
  originPath: origin?.absolutePath ?? null,
  backupPath: backup?.absolutePath ?? null,
  sizeBytes,
  reason,
});

const folderPathsFor = (relativePath: string): string[] => {
  const normalized = toDisplayPath(relativePath);
  const folder = path.posix.dirname(normalized);

  if (folder === '.') {
    return [''];
  }

  const parts = folder.split('/');
  return ['', ...parts.map((_, index) => parts.slice(0, index + 1).join('/'))];
};

export const buildFolderSummaries = (files: FileCompareItem[]): FolderCompareItem[] => {
  const folderMap = new Map<string, ScanSummary>();

  for (const file of files) {
    for (const folder of folderPathsFor(file.relativePath)) {
      const summary = folderMap.get(folder) ?? createEmptySummary();
      incrementSummary(summary, file.state, file.sizeBytes);
      folderMap.set(folder, summary);
    }
  }

  return [...folderMap.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([relativePath, counts]) => ({
      relativePath,
      displayPath: relativePath === '' ? 'Root' : relativePath,
      counts,
    }));
};

export const compareFiles = (input: CompareInput): CompareOutput => {
  const summary = createEmptySummary();
  const files: FileCompareItem[] = [];
  const originByKey = new Map(input.originFiles.map((file) => [file.normalizedKey, file]));
  const backupByKey = new Map(input.backupFiles.map((file) => [file.normalizedKey, file]));
  const allKeys = new Set([...originByKey.keys(), ...backupByKey.keys()]);

  for (const key of [...allKeys].sort()) {
    const origin = originByKey.get(key) ?? null;
    const backup = backupByKey.get(key) ?? null;
    const relativePath = origin?.relativePath ?? backup?.relativePath ?? key;
    let state: FileCompareState;
    let sizeBytes = 0;
    let reason = '';

    if (origin && !backup) {
      state = 'missingInBackup';
      sizeBytes = origin.size;
      reason = 'Exists in origin but not in backup';
    } else if (!origin && backup) {
      state = 'backupOnly';
      sizeBytes = backup.size;
      reason = 'Exists in backup but not in origin';
    } else if (origin && backup && fileContentMatches(origin, backup)) {
      state = 'identical';
      sizeBytes = origin.size;
      reason = origin.hash && backup.hash ? 'Same SHA-256 hash' : 'Same size and modified time';
    } else {
      state = 'conflictSamePathDifferentContent';
      sizeBytes = Math.max(origin?.size ?? 0, backup?.size ?? 0);
      reason = origin?.hash && backup?.hash ? 'Same relative path with different hash' : 'Same relative path with different metadata';
    }

    incrementSummary(summary, state, sizeBytes);
    files.push(createFileItem(relativePath, state, origin, backup, sizeBytes, reason));
  }

  for (const ignored of input.ignoredFiles) {
    const item = createFileItem(
      ignored.relativePath,
      'ignored',
      ignored.side === 'origin' ? ignored : null,
      ignored.side === 'backup' ? ignored : null,
      ignored.size,
      ignored.ignoreReason ?? 'Ignored by rule',
    );
    incrementSummary(summary, item.state, item.sizeBytes);
    files.push(item);
  }

  for (const skipped of input.skippedFiles) {
    const state = mapSkippedState(skipped);
    const item = createFileItem(
      skipped.relativePath,
      state,
      skipped.side === 'origin' ? skipped : null,
      skipped.side === 'backup' ? skipped : null,
      skipped.size,
      skipped.availabilityState === 'cloudPlaceholder'
        ? 'Cloud placeholder is not local'
        : skipped.availabilityState === 'unstable'
          ? 'File changed while scanning'
          : 'File is not readable for scanning',
    );
    incrementSummary(summary, item.state, item.sizeBytes);
    files.push(item);
  }

  files.sort((left, right) => left.displayPath.localeCompare(right.displayPath));

  return {
    summary,
    folders: buildFolderSummaries(files),
    files,
  };
};
