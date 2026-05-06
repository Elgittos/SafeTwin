import fs from 'node:fs/promises';
import path from 'node:path';
import type { VerificationState } from '../../shared/types';
import type { SqliteDatabase } from '../db/sqlite';

export interface OperationLogEntry {
  type: 'copy' | 'cleanup' | 'recovery';
  operationId?: number;
  operationItemId?: number;
  source?: string | null;
  destination?: string | null;
  bytes?: number;
  verification?: VerificationState;
  message?: string;
  completedAt: string;
}

export class OperationLogger {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly jsonlPath: string,
  ) {}

  async write(entry: OperationLogEntry): Promise<void> {
    const payload = JSON.stringify(entry);
    this.db.run(
      `INSERT INTO operation_logs (operation_id, operation_item_id, type, payload)
       VALUES (?, ?, ?, ?)`,
      [entry.operationId ?? null, entry.operationItemId ?? null, entry.type, payload],
    );

    await fs.mkdir(path.dirname(this.jsonlPath), { recursive: true });
    await fs.appendFile(this.jsonlPath, `${payload}\n`, 'utf8');
  }
}
