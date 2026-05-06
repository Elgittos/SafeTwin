import type { FileCompareItem, ScanMode, ScanResult } from '../../shared/types';
import type { SqliteDatabase } from '../db/sqlite';
import type { ScannedFile } from './fileWalker';

export class ScanRepository {
  constructor(private readonly db: SqliteDatabase) {}

  createScanRun(folderPairId: number, mode: ScanMode, startedAt: string): number {
    return this.db.run(
      `INSERT INTO scan_runs (folder_pair_id, mode, started_at)
       VALUES (?, ?, ?)`,
      [folderPairId, mode, startedAt],
    ).lastInsertRowid;
  }

  insertFileEntry(scanRunId: number, file: ScannedFile): number {
    return this.db.run(
      `INSERT INTO file_entries (
        scan_run_id, side, relative_path, absolute_path, normalized_key, kind,
        size, mtime_ms, extension, availability_state, ignore_reason, hash, hash_calculated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        scanRunId,
        file.side,
        file.relativePath,
        file.absolutePath,
        file.normalizedKey,
        file.kind,
        file.size,
        file.mtimeMs,
        file.extension,
        file.availabilityState,
        file.ignoreReason,
        file.hash,
        file.hashCalculatedAt,
      ],
    ).lastInsertRowid;
  }

  insertCompareResult(
    scanRunId: number,
    item: FileCompareItem,
    originEntryId: number | null,
    backupEntryId: number | null,
  ): void {
    this.db.run(
      `INSERT INTO compare_results (
        scan_run_id, relative_path, state, origin_entry_id, backup_entry_id, size_bytes, reason
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [scanRunId, item.relativePath, item.state, originEntryId, backupEntryId, item.sizeBytes, item.reason],
    );
  }

  completeScanRun(result: ScanResult, totalOriginFiles: number, totalBackupFiles: number): void {
    this.db.run(
      `UPDATE scan_runs
       SET completed_at = ?,
           total_origin_files = ?,
           total_backup_files = ?,
           total_missing = ?,
           total_backup_only = ?,
           total_conflicts = ?,
           total_ignored = ?,
           total_skipped_placeholders = ?
       WHERE id = ?`,
      [
        result.completedAt,
        totalOriginFiles,
        totalBackupFiles,
        result.summary.missingInBackup,
        result.summary.backupOnly,
        result.summary.conflicts,
        result.summary.ignored,
        result.summary.notLocalPlaceholder,
        result.scanRunId,
      ],
    );
  }
}
