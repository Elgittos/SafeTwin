import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createConflictDuplicatePath, formatCopyTimestamp, getTempCopyPath } from '../src/main/operations/destinationPlanner';

describe('destinationPlanner', () => {
  it('creates SafeTwin conflict duplicate and temp paths', () => {
    const date = new Date(2026, 4, 6, 14, 32);
    const backupPath = path.join('D:\\Backup', 'Photos', 'photo.jpg');

    expect(formatCopyTimestamp(date)).toBe('2026-05-06 14-32');
    expect(createConflictDuplicatePath(backupPath, date)).toBe(
      path.join('D:\\Backup', 'Photos', 'photo (origin copy 2026-05-06 14-32).jpg'),
    );
    expect(getTempCopyPath(backupPath)).toBe(`${backupPath}.__safetwin_tmp__`);
  });
});
