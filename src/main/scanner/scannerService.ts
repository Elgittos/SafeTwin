import type { FolderPair, FolderSide, IgnoredFile, ScanMode, ScanProgressEvent, ScanResult } from '../../shared/types';
import type { SqliteDatabase } from '../db/sqlite';
import type { IgnoreRuleService } from '../ignore/ignoreRules';
import { compareFiles } from './comparisonEngine';
import type { ScannedFile } from './fileWalker';
import { walkFiles } from './fileWalker';
import { ScanRepository } from './scanRepository';

export type ScanProgressCallback = (event: ScanProgressEvent) => void;

export interface ScanOptions {
  onProgress?: ScanProgressCallback;
}

export class ScannerService {
  private readonly repository: ScanRepository;

  constructor(
    db: SqliteDatabase,
    private readonly ignoreRules: IgnoreRuleService,
  ) {
    this.repository = new ScanRepository(db);
  }

  async scanPair(pair: FolderPair, mode: ScanMode = 'metadata', options: ScanOptions = {}): Promise<ScanResult> {
    const startedAt = new Date().toISOString();
    const scanRunId = this.repository.createScanRun(pair.id, mode, startedAt);
    const emitProgress = (
      phase: ScanProgressEvent['phase'],
      side: FolderSide | 'both',
      message: string,
      values: Partial<ScanProgressEvent> = {},
    ): void => {
      options.onProgress?.({
        folderPairId: pair.id,
        scanRunId,
        mode,
        phase,
        side,
        currentPath: '',
        filesDiscovered: 0,
        foldersDiscovered: 0,
        ignored: 0,
        skipped: 0,
        message,
        ...values,
      });
    };

    emitProgress('starting', 'both', 'Starting scan');

    const [originWalk, backupWalk] = await Promise.all([
      walkFiles(pair.originPath, 'origin', this.ignoreRules, {
        mode,
        onProgress: (progress) => {
          emitProgress('walking', 'origin', `Scanning origin: ${progress.filesDiscovered} files`, progress);
        },
      }),
      walkFiles(pair.backupPath, 'backup', this.ignoreRules, {
        mode,
        onProgress: (progress) => {
          emitProgress('walking', 'backup', `Scanning backup: ${progress.filesDiscovered} files`, progress);
        },
      }),
    ]);

    emitProgress('caching', 'both', 'Writing scan cache', {
      filesDiscovered: originWalk.files.length + backupWalk.files.length,
      foldersDiscovered: originWalk.foldersDiscovered + backupWalk.foldersDiscovered,
      ignored: originWalk.ignoredFiles.length + backupWalk.ignoredFiles.length,
      skipped: originWalk.skippedFiles.length + backupWalk.skippedFiles.length,
    });

    const ignoredFiles = [...originWalk.ignoredFiles, ...backupWalk.ignoredFiles];
    const skippedFiles = [...originWalk.skippedFiles, ...backupWalk.skippedFiles];
    const scannedFiles = [...originWalk.files, ...backupWalk.files, ...ignoredFiles, ...skippedFiles];
    const entryIds = new Map<ScannedFile, number>();

    for (const file of scannedFiles) {
      entryIds.set(file, this.repository.insertFileEntry(scanRunId, file));
    }

    emitProgress('comparing', 'both', 'Comparing folders', {
      filesDiscovered: originWalk.files.length + backupWalk.files.length,
      foldersDiscovered: originWalk.foldersDiscovered + backupWalk.foldersDiscovered,
      ignored: ignoredFiles.length,
      skipped: skippedFiles.length,
    });

    const comparison = compareFiles({
      originFiles: originWalk.files,
      backupFiles: backupWalk.files,
      ignoredFiles,
      skippedFiles,
    });

    for (const item of comparison.files) {
      const origin = scannedFiles.find((file) => file.absolutePath === item.originPath) ?? null;
      const backup = scannedFiles.find((file) => file.absolutePath === item.backupPath) ?? null;
      this.repository.insertCompareResult(
        scanRunId,
        item,
        origin ? entryIds.get(origin) ?? null : null,
        backup ? entryIds.get(backup) ?? null : null,
      );
    }

    const result: ScanResult = {
      scanRunId,
      folderPairId: pair.id,
      mode,
      startedAt,
      completedAt: new Date().toISOString(),
      ...comparison,
      ignoredFiles: ignoredFiles.map<IgnoredFile>((file) => ({
        path: file.displayPath,
        reason: file.ignoreReason ?? 'Ignored by rule',
      })),
    };

    this.repository.completeScanRun(result, originWalk.files.length, backupWalk.files.length);
    emitProgress('complete', 'both', 'Scan complete', {
      filesDiscovered: originWalk.files.length + backupWalk.files.length,
      foldersDiscovered: originWalk.foldersDiscovered + backupWalk.foldersDiscovered,
      ignored: ignoredFiles.length,
      skipped: skippedFiles.length,
    });

    return result;
  }
}
