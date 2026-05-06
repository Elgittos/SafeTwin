import type { DirectoryDiffSummary, FolderPair, ScanSummary } from '../../shared/types';
import type { IgnoreRuleService } from '../ignore/ignoreRules';
import { compareFiles, createEmptySummary, incrementSummary } from './comparisonEngine';
import { walkFiles } from './fileWalker';

const normalizeRelativePath = (relativePath: string): string =>
  relativePath.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');

const descendantFoldersFor = (filePath: string, currentPath: string): string[] => {
  const displayPath = normalizeRelativePath(filePath);
  const normalizedCurrent = normalizeRelativePath(currentPath);
  const remainder = normalizedCurrent
    ? displayPath.startsWith(`${normalizedCurrent}/`)
      ? displayPath.slice(normalizedCurrent.length + 1)
      : ''
    : displayPath;

  if (!remainder || !remainder.includes('/')) {
    return [];
  }

  const folderParts = remainder.split('/').slice(0, -1);

  return folderParts.map((_, index) => {
    const folderPath = folderParts.slice(0, index + 1).join('/');
    return normalizedCurrent ? `${normalizedCurrent}/${folderPath}` : folderPath;
  });
};

export const summarizeDirectoryDifferences = async (
  pair: FolderPair,
  relativePath: string,
  ignoreRules: IgnoreRuleService,
): Promise<DirectoryDiffSummary[]> => {
  const normalizedRelativePath = normalizeRelativePath(relativePath);
  const [originWalk, backupWalk] = await Promise.all([
    walkFiles(pair.originPath, 'origin', ignoreRules, {
      mode: 'metadata',
      startRelativePath: normalizedRelativePath,
    }),
    walkFiles(pair.backupPath, 'backup', ignoreRules, {
      mode: 'metadata',
      startRelativePath: normalizedRelativePath,
    }),
  ]);
  const comparison = compareFiles({
    originFiles: originWalk.files,
    backupFiles: backupWalk.files,
    ignoredFiles: [...originWalk.ignoredFiles, ...backupWalk.ignoredFiles],
    skippedFiles: [...originWalk.skippedFiles, ...backupWalk.skippedFiles],
  });
  const summaries = new Map<string, ScanSummary>();
  summaries.set(normalizedRelativePath, createEmptySummary());

  for (const file of comparison.files) {
    incrementSummary(summaries.get(normalizedRelativePath) ?? createEmptySummary(), file.state, file.sizeBytes);

    for (const folderPath of descendantFoldersFor(file.displayPath, normalizedRelativePath)) {
      const summary = summaries.get(folderPath) ?? createEmptySummary();
      incrementSummary(summary, file.state, file.sizeBytes);
      summaries.set(folderPath, summary);
    }
  }

  return [...summaries.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([folderPath, counts]) => ({
      relativePath: folderPath,
      displayPath: folderPath || 'Root',
      counts,
    }));
};
