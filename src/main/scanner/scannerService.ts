import type { FolderPair, IgnoredFile, ScanMode, ScanResult } from '../../shared/types';
import type { SqliteDatabase } from '../db/sqlite';
import type { IgnoreRuleService } from '../ignore/ignoreRules';
import { compareFiles } from './comparisonEngine';
import type { ScannedFile } from './fileWalker';
import { walkFiles } from './fileWalker';
import { ScanRepository } from './scanRepository';

export class ScannerService {
  private readonly repository: ScanRepository;

  constructor(
    db: SqliteDatabase,
    private readonly ignoreRules: IgnoreRuleService,
  ) {
    this.repository = new ScanRepository(db);
  }

  async scanPair(pair: FolderPair, mode: ScanMode = 'metadata'): Promise<ScanResult> {
    const startedAt = new Date().toISOString();
    const scanRunId = this.repository.createScanRun(pair.id, mode, startedAt);

    const [originWalk, backupWalk] = await Promise.all([
      walkFiles(pair.originPath, 'origin', this.ignoreRules),
      walkFiles(pair.backupPath, 'backup', this.ignoreRules),
    ]);

    const ignoredFiles = [...originWalk.ignoredFiles, ...backupWalk.ignoredFiles];
    const skippedFiles = [...originWalk.skippedFiles, ...backupWalk.skippedFiles];
    const scannedFiles = [...originWalk.files, ...backupWalk.files, ...ignoredFiles, ...skippedFiles];
    const entryIds = new Map<ScannedFile, number>();

    for (const file of scannedFiles) {
      entryIds.set(file, this.repository.insertFileEntry(scanRunId, file));
    }

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

    return result;
  }
}
