import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

interface DatabaseSyncConstructor {
  new (databasePath: string): {
    exec: (sql: string) => void;
    prepare: (sql: string) => {
      run: (...params: DbValue[]) => { lastInsertRowid?: number | bigint; changes?: number | bigint };
      get: (...params: DbValue[]) => unknown;
      all: (...params: DbValue[]) => unknown[];
    };
    close: () => void;
  };
}

const loadDatabaseSync = (): DatabaseSyncConstructor => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires -- Keep node:sqlite external for Electron and Vitest.
  const sqlite = require('node:sqlite') as { DatabaseSync: DatabaseSyncConstructor };
  return sqlite.DatabaseSync;
};

export type DbValue = string | number | null;
export type DbRow = Record<string, DbValue>;

export interface SqliteDatabase {
  exec: (sql: string) => void;
  run: (sql: string, params?: DbValue[]) => { lastInsertRowid: number; changes: number };
  get: <T extends DbRow>(sql: string, params?: DbValue[]) => T | undefined;
  all: <T extends DbRow>(sql: string, params?: DbValue[]) => T[];
  close: () => void;
}

export const getDatabasePath = (): string => {
  const dataDir = path.join(app.getPath('userData'), 'safetwin-data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'logs'), { recursive: true });

  return path.join(dataDir, 'cache.sqlite');
};

export const openDatabase = (databasePath = getDatabasePath()): SqliteDatabase => {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });

  const DatabaseSync = loadDatabaseSync();
  const database = new DatabaseSync(databasePath);
  database.exec('PRAGMA journal_mode = WAL;');
  database.exec('PRAGMA foreign_keys = ON;');

  return {
    exec(sql) {
      database.exec(sql);
    },
    run(sql, params = []) {
      const result = database.prepare(sql).run(...params);
      return {
        lastInsertRowid: Number(result.lastInsertRowid ?? 0),
        changes: Number(result.changes ?? 0),
      };
    },
    get<T extends DbRow>(sql: string, params: DbValue[] = []) {
      return database.prepare(sql).get(...params) as T | undefined;
    },
    all<T extends DbRow>(sql: string, params: DbValue[] = []) {
      return database.prepare(sql).all(...params) as T[];
    },
    close() {
      database.close();
    },
  };
};
