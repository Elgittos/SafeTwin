import type {
  DirectoryDiffSamples,
  DirectoryDiffSummary,
  FileCompareState,
  FolderPair,
  ScanSummary,
} from '../../shared/types';
import type { IgnoreRuleService } from '../ignore/ignoreRules';
import { compareFiles, createEmptySummary, incrementSummary } from './comparisonEngine';
import { walkFiles } from './fileWalker';

const normalizeRelativePath = (relativePath: string): string =>
  relativePath.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');

const sampleLimit = 3;

interface SummaryBucket {
  counts: ScanSummary;
  samples: DirectoryDiffSamples;
}

const createEmptySamples = (): DirectoryDiffSamples => ({
  missingInBackup: [],
  backupOnly: [],
  conflicts: [],
  ignored: [],
  skipped: [],
});

const createBucket = (): SummaryBucket => ({
  counts: createEmptySummary(),
  samples: createEmptySamples(),
});

const sampleKeyForState = (state: FileCompareState): keyof DirectoryDiffSamples | null => {
  if (state === 'missingInBackup') {
    return 'missingInBackup';
  }

  if (state === 'backupOnly') {
    return 'backupOnly';
  }

  if (state === 'conflictSamePathDifferentContent') {
    return 'conflicts';
  }

  if (state === 'ignored') {
    return 'ignored';
  }

  if (state === 'notLocalPlaceholder' || state === 'lockedOrUnreadable' || state === 'unstableChangingFile') {
    return 'skipped';
  }

  return null;
};

const addToBucket = (bucket: SummaryBucket, state: FileCompareState, sizeBytes: number, displayPath: string): void => {
  incrementSummary(bucket.counts, state, sizeBytes);

  const sampleKey = sampleKeyForState(state);
  if (sampleKey && bucket.samples[sampleKey].length < sampleLimit) {
    bucket.samples[sampleKey].push(displayPath);
  }
};

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
  const summaries = new Map<string, SummaryBucket>();
  summaries.set(normalizedRelativePath, createBucket());

  for (const file of comparison.files) {
    addToBucket(
      summaries.get(normalizedRelativePath) ?? createBucket(),
      file.state,
      file.sizeBytes,
      file.displayPath,
    );

    for (const folderPath of descendantFoldersFor(file.displayPath, normalizedRelativePath)) {
      const summary = summaries.get(folderPath) ?? createBucket();
      addToBucket(summary, file.state, file.sizeBytes, file.displayPath);
      summaries.set(folderPath, summary);
    }
  }

  return [...summaries.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([folderPath, bucket]) => ({
      relativePath: folderPath,
      displayPath: folderPath || 'Root',
      counts: bucket.counts,
      samples: bucket.samples,
    }));
};
