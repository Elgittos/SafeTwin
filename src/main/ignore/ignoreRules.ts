import picomatch from 'picomatch';
import type { IgnoreRuleSetting } from '../../shared/types';
import type { SqliteDatabase } from '../db/sqlite';
import { defaultIgnoreRules, type DefaultIgnoreRule } from './defaultIgnoreRules';

interface IgnoreRule extends DefaultIgnoreRule {
  enabled: boolean;
  matcher: (path: string) => boolean;
}

const buildMatcher = (pattern: string): ((path: string) => boolean) =>
  picomatch(pattern, { basename: true, nocase: true });

export class IgnoreRuleService {
  private rules: IgnoreRule[] = [];

  constructor(private readonly db: SqliteDatabase) {}

  initialize(): void {
    for (const rule of defaultIgnoreRules) {
      this.db.run(
        `INSERT OR IGNORE INTO ignore_rules (category, pattern, reason, enabled)
         VALUES (?, ?, ?, 1)`,
        [rule.category, rule.pattern, rule.reason],
      );
    }

    this.rules = this.db
      .all<{
        category: string;
        pattern: string;
        reason: string;
        enabled: number;
      }>(
        `SELECT category, pattern, reason, enabled
         FROM ignore_rules
         WHERE enabled = 1
         ORDER BY id ASC`,
      )
      .map((rule) => ({
        category: String(rule.category),
        pattern: String(rule.pattern),
        reason: String(rule.reason),
        enabled: Boolean(rule.enabled),
        matcher: buildMatcher(String(rule.pattern)),
      }));
  }

  listRules(): IgnoreRuleSetting[] {
    return this.db
      .all<{
        id: number;
        category: string;
        pattern: string;
        reason: string;
        enabled: number;
      }>(
        `SELECT id, category, pattern, reason, enabled
         FROM ignore_rules
         ORDER BY id ASC`,
      )
      .map((rule) => ({
        id: Number(rule.id),
        category: String(rule.category),
        pattern: String(rule.pattern),
        reason: String(rule.reason),
        enabled: Boolean(rule.enabled),
      }));
  }

  setCategoryEnabled(category: string, enabled: boolean): IgnoreRuleSetting[] {
    this.db.run(
      `UPDATE ignore_rules
       SET enabled = ?
       WHERE category = ?`,
      [enabled ? 1 : 0, category],
    );
    this.initialize();

    return this.listRules();
  }

  match(relativePath: string): string | null {
    const normalized = relativePath.replaceAll('\\', '/');
    const basename = normalized.split('/').at(-1) ?? normalized;

    for (const rule of this.rules) {
      if (rule.matcher(normalized) || rule.matcher(basename)) {
        return rule.reason;
      }
    }

    return null;
  }
}
