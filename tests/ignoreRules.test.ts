import { describe, expect, it } from 'vitest';
import type { DbValue, SqliteDatabase } from '../src/main/db/sqlite';
import { IgnoreRuleService } from '../src/main/ignore/ignoreRules';

interface RuleRow {
  category: string;
  pattern: string;
  reason: string;
  enabled: number;
}

class FakeDb implements SqliteDatabase {
  private readonly rows: RuleRow[] = [];

  exec(): void {
    return undefined;
  }

  run(_sql: string, params: DbValue[] = []) {
    const [category, pattern, reason] = params;

    if (
      typeof category === 'string' &&
      typeof pattern === 'string' &&
      typeof reason === 'string' &&
      !this.rows.some((row) => row.pattern === pattern)
    ) {
      this.rows.push({ category, pattern, reason, enabled: 1 });
    }

    return { lastInsertRowid: this.rows.length, changes: 1 };
  }

  get() {
    return undefined;
  }

  all<T>() {
    return this.rows as T[];
  }

  close(): void {
    return undefined;
  }
}

describe('IgnoreRuleService', () => {
  it('loads default ignore rules and returns reasons', () => {
    const service = new IgnoreRuleService(new FakeDb());
    service.initialize();

    expect(service.match('Documents/~$report.docx')).toBe('Office lock file');
    expect(service.match('Downloads/movie.crdownload')).toBe('Partial download');
    expect(service.match('Photos/cat.jpg')).toBeNull();
  });
});
