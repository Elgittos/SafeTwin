import type {
  FileCompareItem,
  FolderCompareItem,
  FolderPair,
  IgnoredFile,
  LastStatus,
  SaveFolderPairInput,
  ScanResult,
  ScanSummary,
} from '../../shared/types';
import { buildFolderSummaries, createEmptySummary, incrementSummary } from '../scanner/comparisonEngine';
import type { DbRow, SqliteDatabase } from '../db/sqlite';

interface FolderPairRow extends DbRow {
  id: number;
  name: string;
  origin_path: string;
  backup_path: string;
  mirror_navigation_enabled: number;
  reminder_interval_days: number | null;
  last_scan_at: string | null;
  last_operation_at: string | null;
}

const toFolderPair = (row: FolderPairRow): FolderPair => ({
  id: Number(row.id),
  name: String(row.name),
  originPath: String(row.origin_path),
  backupPath: String(row.backup_path),
  mirrorNavigationEnabled: Boolean(row.mirror_navigation_enabled),
  reminderIntervalDays: row.reminder_interval_days === null ? null : Number(row.reminder_interval_days),
  lastScanAt: row.last_scan_at === null ? null : String(row.last_scan_at),
  lastOperationAt: row.last_operation_at === null ? null : String(row.last_operation_at),
});

const summarizeFiles = (files: FileCompareItem[]): ScanSummary => {
  const summary = createEmptySummary();

  for (const file of files) {
    incrementSummary(summary, file.state, file.sizeBytes);
  }

  return summary;
};

export class FolderPairService {
  constructor(private readonly db: SqliteDatabase) {}

  listFolderPairs(): FolderPair[] {
    return this.db
      .all<FolderPairRow>(
        `SELECT id, name, origin_path, backup_path, mirror_navigation_enabled,
                reminder_interval_days, last_scan_at, last_operation_at
         FROM folder_pairs
         ORDER BY updated_at DESC, id DESC`,
      )
      .map(toFolderPair);
  }

  getFolderPair(id: number): FolderPair {
    const row = this.db.get<FolderPairRow>(
      `SELECT id, name, origin_path, backup_path, mirror_navigation_enabled,
              reminder_interval_days, last_scan_at, last_operation_at
       FROM folder_pairs
       WHERE id = ?`,
      [id],
    );

    if (!row) {
      throw new Error(`Folder pair ${id} was not found.`);
    }

    return toFolderPair(row);
  }

  saveFolderPair(input: SaveFolderPairInput): FolderPair {
    if (input.id) {
      this.db.run(
        `UPDATE folder_pairs
         SET name = ?, origin_path = ?, backup_path = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [input.name, input.originPath, input.backupPath, input.id],
      );
      return this.getFolderPair(input.id);
    }

    const id = this.db.run(
      `INSERT INTO folder_pairs (name, origin_path, backup_path)
       VALUES (?, ?, ?)`,
      [input.name, input.originPath, input.backupPath],
    ).lastInsertRowid;

    return this.getFolderPair(id);
  }

  markScanned(folderPairId: number, scannedAt: string): void {
    this.db.run(
      `UPDATE folder_pairs
       SET last_scan_at = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [scannedAt, folderPairId],
    );
  }

  markOperationAt(folderPairId: number, operationAt: string): void {
    this.db.run(
      `UPDATE folder_pairs
       SET last_operation_at = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [operationAt, folderPairId],
    );
  }

  getIgnoredFiles(folderPairId: number): IgnoredFile[] {
    const scanRun = this.db.get<{ id: number }>(
      `SELECT id
       FROM scan_runs
       WHERE folder_pair_id = ? AND completed_at IS NOT NULL
       ORDER BY completed_at DESC
       LIMIT 1`,
      [folderPairId],
    );

    if (!scanRun) {
      return [];
    }

    return this.db
      .all<{ relative_path: string; ignore_reason: string }>(
        `SELECT relative_path, ignore_reason
         FROM file_entries
         WHERE scan_run_id = ? AND ignore_reason IS NOT NULL
         ORDER BY relative_path ASC`,
        [Number(scanRun.id)],
      )
      .map((row) => ({
        path: String(row.relative_path).replaceAll('\\', '/'),
        reason: String(row.ignore_reason),
      }));
  }

  getLastStatus(folderPairId: number): LastStatus {
    const folderPair = this.getFolderPair(folderPairId);
    const scanRun = this.db.get<{
      id: number;
      mode: string;
      started_at: string;
      completed_at: string;
    }>(
      `SELECT id, mode, started_at, completed_at
       FROM scan_runs
       WHERE folder_pair_id = ? AND completed_at IS NOT NULL
       ORDER BY completed_at DESC
       LIMIT 1`,
      [folderPairId],
    );

    if (!scanRun) {
      return { folderPair, lastScan: null };
    }

    const files = this.db
      .all<{
        relative_path: string;
        state: string;
        size_bytes: number;
        reason: string;
        origin_path: string | null;
        backup_path: string | null;
      }>(
        `SELECT cr.relative_path, cr.state, cr.size_bytes, cr.reason,
                oe.absolute_path AS origin_path,
                be.absolute_path AS backup_path
         FROM compare_results cr
         LEFT JOIN file_entries oe ON oe.id = cr.origin_entry_id
         LEFT JOIN file_entries be ON be.id = cr.backup_entry_id
         WHERE cr.scan_run_id = ?
         ORDER BY cr.relative_path ASC`,
        [Number(scanRun.id)],
      )
      .map<FileCompareItem>((row) => ({
        relativePath: String(row.relative_path),
        displayPath: String(row.relative_path).replaceAll('\\', '/'),
        state: row.state as FileCompareItem['state'],
        originPath: row.origin_path === null ? null : String(row.origin_path),
        backupPath: row.backup_path === null ? null : String(row.backup_path),
        sizeBytes: Number(row.size_bytes),
        reason: String(row.reason),
      }));

    const folders: FolderCompareItem[] = buildFolderSummaries(files);
    const ignoredFiles = this.getIgnoredFiles(folderPairId);
    const lastScan: ScanResult = {
      scanRunId: Number(scanRun.id),
      folderPairId,
      mode: scanRun.mode as ScanResult['mode'],
      startedAt: String(scanRun.started_at),
      completedAt: String(scanRun.completed_at),
      summary: summarizeFiles(files),
      folders,
      files,
      ignoredFiles,
    };

    return {
      folderPair,
      lastScan,
    };
  }
}
