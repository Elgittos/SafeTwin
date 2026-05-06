import type {
  OperationAction,
  OperationQueueItem,
  OperationRecord,
  OperationSnapshot,
  OperationState,
  OperationTotals,
  OperationType,
  QueueItemState,
  VerificationLevel,
  VerificationState,
} from '../../shared/types';
import type { DbRow, DbValue, SqliteDatabase } from '../db/sqlite';

interface OperationRow extends DbRow {
  id: number;
  folder_pair_id: number;
  type: string;
  state: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
}

interface OperationItemRow extends DbRow {
  id: number;
  operation_id: number;
  action: string;
  relative_path: string;
  source_path: string | null;
  destination_path: string | null;
  temp_path: string | null;
  state: string;
  bytes_total: number;
  bytes_done: number;
  current_speed_bytes_per_second: number;
  verification_state: string;
  verification_level: string;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
}

export interface NewOperationItem {
  action: OperationAction;
  relativePath: string;
  sourcePath: string | null;
  destinationPath: string | null;
  tempPath: string | null;
  bytesTotal: number;
  verificationLevel: VerificationLevel;
}

const toOperation = (row: OperationRow): OperationRecord => ({
  id: Number(row.id),
  folderPairId: Number(row.folder_pair_id),
  type: row.type as OperationType,
  state: row.state as OperationState,
  createdAt: String(row.created_at),
  startedAt: row.started_at === null ? null : String(row.started_at),
  completedAt: row.completed_at === null ? null : String(row.completed_at),
  errorMessage: row.error_message === null ? null : String(row.error_message),
});

const toItem = (row: OperationItemRow): OperationQueueItem => ({
  id: Number(row.id),
  operationId: Number(row.operation_id),
  action: row.action as OperationAction,
  relativePath: String(row.relative_path),
  sourcePath: row.source_path === null ? null : String(row.source_path),
  destinationPath: row.destination_path === null ? null : String(row.destination_path),
  tempPath: row.temp_path === null ? null : String(row.temp_path),
  state: row.state as QueueItemState,
  bytesTotal: Number(row.bytes_total),
  bytesDone: Number(row.bytes_done),
  currentSpeedBytesPerSecond: Number(row.current_speed_bytes_per_second),
  verificationState: row.verification_state as VerificationState,
  verificationLevel: row.verification_level as VerificationLevel,
  errorMessage: row.error_message === null ? null : String(row.error_message),
  startedAt: row.started_at === null ? null : String(row.started_at),
  completedAt: row.completed_at === null ? null : String(row.completed_at),
});

const buildTotals = (items: OperationQueueItem[]): OperationTotals => ({
  totalItems: items.length,
  pendingItems: items.filter((item) => item.state === 'pending').length,
  runningItems: items.filter((item) => item.state === 'running').length,
  pausedItems: items.filter((item) => item.state === 'paused').length,
  completedItems: items.filter((item) => item.state === 'completed').length,
  failedItems: items.filter((item) => item.state === 'failed').length,
  cancelledItems: items.filter((item) => item.state === 'cancelled').length,
  bytesTotal: items.reduce((total, item) => total + item.bytesTotal, 0),
  bytesDone: items.reduce((total, item) => total + item.bytesDone, 0),
  currentSpeedBytesPerSecond: items
    .filter((item) => item.state === 'running')
    .reduce((total, item) => total + item.currentSpeedBytesPerSecond, 0),
});

export class OperationRepository {
  constructor(private readonly db: SqliteDatabase) {}

  createOperation(folderPairId: number, type: OperationType): OperationRecord {
    const id = this.db.run(
      `INSERT INTO operations (folder_pair_id, type, state)
       VALUES (?, ?, 'pending')`,
      [folderPairId, type],
    ).lastInsertRowid;

    return this.getOperation(id);
  }

  createOperationItem(operationId: number, item: NewOperationItem): OperationQueueItem {
    const id = this.db.run(
      `INSERT INTO operation_items (
        operation_id, action, relative_path, source_path, destination_path, temp_path,
        state, bytes_total, bytes_done, current_speed_bytes_per_second,
        verification_state, verification_level
      )
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, 0, 0, 'notStarted', ?)`,
      [
        operationId,
        item.action,
        item.relativePath,
        item.sourcePath,
        item.destinationPath,
        item.tempPath,
        item.bytesTotal,
        item.verificationLevel,
      ],
    ).lastInsertRowid;

    return this.getItem(id);
  }

  getOperation(operationId: number): OperationRecord {
    const row = this.db.get<OperationRow>(
      `SELECT id, folder_pair_id, type, state, created_at, started_at, completed_at, error_message
       FROM operations
       WHERE id = ?`,
      [operationId],
    );

    if (!row) {
      throw new Error(`Operation ${operationId} was not found.`);
    }

    return toOperation(row);
  }

  listOperations(folderPairId?: number): OperationRecord[] {
    const where = folderPairId ? 'WHERE folder_pair_id = ?' : '';
    const params: DbValue[] = folderPairId ? [folderPairId] : [];

    return this.db
      .all<OperationRow>(
        `SELECT id, folder_pair_id, type, state, created_at, started_at, completed_at, error_message
         FROM operations
         ${where}
         ORDER BY created_at DESC, id DESC`,
        params,
      )
      .map(toOperation);
  }

  getItem(itemId: number): OperationQueueItem {
    const row = this.db.get<OperationItemRow>(
      `SELECT id, operation_id, action, relative_path, source_path, destination_path, temp_path,
              state, bytes_total, bytes_done, current_speed_bytes_per_second,
              verification_state, verification_level, error_message, started_at, completed_at
       FROM operation_items
       WHERE id = ?`,
      [itemId],
    );

    if (!row) {
      throw new Error(`Operation item ${itemId} was not found.`);
    }

    return toItem(row);
  }

