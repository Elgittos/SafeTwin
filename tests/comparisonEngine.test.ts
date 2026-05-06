import { describe, expect, it } from 'vitest';
import { normalizeComparisonKey } from '../src/shared/pathKeys';
import { compareFiles } from '../src/main/scanner/comparisonEngine';
import type { ScannedFile } from '../src/main/scanner/fileWalker';

const file = (overrides: Partial<ScannedFile>): ScannedFile => ({
  side: 'origin',
  relativePath: 'file.txt',
  displayPath: 'file.txt',
  absolutePath: 'C:\\origin\\file.txt',
  normalizedKey: normalizeComparisonKey(overrides.relativePath ?? 'file.txt'),
  kind: 'file',
  size: 100,
  mtimeMs: 200,
  extension: '.txt',
  availabilityState: 'localReady',
  ignoreReason: null,
  hash: null,
  hashCalculatedAt: null,
  ...overrides,
});

describe('normalizeComparisonKey', () => {
  it('normalizes Windows separators and casing', () => {
    expect(normalizeComparisonKey('Photos\\Cat.JPG')).toBe('photos/cat.jpg');
  });
});

describe('compareFiles', () => {
  it('classifies missing, backup-only, identical, conflicts, ignored, and skipped files', () => {
    const result = compareFiles({
      originFiles: [
        file({ relativePath: 'same.txt', normalizedKey: 'same.txt', size: 10, mtimeMs: 1 }),
        file({ relativePath: 'missing.txt', normalizedKey: 'missing.txt', size: 20 }),
        file({ relativePath: 'conflict.txt', normalizedKey: 'conflict.txt', size: 30, mtimeMs: 1 }),
      ],
      backupFiles: [
        file({
          side: 'backup',
          relativePath: 'same.txt',
          absolutePath: 'D:\\backup\\same.txt',
          normalizedKey: 'same.txt',
          size: 10,
          mtimeMs: 1,
        }),
        file({
          side: 'backup',
          relativePath: 'backup-only.txt',
          absolutePath: 'D:\\backup\\backup-only.txt',
          normalizedKey: 'backup-only.txt',
          size: 40,
        }),
        file({
          side: 'backup',
          relativePath: 'conflict.txt',
          absolutePath: 'D:\\backup\\conflict.txt',
          normalizedKey: 'conflict.txt',
          size: 31,
          mtimeMs: 2,
        }),
      ],
      ignoredFiles: [
        file({
          relativePath: 'Documents/~$report.docx',
          normalizedKey: 'documents/~$report.docx',
          ignoreReason: 'Office lock file',
        }),
      ],
      skippedFiles: [
        file({
          relativePath: 'cloud/photo.jpg',
          normalizedKey: 'cloud/photo.jpg',
          availabilityState: 'cloudPlaceholder',
        }),
      ],
    });

    expect(result.summary).toMatchObject({
      missingInBackup: 1,
      backupOnly: 1,
      identical: 1,
      conflicts: 1,
      ignored: 1,
      notLocalPlaceholder: 1,
      totalMissingSize: 20,
      totalBackupOnlySize: 40,
    });
    expect(result.files.find((item) => item.relativePath === 'conflict.txt')?.state).toBe(
      'conflictSamePathDifferentContent',
    );
    expect(result.folders.find((folder) => folder.relativePath === 'Documents')?.counts.ignored).toBe(1);
    expect(result.folders.find((folder) => folder.relativePath === '')?.displayPath).toBe('Root');
  });
});
