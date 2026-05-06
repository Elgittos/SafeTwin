import type { SqliteDatabase } from './sqlite';

export const initializeSchema = (db: SqliteDatabase): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS folder_pairs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      origin_path TEXT NOT NULL,
      backup_path TEXT NOT NULL,
      mirror_navigation_enabled INTEGER NOT NULL DEFAULT 1,
      reminder_interval_days INTEGER,
      last_scan_at TEXT,
      last_operation_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS scan_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folder_pair_id INTEGER NOT NULL,
      mode TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      total_origin_files INTEGER NOT NULL DEFAULT 0,
      total_backup_files INTEGER NOT NULL DEFAULT 0,
      total_missing INTEGER NOT NULL DEFAULT 0,
      total_backup_only INTEGER NOT NULL DEFAULT 0,
      total_conflicts INTEGER NOT NULL DEFAULT 0,
      total_ignored INTEGER NOT NULL DEFAULT 0,
      total_skipped_placeholders INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (folder_pair_id) REFERENCES folder_pairs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS file_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scan_run_id INTEGER NOT NULL,
      side TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      absolute_path TEXT NOT NULL,
      normalized_key TEXT NOT NULL,
      kind TEXT NOT NULL,
      size INTEGER NOT NULL DEFAULT 0,
      mtime_ms REAL NOT NULL DEFAULT 0,
      extension TEXT NOT NULL DEFAULT '',
      availability_state TEXT NOT NULL,
      ignore_reason TEXT,
      hash TEXT,
      hash_calculated_at TEXT,
      FOREIGN KEY (scan_run_id) REFERENCES scan_runs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS compare_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scan_run_id INTEGER NOT NULL,
      relative_path TEXT NOT NULL,
      state TEXT NOT NULL,
      origin_entry_id INTEGER,
      backup_entry_id INTEGER,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      reason TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (scan_run_id) REFERENCES scan_runs(id) ON DELETE CASCADE,
      FOREIGN KEY (origin_entry_id) REFERENCES file_entries(id) ON DELETE SET NULL,
      FOREIGN KEY (backup_entry_id) REFERENCES file_entries(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS ignore_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      pattern TEXT NOT NULL UNIQUE,
      reason TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS operations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folder_pair_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      state TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT,
      error_message TEXT,
      FOREIGN KEY (folder_pair_id) REFERENCES folder_pairs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS operation_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      operation_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      source_path TEXT,
      destination_path TEXT,
      state TEXT NOT NULL,
      bytes_total INTEGER NOT NULL DEFAULT 0,
      bytes_done INTEGER NOT NULL DEFAULT 0,
      verification_state TEXT,
      error_message TEXT,
      FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_file_entries_scan_key ON file_entries(scan_run_id, normalized_key);
    CREATE INDEX IF NOT EXISTS idx_compare_results_scan_state ON compare_results(scan_run_id, state);
  `);
};
