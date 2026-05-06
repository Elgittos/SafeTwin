import fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import path from 'node:path';
import { getExtension, getRelativePath, normalizeComparisonKey, toDisplayPath } from '../../shared/pathKeys';
import type { DirectoryDiffSummary, FolderPair, FolderSide, ScanSummary } from '../../shared/types';
import type { IgnoreRuleService } from '../ignore/ignoreRules';
import { isProtectedWindowsDirectoryName } from '../platform/protectedWindowsPaths';
import { compareFiles, createEmptySummary, incrementSummary } from './comparisonEngine';
import type { ScannedFile } from './fileWalker';

interface WalkOutput {
  files: ScannedFile[];
  ignoredFiles: ScannedFile[];
  skippedFiles: ScannedFile[];
}

const yieldToEventLoop = async (): Promise<void> =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });

const normalizeRelativePath = (relativePath: string): string =>
  relativePath.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');

const makeFile = async (
  rootPath: string,
  absolutePath: string,
  side: FolderSide,
  ignoreReason: string | null,
): Promise<ScannedFile> => {
  const relativePath = getRelativePath(rootPath, absolutePath);
  const stats = await fs.stat(absolutePath);

  return {
    side,
    relativePath,
    displayPath: toDisplayPath(relativePath),
    absolutePath,
    normalizedKey: normalizeComparisonKey(relativePath),
    kind: 'file',
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    extension: getExtension(relativePath),
    availabilityState: 'localReady',
    ignoreReason,
    hash: null,
    hashCalculatedAt: null,
  };
};

const makeSkippedFile = async (
  rootPath: string,
  absolutePath: string,
  side: FolderSide,
  reason: ScannedFile['availabilityState'],
): Promise<ScannedFile> => {
  const relativePath = getRelativePath(rootPath, absolutePath);
  let size = 0;
  let mtimeMs = 0;

  try {
    const stats = await fs.stat(absolutePath);
    size = stats.size;
    mtimeMs = stats.mtimeMs;
  } catch {
    // Keep the skipped item visible even when metadata is unavailable.
  }

  return {
    side,
    relativePath,
    displayPath: toDisplayPath(relativePath),
    absolutePath,
    normalizedKey: normalizeComparisonKey(relativePath),
    kind: 'file',
    size,
    mtimeMs,
    extension: getExtension(relativePath),
    availabilityState: reason,
    ignoreReason: null,
    hash: null,
    hashCalculatedAt: null,
  };
};

const walkSide = async (
  rootPath: string,
  relativePath: string,
  side: FolderSide,
  ignoreRules: IgnoreRuleService,
): Promise<WalkOutput> => {
  const files: ScannedFile[] = [];
  const ignoredFiles: ScannedFile[] = [];
  const skippedFiles: ScannedFile[] = [];
  const startPath = path.resolve(rootPath, relativePath);
  const resolvedRoot = path.resolve(rootPath);
  const relativeFromRoot = path.relative(resolvedRoot, startPath);
  let visited = 0;

  if (relativeFromRoot.startsWith('..') || path.isAbsolute(relativeFromRoot)) {
    return { files, ignoredFiles, skippedFiles };
  }

  const visit = async (directoryPath: string): Promise<void> => {
    let entries: Dirent[];

    try {
      entries = await fs.readdir(directoryPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      visited += 1;

      if (visited % 200 === 0) {
        await yieldToEventLoop();
      }

      if (entry.name.startsWith('.')) {
        continue;
      }

      const absolutePath = path.join(directoryPath, entry.name);

      if (entry.isDirectory()) {
        if (!isProtectedWindowsDirectoryName(entry.name)) {
          await visit(absolutePath);
        }

        continue;
      }

      if (!entry.isFile()) {
        skippedFiles.push(await makeSkippedFile(rootPath, absolutePath, side, 'specialSkipped'));
        continue;
      }

      try {
        const itemRelativePath = getRelativePath(rootPath, absolutePath);
        const ignoreReason = ignoreRules.match(itemRelativePath);

        if (ignoreReason) {
          ignoredFiles.push(await makeFile(rootPath, absolutePath, side, ignoreReason));
        } else {
          files.push(await makeFile(rootPath, absolutePath, side, null));
        }
      } catch {
        skippedFiles.push(await makeSkippedFile(rootPath, absolutePath, side, 'unreadable'));
      }
    }
  };

  await visit(startPath);

  return { files, ignoredFiles, skippedFiles };
};

const immediateFolderFor = (filePath: string, currentPath: string): string | null => {
  const displayPath = normalizeRelativePath(filePath);
  const normalizedCurrent = normalizeRelativePath(currentPath);
  const remainder = normalizedCurrent
    ? displayPath.startsWith(`${normalizedCurrent}/`)
      ? displayPath.slice(normalizedCurrent.length + 1)
      : ''
    : displayPath;

  if (!remainder || !remainder.includes('/')) {
    return null;
  }

  const folderName = remainder.split('/')[0];
  return normalizedCurrent ? `${normalizedCurrent}/${folderName}` : folderName;
};

export const summarizeDirectoryDifferences = async (
  pair: FolderPair,
  relativePath: string,
  ignoreRules: IgnoreRuleService,
): Promise<DirectoryDiffSummary[]> => {
  const normalizedRelativePath = normalizeRelativePath(relativePath);
  const [originWalk, backupWalk] = await Promise.all([
    walkSide(pair.originPath, normalizedRelativePath, 'origin', ignoreRules),
    walkSide(pair.backupPath, normalizedRelativePath, 'backup', ignoreRules),
  ]);
  const comparison = compareFiles({
    originFiles: originWalk.files,
    backupFiles: backupWalk.files,
    ignoredFiles: [...originWalk.ignoredFiles, ...backupWalk.ignoredFiles],
    skippedFiles: [...originWalk.skippedFiles, ...backupWalk.skippedFiles],
  });
  const summaries = new Map<string, ScanSummary>();

  for (const file of comparison.files) {
    const folderPath = immediateFolderFor(file.displayPath, normalizedRelativePath);

    if (!folderPath) {
      continue;
    }

    const summary = summaries.get(folderPath) ?? createEmptySummary();
    incrementSummary(summary, file.state, file.sizeBytes);
    summaries.set(folderPath, summary);
  }

  return [...summaries.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([folderPath, counts]) => ({
      relativePath: folderPath,
      displayPath: folderPath || 'Root',
      counts,
    }));
};