  listItems(operationId: number): OperationQueueItem[] {
    return this.db
      .all<OperationItemRow>(
        `SELECT id, operation_id, action, relative_path, source_path, destination_path, temp_path,
                state, bytes_total, bytes_done, current_speed_bytes_per_second,
                verification_state, verification_level, error_message, started_at, completed_at
         FROM operation_items
         WHERE operation_id = ?
         ORDER BY id ASC`,
        [operationId],
      )
      .map(toItem);
  }

  getSnapshot(operationId: number): OperationSnapshot {
    const operation = this.getOperation(operationId);
    const items = this.listItems(operationId);

    return {
      operation,
      items,
      totals: buildTotals(items),
    };
  }

  listSnapshots(folderPairId?: number): OperationSnapshot[] {
    return this.listOperations(folderPairId).map((operation) => this.getSnapshot(operation.id));
  }

  updateOperationState(operationId: number, state: OperationState, errorMessage: string | null = null): void {
    const now = new Date().toISOString();
    const startedAtSql = state === 'running' ? ', started_at = COALESCE(started_at, ?)' : '';
    const completedAtSql =
      state === 'completed' || state === 'failed' || state === 'cancelled' ? ', completed_at = ?' : '';
    const params: DbValue[] = [state];

    if (state === 'running') {
      params.push(now);
    }

    if (state === 'completed' || state === 'failed' || state === 'cancelled') {
      params.push(now);
    }

    params.push(errorMessage, operationId);

    this.db.run(
      `UPDATE operations
       SET state = ?${startedAtSql}${completedAtSql}, error_message = ?
       WHERE id = ?`,
      params,
    );
  }

  updateItemState(
    itemId: number,
    state: QueueItemState,
    errorMessage: string | null = null,
    verificationState?: VerificationState,
  ): void {
    const now = new Date().toISOString();
    const startedAtSql = state === 'running' ? ', started_at = COALESCE(started_at, ?)' : '';
    const completedAtSql =
      state === 'completed' || state === 'failed' || state === 'cancelled' ? ', completed_at = ?' : '';
    const verificationSql = verificationState ? ', verification_state = ?' : '';
    const params: DbValue[] = [state];

    if (state === 'running') {
      params.push(now);
    }

    if (state === 'completed' || state === 'failed' || state === 'cancelled') {
      params.push(now);
    }

    if (verificationState) {
      params.push(verificationState);
    }

    params.push(errorMessage, itemId);

    this.db.run(
      `UPDATE operation_items
       SET state = ?${startedAtSql}${completedAtSql}${verificationSql}, error_message = ?
       WHERE id = ?`,
      params,
    );
  }

  updateItemProgress(itemId: number, bytesDone: number, currentSpeedBytesPerSecond: number): void {
    this.db.run(
      `UPDATE operation_items
       SET bytes_done = ?, current_speed_bytes_per_second = ?
       WHERE id = ?`,
      [bytesDone, currentSpeedBytesPerSecond, itemId],
    );
  }

  updateItemVerification(itemId: number, verificationState: VerificationState): void {
    this.db.run(
      `UPDATE operation_items
       SET verification_state = ?
       WHERE id = ?`,
      [verificationState, itemId],
    );
  }

  resetFailedItems(operationId: number): void {
    this.db.run(
      `UPDATE operation_items
       SET state = 'pending',
           bytes_done = 0,
           current_speed_bytes_per_second = 0,
           verification_state = 'notStarted',
           error_message = NULL,
           started_at = NULL,
           completed_at = NULL
       WHERE operation_id = ? AND state IN ('failed', 'cancelled')`,
      [operationId],
    );
  }

  cancelWaitingItems(operationId: number): void {
    const now = new Date().toISOString();
    this.db.run(
      `UPDATE operation_items
       SET state = 'cancelled', completed_at = COALESCE(completed_at, ?)
       WHERE operation_id = ? AND state IN ('pending', 'paused')`,
      [now, operationId],
    );
  }

  markInterruptedRunningItemsFailed(): number {
    const now = new Date().toISOString();
    const result = this.db.run(
      `UPDATE operation_items
       SET state = 'failed',
           completed_at = COALESCE(completed_at, ?),
           error_message = 'Interrupted by app shutdown',
           verification_state = CASE
             WHEN verification_state = 'notStarted' THEN 'failed'
             ELSE verification_state
           END
       WHERE state = 'running'`,
      [now],
    );

    return result.changes;
  }

  markInterruptedRunningOperationsFailed(): number {
    const now = new Date().toISOString();
    const result = this.db.run(
      `UPDATE operations
       SET state = 'failed',
           completed_at = COALESCE(completed_at, ?),
           error_message = 'Interrupted by app shutdown'
       WHERE state = 'running'`,
      [now],
    );

    return result.changes;
  }

  listRecoverableTempPaths(): string[] {
    return this.db
      .all<{ temp_path: string }>(
        `SELECT temp_path
         FROM operation_items
         WHERE temp_path IS NOT NULL AND state IN ('pending', 'running', 'paused', 'failed', 'cancelled')`,
      )
      .map((row) => String(row.temp_path));
  }

  countItemsByState(state: QueueItemState): number {
    const row = this.db.get<{ count: number }>(
      `SELECT COUNT(*) AS count
       FROM operation_items
       WHERE state = ?`,
      [state],
    );

    return Number(row?.count ?? 0);
  }
}
