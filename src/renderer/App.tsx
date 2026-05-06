import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  Check,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Cloud,
  Code2,
  Copy,
  File,
  FileImage,
  FileText,
  FileVideo,
  Folder,
  FolderOpen,
  HardDrive,
  Loader2,
  LockKeyhole,
  Minus,
  Moon,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  Square,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import type {
  CleanupPreview,
  DirectoryDiffSamples,
  DirectoryPreviewEntry,
  DirectoryDiffSummary,
  FileCompareItem,
  FolderPair,
  IgnoreRuleSetting,
  OperationQueueItem,
  OperationSnapshot,
  SaveFolderPairInput,
  ScanMode,
  ScanProgressEvent,
  ScanResult,
  ScanSummary,
  VerificationLevel,
} from '../shared/types';

type PaneSide = 'origin' | 'backup';
type ThemeMode = 'light' | 'dark';
type FilterKey = 'all' | 'missing' | 'backupOnly' | 'conflicts' | 'ignored' | 'skipped' | 'failed';

const filterOptions: Array<[FilterKey, string]> = [
  ['missing', 'Ready to copy'],
  ['conflicts', 'Conflicts'],
  ['backupOnly', 'Backup-only'],
  ['ignored', 'Ignored'],
  ['skipped', 'Skipped'],
  ['failed', 'Failed'],
  ['all', 'All'],
];

interface CopyPreview {
  filesSelected: number;
  conflictsSelected: number;
  totalSize: number;
}

interface ParentRow {
  kind: 'parent';
  side: PaneSide;
  relativePath: string;
  name: string;
  displayPath: string;
}

interface FolderRow {
  kind: 'folder';
  side: PaneSide;
  relativePath: string;
  name: string;
  displayPath: string;
  counts: ScanSummary;
  countsKnown: boolean;
  samples: DirectoryDiffSamples | null;
  failedCount: number;
}

interface FileRow {
  kind: 'file';
  side: PaneSide;
  relativePath: string;
  name: string;
  displayPath: string;
  file: FileCompareItem;
  operationItem: OperationQueueItem | null;
}

interface PreviewFolderRow {
  kind: 'previewFolder';
  side: PaneSide;
  relativePath: string;
  name: string;
  displayPath: string;
}

interface PreviewFileRow {
  kind: 'previewFile';
  side: PaneSide;
  relativePath: string;
  name: string;
  displayPath: string;
  absolutePath: string;
  sizeBytes: number;
}

interface MissingPlaceholderRow {
  kind: 'missingPlaceholder';
  side: PaneSide;
  relativePath: string;
  name: string;
  displayPath: string;
  sizeBytes: number;
}

type PaneRow = ParentRow | FolderRow | FileRow | PreviewFolderRow | PreviewFileRow | MissingPlaceholderRow;

const emptySummary = (): ScanSummary => ({
  missingInBackup: 0,
  backupOnly: 0,
  identical: 0,
  conflicts: 0,
  ignored: 0,
  notLocalPlaceholder: 0,
  lockedOrUnreadable: 0,
  unstableChangingFile: 0,
  totalMissingSize: 0,
  totalBackupOnlySize: 0,
});

const formatBytes = (bytes: number): string => {
  if (bytes === 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
};

const formatDate = (value: string | null): string => {
  if (!value) {
    return 'Never';
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
};

const toFriendlyError = (error: unknown, fallback: string): string => {
  const rawMessage = error instanceof Error ? error.message : fallback;
  const message = rawMessage.toLowerCase();

  if (message.includes('ebusy') || message.includes('being used') || message.includes('locked')) {
    return `${fallback} This file is being used by another app. ${rawMessage}`;
  }

  if (message.includes('eacces') || message.includes('eperm') || message.includes('permission')) {
    return `${fallback} SafeTwin does not have permission to access this path. ${rawMessage}`;
  }

  if (message.includes('cloud') || message.includes('placeholder') || message.includes('not ready')) {
    return `${fallback} This file is cloud-only or not available locally. ${rawMessage}`;
  }

  if (message.includes('enospc') || message.includes('not enough') || message.includes('disk full')) {
    return `${fallback} The backup drive does not have enough free space. ${rawMessage}`;
  }

  if (message.includes('hash') || message.includes('verification') || message.includes('mismatch')) {
    return `${fallback} The copied file did not pass verification. ${rawMessage}`;
  }

  if (message.includes('enametoolong') || message.includes('path too long')) {
    return `${fallback} This file path is too long for the current operation. ${rawMessage}`;
  }

  if (message.includes('changed during') || message.includes('unstable')) {
    return `${fallback} This file changed during the operation and was skipped. ${rawMessage}`;
  }

  return rawMessage || fallback;
};

const normalizePath = (relativePath: string): string =>
  relativePath.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');

const parentPath = (relativePath: string): string => {
  const normalized = normalizePath(relativePath);
  const slashIndex = normalized.lastIndexOf('/');
  return slashIndex === -1 ? '' : normalized.slice(0, slashIndex);
};

const basename = (relativePath: string): string => {
  const normalized = normalizePath(relativePath);
  return normalized.split('/').filter(Boolean).at(-1) ?? 'Root';
};

const extension = (relativePath: string): string => {
  const name = basename(relativePath);
  const dotIndex = name.lastIndexOf('.');
  return dotIndex === -1 ? '' : name.slice(dotIndex + 1).toLowerCase();
};

const getDefaultPairName = (originPath: string, backupPath: string): string => {
  const origin = originPath.split(/[\\/]/).filter(Boolean).at(-1) ?? 'Origin';
  const backup = backupPath.split(/[\\/]/).filter(Boolean).at(-1) ?? 'Backup';
  return `${origin} to ${backup}`;
};

const getFileIcon = (relativePath: string) => {
  const ext = extension(relativePath);

  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic'].includes(ext)) {
    return <FileImage size={16} aria-hidden="true" />;
  }

  if (['mp4', 'mov', 'avi', 'mkv'].includes(ext)) {
    return <FileVideo size={16} aria-hidden="true" />;
  }

  if (['docx', 'odt', 'txt', 'pdf'].includes(ext)) {
    return <FileText size={16} aria-hidden="true" />;
  }

  if (['zip', 'rar', '7z'].includes(ext)) {
    return <Archive size={16} aria-hidden="true" />;
  }

  if (['js', 'ts', 'html', 'css', 'json'].includes(ext)) {
    return <Code2 size={16} aria-hidden="true" />;
  }

  return <File size={16} aria-hidden="true" />;
};

const fileVisibleOnSide = (file: FileCompareItem, side: PaneSide): boolean =>
  side === 'origin' ? file.originPath !== null : file.backupPath !== null;

const sidePath = (file: FileCompareItem, side: PaneSide): string | null =>
  side === 'origin' ? file.originPath : file.backupPath;

const skippedCount = (summary: ScanSummary): number =>
  summary.notLocalPlaceholder + summary.lockedOrUnreadable + summary.unstableChangingFile;

const samplesTitle = (label: string, count: number, samples?: string[] | null): string => {
  if (!samples?.length) {
    return label;
  }

  return `${label}: ${count}\nExamples:\n${samples.join('\n')}`;
};

const plural = (count: number, singular: string, pluralWord = `${singular}s`): string =>
  `${count} ${count === 1 ? singular : pluralWord}`;

const progressPercent = (done: number, total: number): number => (total > 0 ? Math.round((done / total) * 100) : 0);

const createLiveCompareItem = (
  side: PaneSide,
  entry: DirectoryPreviewEntry,
  oppositeEntry: DirectoryPreviewEntry | null,
): FileCompareItem => {
  const relativePath = normalizePath(entry.relativePath);
  const oppositeFile = oppositeEntry?.kind === 'file' ? oppositeEntry : null;

  if (!oppositeFile) {
    return {
      relativePath,
      displayPath: relativePath,
      state: side === 'origin' ? 'missingInBackup' : 'backupOnly',
      originPath: side === 'origin' ? entry.absolutePath : null,
      backupPath: side === 'backup' ? entry.absolutePath : null,
      sizeBytes: entry.sizeBytes,
      reason: side === 'origin' ? 'Visible in origin but not in backup' : 'Visible in backup but not in origin',
    };
  }

  const matches = entry.sizeBytes === oppositeFile.sizeBytes && entry.mtimeMs === oppositeFile.mtimeMs;

  return {
    relativePath,
    displayPath: relativePath,
    state: matches ? 'identical' : 'conflictSamePathDifferentContent',
    originPath: side === 'origin' ? entry.absolutePath : oppositeFile.absolutePath,
    backupPath: side === 'backup' ? entry.absolutePath : oppositeFile.absolutePath,
    sizeBytes: Math.max(entry.sizeBytes, oppositeFile.sizeBytes),
    reason: matches ? 'Visible files have same size and modified time' : 'Visible files differ by size or modified time',
  };
};

const stateLabel = (file: FileCompareItem): string => {
  if (file.state === 'missingInBackup') {
    return 'missing in backup ready to copy';
  }

  if (file.state === 'backupOnly') {
    return 'backup-only cleanup candidate';
  }

  if (file.state === 'conflictSamePathDifferentContent') {
    return 'same name different file conflict';
  }

  if (file.state === 'notLocalPlaceholder') {
    return 'cloud-only placeholder skipped';
  }

  if (file.state === 'lockedOrUnreadable') {
    return 'file is locked unreadable';
  }

  if (file.state === 'unstableChangingFile') {
    return 'changing skipped';
  }

  return file.state;
};

const buildOperationMap = (operation: OperationSnapshot | null): Map<string, OperationQueueItem> => {
  const map = new Map<string, OperationQueueItem>();

  for (const item of operation?.items ?? []) {
    map.set(normalizePath(item.relativePath).toLowerCase(), item);
  }

  return map;
};

const descendantCount = (paths: Set<string>, folderPath: string): number => {
  const normalizedFolder = normalizePath(folderPath).toLowerCase();
  let count = 0;

  for (const relativePath of paths) {
    if (relativePath === normalizedFolder || relativePath.startsWith(`${normalizedFolder}/`)) {
      count += 1;
    }
  }

  return count;
};

const isInsideSelectedFolderPath = (file: FileCompareItem, folderPaths: string[]): boolean => {
  const displayPath = normalizePath(file.displayPath).toLowerCase();

  return folderPaths.some((folderPath) => {
    const normalizedFolder = normalizePath(folderPath).toLowerCase();
    if (normalizedFolder === '') {
      return true;
    }

    return displayPath === normalizedFolder || displayPath.startsWith(`${normalizedFolder}/`);
  });
};

const matchesFilter = (row: PaneRow, filter: FilterKey, failedPaths: Set<string>): boolean => {
  if (row.kind === 'parent' || filter === 'all') {
    return true;
  }

  if (row.kind === 'missingPlaceholder') {
    return filter === 'missing';
  }

  if (row.kind === 'previewFolder') {
    return filter === 'missing';
  }

  if (row.kind === 'previewFile') {
    return false;
  }

  if (row.kind === 'folder') {
    if (filter === 'missing') {
      return row.counts.missingInBackup > 0;
    }

    if (filter === 'backupOnly') {
      return row.counts.backupOnly > 0;
    }

    if (filter === 'conflicts') {
      return row.counts.conflicts > 0;
    }

    if (filter === 'ignored') {
      return row.counts.ignored > 0;
    }

    if (filter === 'skipped') {
      return skippedCount(row.counts) > 0;
    }

    return row.failedCount > 0;
  }

  if (filter === 'missing') {
    return row.file.state === 'missingInBackup';
  }

  if (filter === 'backupOnly') {
    return row.file.state === 'backupOnly';
  }

  if (filter === 'conflicts') {
    return row.file.state === 'conflictSamePathDifferentContent';
  }

  if (filter === 'ignored') {
    return row.file.state === 'ignored';
  }

  if (filter === 'skipped') {
    return ['notLocalPlaceholder', 'lockedOrUnreadable', 'unstableChangingFile'].includes(row.file.state);
  }

  return failedPaths.has(normalizePath(row.file.relativePath).toLowerCase());
};

const matchesSearch = (row: PaneRow, query: string): boolean => {
  const trimmed = query.trim().toLowerCase();

  if (!trimmed || row.kind === 'parent') {
    return true;
  }

  const corpus =
    row.kind === 'file'
      ? `${row.name} ${row.displayPath} ${extension(row.relativePath)} ${stateLabel(row.file)} ${row.file.reason}`
      : row.kind === 'previewFile'
        ? `${row.name} ${row.displayPath} ${extension(row.relativePath)} file`
        : row.kind === 'missingPlaceholder'
          ? `${row.name} ${row.displayPath} missing in backup`
          : `${row.name} ${row.displayPath} missing backup-only conflict ignored skipped folder`;

  return corpus.toLowerCase().includes(trimmed);
};

const rowSortWeight = (row: PaneRow): number => {
  if (row.kind === 'parent') {
    return 0;
  }

  if (row.kind === 'folder' || row.kind === 'previewFolder') {
    return 1;
  }

  return 2;
};

const buildPaneRows = (
  side: PaneSide,
  currentPath: string,
  scanResult: ScanResult | null,
  previewEntries: DirectoryPreviewEntry[],
  oppositePreviewEntries: DirectoryPreviewEntry[],
  quickFolderSummaries: DirectoryDiffSummary[],
  operationByPath: Map<string, OperationQueueItem>,
  failedPaths: Set<string>,
  filter: FilterKey,
  search: string,
): PaneRow[] => {
  const normalizedCurrent = normalizePath(currentPath);
  const rows: PaneRow[] = [];

  if (normalizedCurrent) {
    rows.push({
      kind: 'parent',
      side,
      relativePath: parentPath(normalizedCurrent),
      name: '..',
      displayPath: parentPath(normalizedCurrent) || 'Root',
    });
  }

  const folderCounts = new Map(
    (scanResult?.folders ?? []).map((folder) => [normalizePath(folder.relativePath).toLowerCase(), folder.counts]),
  );
  const quickFolderDetails = new Map(
    quickFolderSummaries.map((folder) => [normalizePath(folder.relativePath).toLowerCase(), folder]),
  );
  const scanFilesByPath = new Map(
    (scanResult?.files ?? [])
      .filter((file) => fileVisibleOnSide(file, side))
      .map((file) => [normalizePath(file.displayPath).toLowerCase(), file]),
  );
  const oppositePreviewByPath = new Map(
    oppositePreviewEntries.map((entry) => [normalizePath(entry.relativePath).toLowerCase(), entry]),
  );
  const previewByPath = new Map(previewEntries.map((entry) => [normalizePath(entry.relativePath).toLowerCase(), entry]));

  const liveRows: PaneRow[] = previewEntries.map((entry) => {
    const relativePath = normalizePath(entry.relativePath);

    if (entry.kind === 'folder') {
      const normalizedKey = relativePath.toLowerCase();
      const quickDetails = quickFolderDetails.get(normalizedKey);
      const quickCounts = quickDetails?.counts;
      const cachedCounts = folderCounts.get(normalizedKey);

      return {
        kind: 'folder',
        side,
        relativePath,
        name: entry.name,
        displayPath: relativePath,
        counts: quickCounts ?? cachedCounts ?? emptySummary(),
        countsKnown: Boolean(quickCounts ?? cachedCounts),
        samples: quickDetails?.samples ?? null,
        failedCount: descendantCount(failedPaths, relativePath),
      };
    }

    const liveFile = createLiveCompareItem(side, entry, oppositePreviewByPath.get(relativePath.toLowerCase()) ?? null);
    const scannedFile = scanFilesByPath.get(relativePath.toLowerCase());

    if (
      scannedFile &&
      ['ignored', 'notLocalPlaceholder', 'lockedOrUnreadable', 'unstableChangingFile'].includes(scannedFile.state)
    ) {
      return {
        kind: 'file',
        side,
        relativePath: scannedFile.relativePath,
        name: entry.name,
        displayPath: scannedFile.displayPath,
        file: scannedFile,
        operationItem: operationByPath.get(normalizePath(scannedFile.relativePath).toLowerCase()) ?? null,
      };
    }

    return {
      kind: 'file',
      side,
      relativePath: liveFile.relativePath,
      name: entry.name,
      displayPath: liveFile.displayPath,
      file: liveFile,
      operationItem: operationByPath.get(normalizePath(liveFile.relativePath).toLowerCase()) ?? null,
    };
  });

  if (side === 'backup') {
    for (const entry of oppositePreviewEntries) {
      const relativePath = normalizePath(entry.relativePath);

      if (entry.kind !== 'file' || previewByPath.has(relativePath.toLowerCase())) {
        continue;
      }

      liveRows.push({
        kind: 'missingPlaceholder',
        side,
        relativePath,
        name: entry.name,
        displayPath: relativePath,
        sizeBytes: entry.sizeBytes,
      });
    }
  }

  liveRows.sort((left, right) => {
    const weightDifference = rowSortWeight(left) - rowSortWeight(right);

    if (weightDifference !== 0) {
      return weightDifference;
    }

    return left.displayPath.localeCompare(right.displayPath);
  });

  return [...rows, ...liveRows].filter(
    (row) => matchesFilter(row, filter, failedPaths) && matchesSearch(row, search),
  );
};

const canCopy = (file: FileCompareItem): boolean =>
  file.state === 'missingInBackup' || file.state === 'conflictSamePathDifferentContent';

const canCleanup = (file: FileCompareItem): boolean => file.state === 'backupOnly';

const indicatorFor = (row: PaneRow, side: PaneSide) => {
  if (row.kind === 'parent' || row.kind === 'previewFolder' || row.kind === 'previewFile') {
    return null;
  }

  if (row.kind === 'missingPlaceholder') {
    return (
      <span className="indicator indicator-plus" title="Missing in backup">
        <Plus size={15} aria-hidden="true" />
      </span>
    );
  }

  if (row.kind === 'folder') {
    if (!row.countsKnown) {
      return null;
    }

    return (
      <div className="badges">
        {row.counts.missingInBackup > 0 && side === 'origin' ? (
          <span
            className="badge badge-plus"
            title={samplesTitle(
              `Origin-only files inside this folder`,
              row.counts.missingInBackup,
              row.samples?.missingInBackup,
            )}
          >
            <Plus size={12} aria-hidden="true" />
            {plural(row.counts.missingInBackup, 'file')}
          </span>
        ) : null}
        {row.counts.backupOnly > 0 && side === 'backup' ? (
          <span
            className="badge badge-minus"
            title={samplesTitle('Backup-only cleanup candidate', row.counts.backupOnly, row.samples?.backupOnly)}
          >
            -{row.counts.backupOnly}
          </span>
        ) : null}
        {row.counts.conflicts > 0 ? (
          <span
            className="badge badge-warn"
            title={samplesTitle('Same name, different file', row.counts.conflicts, row.samples?.conflicts)}
          >
            !{row.counts.conflicts}
          </span>
        ) : null}
        {skippedCount(row.counts) > 0 ? (
          <span
            className="badge badge-muted"
            title={samplesTitle(
              'Cloud-only placeholder skipped or file is locked',
              skippedCount(row.counts),
              row.samples?.skipped,
            )}
          >
            {skippedCount(row.counts)}
          </span>
        ) : null}
        {row.failedCount > 0 ? (
          <span className="badge badge-failed" title="Failed operations">
            {row.failedCount}
          </span>
        ) : null}
        {row.counts.missingInBackup +
          row.counts.backupOnly +
          row.counts.conflicts +
          skippedCount(row.counts) +
          row.failedCount ===
        0 ? (
          <span className="badge badge-plus" title="Present on both sides">
            <Check size={12} aria-hidden="true" />
          </span>
        ) : null}
      </div>
    );
  }

  if (row.operationItem?.state === 'running') {
    return (
      <span className="indicator indicator-running" title="Copying...">
        <Loader2 className="spin" size={15} aria-hidden="true" />
      </span>
    );
  }

  if (row.operationItem?.state === 'failed') {
    return (
      <span className="indicator indicator-failed" title={row.operationItem.errorMessage ?? 'Failed operation'}>
        <X size={15} aria-hidden="true" />
      </span>
    );
  }

  if (row.file.state === 'missingInBackup') {
    return (
      <span className="indicator indicator-plus" title="Ready to copy">
        <Plus size={15} aria-hidden="true" />
      </span>
    );
  }

  if (row.file.state === 'identical') {
    return (
      <span className="indicator indicator-plus" title="Present on both sides">
        <Check size={15} aria-hidden="true" />
      </span>
    );
  }

  if (row.file.state === 'backupOnly') {
    return (
      <span className="indicator indicator-minus" title="Backup-only cleanup candidate">
        <Minus size={15} aria-hidden="true" />
      </span>
    );
  }

  if (row.file.state === 'conflictSamePathDifferentContent') {
    return (
      <span className="indicator indicator-warn" title="Same name, different file">
        <AlertTriangle size={15} aria-hidden="true" />
      </span>
    );
  }

  if (row.file.state === 'notLocalPlaceholder') {
    return (
      <span className="indicator indicator-muted" title="Cloud-only placeholder skipped">
        <Cloud size={15} aria-hidden="true" />
      </span>
    );
  }

  if (row.file.state === 'lockedOrUnreadable') {
    return (
      <span className="indicator indicator-muted" title="File is locked">
        <LockKeyhole size={15} aria-hidden="true" />
      </span>
    );
  }

  return (
    <span className="indicator indicator-muted" title={row.file.reason}>
      <AlertTriangle size={15} aria-hidden="true" />
    </span>
  );
};

const App = () => {
  const [pairs, setPairs] = useState<FolderPair[]>([]);
  const [activePairId, setActivePairId] = useState<number | null>(null);
  const [originPath, setOriginPath] = useState('');
  const [backupPath, setBackupPath] = useState('');
  const [pairName, setPairName] = useState('');
  const [leftPath, setLeftPath] = useState('');
  const [rightPath, setRightPath] = useState('');
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [originPreviewEntries, setOriginPreviewEntries] = useState<DirectoryPreviewEntry[]>([]);
  const [backupPreviewEntries, setBackupPreviewEntries] = useState<DirectoryPreviewEntry[]>([]);
  const [quickFolderSummaries, setQuickFolderSummaries] = useState<DirectoryDiffSummary[]>([]);
  const [isLoadingMarkers, setIsLoadingMarkers] = useState(false);
  const [operation, setOperation] = useState<OperationSnapshot | null>(null);
  const [operationHistory, setOperationHistory] = useState<OperationSnapshot[]>([]);
  const [scanProgress, setScanProgress] = useState<ScanProgressEvent | null>(null);
  const [copyPreview, setCopyPreview] = useState<CopyPreview | null>(null);
  const [cleanupPreview, setCleanupPreview] = useState<CleanupPreview | null>(null);
  const [ignoreRules, setIgnoreRules] = useState<IgnoreRuleSetting[]>([]);
  const [ignoredFiles, setIgnoredFiles] = useState<{ path: string; reason: string }[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [selectedFolderPaths, setSelectedFolderPaths] = useState<string[]>([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const [cleanupMode, setCleanupMode] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [ignoredOpen, setIgnoredOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const savedTheme = window.localStorage.getItem('safetwin-theme');
    return savedTheme === 'dark' ? 'dark' : 'light';
  });
  const [filter, setFilter] = useState<FilterKey>('all');
  const [search, setSearch] = useState('');
  const [verificationLevel, setVerificationLevel] = useState<VerificationLevel>('auto');
  const [isScanning, setIsScanning] = useState(false);
  const [isPreparingOperation, setIsPreparingOperation] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activePair = useMemo(
    () => pairs.find((pair) => pair.id === activePairId) ?? null,
    [activePairId, pairs],
  );
  const operationByPath = useMemo(() => buildOperationMap(operation), [operation]);
  const failedPaths = useMemo(
    () =>
      new Set(
        (operation?.items ?? [])
          .filter((item) => item.state === 'failed')
          .map((item) => normalizePath(item.relativePath).toLowerCase()),
      ),
    [operation],
  );
  const leftRows = useMemo(
    () =>
      buildPaneRows(
        'origin',
        leftPath,
        scanResult,
        originPreviewEntries,
        backupPreviewEntries,
        quickFolderSummaries,
        operationByPath,
        failedPaths,
        filter,
        search,
      ),
    [
      backupPreviewEntries,
      failedPaths,
      filter,
      leftPath,
      operationByPath,
      originPreviewEntries,
      quickFolderSummaries,
      scanResult,
      search,
    ],
  );
  const rightRows = useMemo(
    () =>
      buildPaneRows(
        'backup',
        rightPath,
        scanResult,
        backupPreviewEntries,
        originPreviewEntries,
        quickFolderSummaries,
        operationByPath,
        failedPaths,
        filter,
        search,
      ),
    [
      backupPreviewEntries,
      failedPaths,
      filter,
      operationByPath,
      originPreviewEntries,
      quickFolderSummaries,
      rightPath,
      scanResult,
      search,
    ],
  );
  const selectedFiles = useMemo(() => {
    const selected = new Set(selectedPaths);
    const filesByPath = new Map<string, FileCompareItem>();

    for (const file of scanResult?.files ?? []) {
      filesByPath.set(normalizePath(file.relativePath).toLowerCase(), file);
    }

    for (const row of [...leftRows, ...rightRows]) {
      if (row.kind === 'file') {
        filesByPath.set(normalizePath(row.file.relativePath).toLowerCase(), row.file);
      }
    }

    return [...filesByPath.values()].filter(
      (file) => selected.has(file.relativePath) || isInsideSelectedFolderPath(file, selectedFolderPaths),
    );
  }, [leftRows, rightRows, scanResult, selectedFolderPaths, selectedPaths]);
  const copySelectedFiles = useMemo(() => selectedFiles.filter(canCopy), [selectedFiles]);
  const cleanupSelectedFiles = useMemo(() => selectedFiles.filter(canCleanup), [selectedFiles]);
  const conflictSelectedFiles = useMemo(
    () => selectedFiles.filter((file) => file.state === 'conflictSamePathDifferentContent'),
    [selectedFiles],
  );
  const selectedBytes = useMemo(
    () => selectedFiles.reduce((total, file) => total + file.sizeBytes, 0),
    [selectedFiles],
  );
  const lastCopyAt = useMemo(
    () =>
      operationHistory.find((snapshot) => snapshot.operation.type === 'copy' && snapshot.operation.completedAt)
        ?.operation.completedAt ?? null,
    [operationHistory],
  );
  const lastCleanupAt = useMemo(
    () =>
      operationHistory.find((snapshot) => snapshot.operation.type === 'cleanup' && snapshot.operation.completedAt)
        ?.operation.completedAt ?? null,
    [operationHistory],
  );
  const reminderMessage = useMemo(() => {
    if (!activePair?.reminderIntervalDays) {
      return null;
    }

    if (!activePair.lastScanAt) {
      return `SafeTwin reminder: this backup pair has not been scanned yet.`;
    }

    const elapsedDays = Math.floor((Date.now() - new Date(activePair.lastScanAt).getTime()) / 86_400_000);

    if (elapsedDays >= activePair.reminderIntervalDays) {
      return `SafeTwin reminder: your backup pair has not been scanned for ${elapsedDays} days.`;
    }

    return null;
  }, [activePair]);
  const liveStatusSummary = useMemo(() => {
    const currentKey = normalizePath(leftPath).toLowerCase();
    return (
      quickFolderSummaries.find((folder) => normalizePath(folder.relativePath).toLowerCase() === currentKey)
        ?.counts ?? null
    );
  }, [leftPath, quickFolderSummaries]);
  const statusSummary = liveStatusSummary ?? scanResult?.summary ?? emptySummary();

  const savePairWithPaths = async (
    nextOriginPath: string,
    nextBackupPath: string,
    nextPairName: string,
  ): Promise<FolderPair> => {
    if (!nextOriginPath || !nextBackupPath) {
      throw new Error('Choose both an origin folder and a backup folder.');
    }

    const input: SaveFolderPairInput = {
      id: activePairId ?? undefined,
      name: nextPairName || getDefaultPairName(nextOriginPath, nextBackupPath),
      originPath: nextOriginPath,
      backupPath: nextBackupPath,
      mirrorNavigationEnabled: activePair?.mirrorNavigationEnabled ?? true,
      reminderIntervalDays: activePair?.reminderIntervalDays ?? null,
    };
    const savedPair = await window.safetwin.saveFolderPair(input);
    const nextPairs = await window.safetwin.listFolderPairs();
    setPairs(nextPairs);
    setActivePairId(savedPair.id);
    setOriginPath(savedPair.originPath);
    setBackupPath(savedPair.backupPath);
    setPairName(savedPair.name);

    return savedPair;
  };

  const scanSavedPair = async (pair: FolderPair, mode: ScanMode = 'metadata') => {
    setIsScanning(true);
    setError(null);
    setScanProgress({
      folderPairId: pair.id,
      scanRunId: null,
      mode,
      phase: 'starting',
      side: 'both',
      currentPath: '',
      filesDiscovered: 0,
      foldersDiscovered: 0,
      ignored: 0,
      skipped: 0,
      message: 'Starting scan',
    });

    try {
      const result = await window.safetwin.scanPair(pair.id, mode);
      setScanResult(result);
      setSelectedPaths([]);
      setSelectedFolderPaths([]);
      setCleanupPreview(null);
      const nextPairs = await window.safetwin.listFolderPairs();
      setPairs(nextPairs);
      setActivePairId(pair.id);
      setIgnoredFiles(await window.safetwin.getIgnoredFiles(pair.id));
    } catch (scanError) {
      setError(toFriendlyError(scanError, 'Scan failed.'));
    } finally {
      setIsScanning(false);
      window.setTimeout(() => setScanProgress(null), 1400);
    }
  };

  const loadPairState = async (pair: FolderPair) => {
    setActivePairId(pair.id);
    setOriginPath(pair.originPath);
    setBackupPath(pair.backupPath);
    setPairName(pair.name);
    setLeftPath('');
    setRightPath('');
    setSelectedPaths([]);
    setSelectedFolderPaths([]);
    setCopyPreview(null);
    setCleanupPreview(null);
    setError(null);

    const status = await window.safetwin.getLastStatus(pair.id);
    setScanResult(status.lastScan);
    const operations = await window.safetwin.listOperations(pair.id);
    setOperationHistory(operations);
    setOperation(operations[0] ?? null);
    setIgnoredFiles(await window.safetwin.getIgnoredFiles(pair.id));

  };

  const loadPairs = async () => {
    const nextPairs = await window.safetwin.listFolderPairs();
    setPairs(nextPairs);

    if (!activePairId && nextPairs.length > 0) {
      await loadPairState(nextPairs[0]);
    }
  };

  useEffect(() => {
    Promise.all([loadPairs(), window.safetwin.listIgnoreRules().then(setIgnoreRules)]).catch((loadError: unknown) => {
      setError(toFriendlyError(loadError, 'Could not load SafeTwin data.'));
    });
  }, []);

  useEffect(() => {
    return window.safetwin.onScanProgress((progress) => {
      setScanProgress(progress);
    });
  }, []);

  useEffect(() => {
    window.localStorage.setItem('safetwin-theme', theme);
  }, [theme]);

  useEffect(() => {
    let canceled = false;

    if (!originPath) {
      setOriginPreviewEntries([]);
      return undefined;
    }

    window.safetwin
      .listDirectory(originPath, leftPath)
      .then((entries) => {
        if (!canceled) {
          setOriginPreviewEntries(entries);
        }
      })
      .catch((previewError: unknown) => {
        if (!canceled) {
          setOriginPreviewEntries([]);
          setError(toFriendlyError(previewError, 'Could not read origin folder.'));
        }
      });

    return () => {
      canceled = true;
    };
  }, [leftPath, originPath]);

  useEffect(() => {
    let canceled = false;

    if (!backupPath) {
      setBackupPreviewEntries([]);
      return undefined;
    }

    window.safetwin
      .listDirectory(backupPath, rightPath)
      .then((entries) => {
        if (!canceled) {
          setBackupPreviewEntries(entries);
        }
      })
      .catch((previewError: unknown) => {
        if (!canceled) {
          setBackupPreviewEntries([]);
          setError(toFriendlyError(previewError, 'Could not read backup folder.'));
        }
      });

    return () => {
      canceled = true;
    };
  }, [backupPath, rightPath]);

  useEffect(() => {
    let canceled = false;

    if (!activePairId || !originPath || !backupPath) {
      setQuickFolderSummaries([]);
      setIsLoadingMarkers(false);
      return undefined;
    }

    const pathsToSummarize = [...new Set([leftPath, rightPath].map(normalizePath))];
    setIsLoadingMarkers(true);

    Promise.all(
      pathsToSummarize.map((relativePath) =>
        window.safetwin.summarizeDirectoryDifferences(activePairId, relativePath),
      ),
    )
      .then((results) => {
        if (!canceled) {
          setQuickFolderSummaries(results.flat());
        }
      })
      .catch((markerError: unknown) => {
        if (!canceled) {
          setQuickFolderSummaries([]);
          setError(toFriendlyError(markerError, 'Could not load difference markers.'));
        }
      })
      .finally(() => {
        if (!canceled) {
          setIsLoadingMarkers(false);
        }
      });

    return () => {
      canceled = true;
    };
  }, [activePairId, backupPath, leftPath, originPath, rightPath]);

  useEffect(() => {
    if (!operation || !['pending', 'running', 'paused'].includes(operation.operation.state)) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      window.safetwin
        .getOperation(operation.operation.id)
        .then(async (nextOperation) => {
          setOperation(nextOperation);

          if (nextOperation.operation.state === 'completed' && activePairId) {
            const status = await window.safetwin.getLastStatus(activePairId);
            setScanResult(status.lastScan);
            setSelectedPaths([]);
            setSelectedFolderPaths([]);
            setCopyPreview(null);
            setCleanupPreview(null);
            setOperationHistory(await window.safetwin.listOperations(activePairId));
          }
        })
        .catch((pollError: unknown) => {
          setError(toFriendlyError(pollError, 'Could not refresh operation.'));
        });
    }, 700);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [activePairId, operation]);

  const chooseFolder = async (side: PaneSide) => {
    const result = await window.safetwin.chooseFolder();

    if (result.canceled || !result.path) {
      return;
    }

    const nextOriginPath = side === 'origin' ? result.path : originPath;
    const nextBackupPath = side === 'backup' ? result.path : backupPath;
    const nextPairName =
      pairName || (nextOriginPath && nextBackupPath ? getDefaultPairName(nextOriginPath, nextBackupPath) : '');

    setOriginPath(nextOriginPath);
    setBackupPath(nextBackupPath);
    setPairName(nextPairName);
    setLeftPath('');
    setRightPath('');
    setSelectedPaths([]);
    setSelectedFolderPaths([]);
    setCleanupPreview(null);
    setScanResult(null);
    setError(null);

    if (nextOriginPath && nextBackupPath) {
      try {
        await savePairWithPaths(nextOriginPath, nextBackupPath, nextPairName);
      } catch (folderError) {
        setError(toFriendlyError(folderError, 'Could not save selected folders.'));
      }
    }
  };

  const swapRoles = async () => {
    if (!originPath || !backupPath) {
      setError('Choose both an origin folder and a backup folder before swapping roles.');
      return;
    }

    const nextOriginPath = backupPath;
    const nextBackupPath = originPath;
    const nextPairName = getDefaultPairName(nextOriginPath, nextBackupPath);
    setOriginPath(nextOriginPath);
    setBackupPath(nextBackupPath);
    setPairName(nextPairName);
    setLeftPath('');
    setRightPath('');
    setSelectedPaths([]);
    setSelectedFolderPaths([]);
    setCopyPreview(null);
    setCleanupPreview(null);
    setScanResult(null);
    setError(null);

    try {
      await savePairWithPaths(nextOriginPath, nextBackupPath, nextPairName);
    } catch (swapError) {
      setError(toFriendlyError(swapError, 'Could not swap origin and backup.'));
    }
  };

  const savePair = async (): Promise<FolderPair> => {
    return savePairWithPaths(originPath, backupPath, pairName);
  };

  const scan = async (mode: ScanMode = 'metadata') => {
    try {
      const savedPair = await savePair();
      await scanSavedPair(savedPair, mode);
    } catch (scanError) {
      setError(toFriendlyError(scanError, 'Scan failed.'));
    }
  };

  const navigatePane = (side: PaneSide, nextPath: string) => {
    const normalized = normalizePath(nextPath);

    if (side === 'origin') {
      setLeftPath(normalized);
      if (activePair?.mirrorNavigationEnabled) {
        setRightPath(normalized);
      }
    } else {
      setRightPath(normalized);
      if (activePair?.mirrorNavigationEnabled) {
        setLeftPath(normalized);
      }
    }
  };

  const openDeleteExtras = () => {
    setCleanupMode(true);
    setSelectionMode(true);
    setFilter('backupOnly');
    setSelectedPaths([]);
    setSelectedFolderPaths([]);
    setCopyPreview(null);
    setCleanupPreview(null);
  };

  const updatePairSettings = async (patch: { mirrorNavigationEnabled?: boolean; reminderIntervalDays?: number | null }) => {
    if (!activePairId) {
      return;
    }

    try {
      const updatedPair = await window.safetwin.updateFolderPairSettings({ id: activePairId, ...patch });
      setPairs((current) => current.map((pair) => (pair.id === updatedPair.id ? updatedPair : pair)));
    } catch (settingsError) {
      setError(toFriendlyError(settingsError, 'Could not update folder-pair settings.'));
    }
  };

  const toggleSelectedPath = (file: FileCompareItem) => {
    const isEligible = cleanupMode ? canCleanup(file) : canCopy(file);

    if (!isEligible) {
      return;
    }

    setSelectedPaths((current) =>
      current.includes(file.relativePath)
        ? current.filter((relativePath) => relativePath !== file.relativePath)
        : [...current, file.relativePath],
    );
  };

  const toggleSelectedFolderPath = (relativePath: string) => {
    setSelectedFolderPaths((current) =>
      current.includes(relativePath)
        ? current.filter((selectedPath) => selectedPath !== relativePath)
        : [...current, relativePath],
    );
  };

  const rowIsSelectable = (row: PaneRow): boolean => {
    if (row.kind === 'file') {
      return cleanupMode ? canCleanup(row.file) : canCopy(row.file);
    }

    if (row.kind !== 'folder') {
      return false;
    }

    if (cleanupMode) {
      return row.side === 'backup' && row.counts.backupOnly > 0;
    }

    return row.side === 'origin' && (row.counts.missingInBackup > 0 || row.counts.conflicts > 0);
  };

  const selectVisibleEligible = () => {
    const paths = new Set(selectedPaths);
    const folderPaths = new Set(selectedFolderPaths);

    for (const row of [...leftRows, ...rightRows]) {
      if (row.kind === 'file' && rowIsSelectable(row)) {
        paths.add(row.file.relativePath);
      }

      if (row.kind === 'folder' && rowIsSelectable(row)) {
        folderPaths.add(row.relativePath);
      }
    }

    setSelectionMode(true);
    setSelectedPaths([...paths]);
    setSelectedFolderPaths([...folderPaths]);
    setCleanupPreview(null);
    setCopyPreview(null);
  };

  const clearSelection = () => {
    setSelectedPaths([]);
    setSelectedFolderPaths([]);
    setCleanupPreview(null);
    setCopyPreview(null);
  };

  const ensureScanIncludesSelection = async (paths: string[], folderPaths: string[] = []): Promise<void> => {
    if (!activePairId || !originPath || !backupPath) {
      return;
    }

    const scannedPaths = new Set((scanResult?.files ?? []).map((file) => normalizePath(file.relativePath).toLowerCase()));
    const needsFreshScan =
      folderPaths.length > 0 || paths.some((relativePath) => !scannedPaths.has(normalizePath(relativePath).toLowerCase()));

    if (!needsFreshScan) {
      return;
    }

    const savedPair = await savePair();
    await scanSavedPair(savedPair);
  };

  const createCopyQueue = async (paths: string[], folderPaths: string[] = []) => {
    if (!activePairId || (paths.length === 0 && folderPaths.length === 0)) {
      return;
    }

    setIsPreparingOperation(true);
    setError(null);

    try {
      await ensureScanIncludesSelection(paths, folderPaths);
      const nextOperation = await window.safetwin.createCopyOperation({
        folderPairId: activePairId,
        selectedRelativePaths: paths,
        selectedFolderPaths: folderPaths,
        verificationLevel,
      });
      const startedOperation = await window.safetwin.startOperation(nextOperation.operation.id);
      setOperation(startedOperation);
      setOperationHistory((current) => [
        startedOperation,
        ...current.filter((item) => item.operation.id !== startedOperation.operation.id),
      ]);
      setCopyPreview({
        filesSelected: nextOperation.totals.totalItems,
        conflictsSelected: nextOperation.items.filter((item) => item.action === 'copyConflictDuplicate').length,
        totalSize: nextOperation.totals.bytesTotal,
      });
      setCleanupMode(false);
      setCleanupPreview(null);
    } catch (operationError) {
      setError(toFriendlyError(operationError, 'Could not create copy queue.'));
    } finally {
      setIsPreparingOperation(false);
    }
  };

  const previewCleanup = async () => {
    if (!activePairId) {
      return;
    }

    setIsPreparingOperation(true);
    setError(null);

    try {
      await ensureScanIncludesSelection(
        cleanupSelectedFiles.map((file) => file.relativePath),
        selectedFolderPaths,
      );
      const preview = await window.safetwin.createCleanupPreview({
        folderPairId: activePairId,
        selectedRelativePaths: cleanupSelectedFiles.map((file) => file.relativePath),
        selectedFolderPaths,
      });
      setCleanupPreview(preview);
      setCopyPreview(null);
    } catch (previewError) {
      setError(toFriendlyError(previewError, 'Could not create cleanup preview.'));
    } finally {
      setIsPreparingOperation(false);
    }
  };

  const createCleanupQueue = async () => {
    if (!activePairId) {
      return;
    }

    setIsPreparingOperation(true);
    setError(null);

    try {
      const nextOperation = await window.safetwin.createCleanupOperation({
        folderPairId: activePairId,
        selectedRelativePaths: cleanupSelectedFiles.map((file) => file.relativePath),
        selectedFolderPaths,
      });
      const startedOperation = await window.safetwin.startOperation(nextOperation.operation.id);
      setOperation(startedOperation);
      setOperationHistory((current) => [
        startedOperation,
        ...current.filter((item) => item.operation.id !== startedOperation.operation.id),
      ]);
      setCopyPreview(null);
      setCleanupPreview(null);
    } catch (operationError) {
      setError(toFriendlyError(operationError, 'Could not create cleanup queue.'));
    } finally {
      setIsPreparingOperation(false);
    }
  };

  const runOperationCommand = async (command: 'start' | 'pause' | 'resume' | 'cancel' | 'retry') => {
    if (!operation) {
      return;
    }

    try {
      let nextOperation =
        command === 'start'
          ? await window.safetwin.startOperation(operation.operation.id)
          : command === 'pause'
            ? await window.safetwin.pauseOperation(operation.operation.id)
            : command === 'resume'
              ? await window.safetwin.resumeOperation(operation.operation.id)
              : command === 'cancel'
                ? await window.safetwin.cancelOperation(operation.operation.id)
                : await window.safetwin.retryFailedOperation(operation.operation.id);

      if (command === 'retry') {
        nextOperation = await window.safetwin.startOperation(nextOperation.operation.id);
      }

      setOperation(nextOperation);
      setOperationHistory((current) => [nextOperation, ...current.filter((item) => item.operation.id !== nextOperation.operation.id)]);
    } catch (commandError) {
      setError(toFriendlyError(commandError, 'Operation command failed.'));
    }
  };

  const runMoreAction = (action: string) => {
    if (action === 'swap') {
      void swapRoles();
      return;
    }

    if (action === 'selectVisible') {
      selectVisibleEligible();
      return;
    }

    if (action === 'clearSelection') {
      clearSelection();
      return;
    }

    if (action === 'copyConflicts') {
      void createCopyQueue(conflictSelectedFiles.map((file) => file.relativePath));
    }
  };

  const groupedIgnoreRules = useMemo(() => {
    const groups = new Map<string, IgnoreRuleSetting[]>();

    for (const rule of ignoreRules) {
      groups.set(rule.category, [...(groups.get(rule.category) ?? []), rule]);
    }

    return [...groups.entries()];
  }, [ignoreRules]);

  const renderPane = (side: PaneSide, rows: PaneRow[], pathValue: string, rootPath: string) => (
    <section className="pane">
      <header className="pane-header">
        <div>
          <strong>
            {filter === 'missing' && side === 'origin'
              ? 'READY TO COPY'
              : filter === 'missing' && side === 'backup'
                ? 'BACKUP LOCATION'
                : side === 'origin'
                  ? 'ORIGIN'
                  : 'BACKUP'}
          </strong>
          <span>{rootPath || `No ${side} folder selected`}</span>
        </div>
        <button type="button" title={`Choose ${side} folder`} onClick={() => chooseFolder(side)}>
          <FolderOpen size={16} aria-hidden="true" />
        </button>
      </header>

      <div className="breadcrumb">
        <button type="button" title="Back" disabled={!pathValue} onClick={() => navigatePane(side, parentPath(pathValue))}>
          <ChevronLeft size={15} aria-hidden="true" />
        </button>
        <span>{pathValue || 'Root'}</span>
      </div>

      <div className="pane-list">
        {rows.map((row) => {
          const selected = row.kind === 'file' && selectedPaths.includes(row.relativePath);
          const folderSelected = row.kind === 'folder' && selectedFolderPaths.includes(row.relativePath);
          const eligible = rowIsSelectable(row);
          const isFolderRow = row.kind === 'folder' || row.kind === 'previewFolder' || row.kind === 'parent';
          const rowClasses = ['explorer-row'];

          if (selected || folderSelected) {
            rowClasses.push('explorer-row-selected');
          }

          if (
            (row.kind === 'file' && row.file.state === 'missingInBackup') ||
            (row.kind === 'folder' && side === 'origin' && row.counts.missingInBackup > 0) ||
            row.kind === 'missingPlaceholder'
          ) {
            rowClasses.push('explorer-row-missing');
          }

          const activateRow = () => {
            if (isFolderRow) {
              navigatePane(side, row.relativePath);
            } else if (row.kind === 'file' && selectionMode) {
              toggleSelectedPath(row.file);
            }
          };
          const openItemLocation = () => {
            if (row.kind !== 'file' && row.kind !== 'previewFile') {
              return;
            }

            const itemPath = row.kind === 'file' ? sidePath(row.file, side) : row.absolutePath;

            if (itemPath) {
              window.safetwin.showItemInFolder(itemPath).catch((openError: unknown) => {
                setError(toFriendlyError(openError, 'Could not open item folder.'));
              });
            }
          };

          return (
            <div
              className={rowClasses.join(' ')}
              key={`${side}-${row.kind}-${row.relativePath}`}
              role="button"
              tabIndex={0}
              onClick={activateRow}
              onDoubleClick={openItemLocation}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  activateRow();
                }
              }}
            >
              <span className="row-select">
                {selectionMode && row.kind === 'file' ? (
                  <input
                    type="checkbox"
                    checked={selected}
                    disabled={!eligible}
                    onChange={() => toggleSelectedPath(row.file)}
                    onClick={(event) => event.stopPropagation()}
                    aria-label={`Select ${row.name}`}
                  />
                ) : selectionMode && row.kind === 'folder' ? (
                  <input
                    type="checkbox"
                    checked={folderSelected}
                    disabled={!eligible}
                    onChange={() => toggleSelectedFolderPath(row.relativePath)}
                    onClick={(event) => event.stopPropagation()}
                    aria-label={`Select folder ${row.name}`}
                  />
                ) : null}
              </span>
              <span className="row-icon">
                {row.kind === 'parent' ? (
                  <ChevronLeft size={16} aria-hidden="true" />
                ) : row.kind === 'folder' || row.kind === 'previewFolder' ? (
                  <Folder size={16} aria-hidden="true" />
                ) : (
                  getFileIcon(row.relativePath)
                )}
              </span>
              <span className="row-name">{row.name}</span>
              <span className="row-status">{indicatorFor(row, side)}</span>
              <span className="row-size">
                {row.kind === 'file'
                  ? formatBytes(row.file.sizeBytes)
                  : row.kind === 'previewFile'
                    ? formatBytes(row.sizeBytes)
                    : row.kind === 'missingPlaceholder'
                      ? 'Missing'
                    : ''}
              </span>
            </div>
          );
        })}

        {rows.length === 0 ? <div className="empty-pane">No items at this level</div> : null}
      </div>
    </section>
  );

  return (
    <main className={`app-frame theme-${theme}`}>
      <div className="app-shell">
        <aside className="side-menu">
          <div className="side-brand">
            <h1>SafeTwin</h1>
            <span>Origin -&gt; Backup</span>
          </div>

          <section className="side-section">
            <h2>Actions</h2>
            <button type="button" onClick={() => scan()} disabled={isScanning}>
              {isScanning ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <RefreshCw size={16} aria-hidden="true" />}
              Scan
            </button>
            <button type="button" onClick={() => scan('deep')} disabled={isScanning}>
              <HardDrive size={16} aria-hidden="true" />
              Deep Scan
            </button>
            <button
              type="button"
              onClick={() => createCopyQueue([], [leftPath])}
              disabled={statusSummary.missingInBackup === 0 || isPreparingOperation}
            >
              <Copy size={16} aria-hidden="true" />
              Copy Ready
            </button>
            <button
              className={selectionMode ? 'toolbar-active' : ''}
              type="button"
              onClick={() => {
                setSelectionMode((current) => !current);
                setSelectedPaths([]);
                setSelectedFolderPaths([]);
                setCleanupPreview(null);
              }}
            >
              <CheckSquare size={16} aria-hidden="true" />
              Select
            </button>
            <button
              className={cleanupMode ? 'toolbar-active danger-action' : 'danger-action'}
              type="button"
              disabled={!activePairId || !backupPath}
              onClick={openDeleteExtras}
            >
              <Trash2 size={16} aria-hidden="true" />
              Delete Extras
            </button>
            <button type="button" onClick={() => setSettingsOpen((current) => !current)}>
              <Settings size={16} aria-hidden="true" />
              Settings
            </button>
          </section>

          <section className="side-section">
            <h2>View</h2>
            <label className="compact-field">
              Filter
              <select
                aria-label="View filter"
                value={filter}
                onChange={(event) => setFilter(event.target.value as FilterKey)}
              >
                {filterOptions.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <div className="search-box">
              <Search size={15} aria-hidden="true" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search"
              />
            </div>
            <label className="compact-field">
              Verify
              <select
                aria-label="Verification level"
                value={verificationLevel}
                onChange={(event) => setVerificationLevel(event.target.value as VerificationLevel)}
              >
                <option value="auto">Auto</option>
                <option value="basic">Size</option>
                <option value="strong">Hash</option>
              </select>
            </label>
            <label className="mirror-toggle">
              <input
                type="checkbox"
                checked={activePair?.mirrorNavigationEnabled ?? true}
                disabled={!activePair}
                onChange={(event) => updatePairSettings({ mirrorNavigationEnabled: event.target.checked })}
              />
              Mirror navigation
            </label>
          </section>

          <section className="side-section">
            <h2>Selection</h2>
            <span className="selection-summary">
              {selectedPaths.length + selectedFolderPaths.length} selected / {formatBytes(selectedBytes)}
            </span>
            <button
              type="button"
              disabled={cleanupMode || (copySelectedFiles.length === 0 && selectedFolderPaths.length === 0)}
              onClick={() => createCopyQueue(copySelectedFiles.map((file) => file.relativePath), selectedFolderPaths)}
            >
              Copy selected
            </button>
            {cleanupMode ? (
              <>
                <button type="button" onClick={selectVisibleEligible}>
                  Select visible extras
                </button>
                <button type="button" disabled={cleanupSelectedFiles.length === 0 && selectedFolderPaths.length === 0} onClick={previewCleanup}>
                  Preview delete
                </button>
                <button type="button" disabled={!cleanupPreview || cleanupPreview.filesSelected === 0} onClick={createCleanupQueue}>
                  Move to Recycle Bin
                </button>
              </>
            ) : null}
            <select
              aria-label="More actions"
              className="action-menu"
              value=""
              onChange={(event) => {
                runMoreAction(event.target.value);
                event.target.value = '';
              }}
            >
              <option value="">More actions</option>
              <option value="swap" disabled={!originPath || !backupPath || isScanning}>
                Swap roles
              </option>
              <option value="selectVisible">Select visible</option>
              <option value="clearSelection" disabled={selectedPaths.length === 0 && selectedFolderPaths.length === 0}>
                Clear selection
              </option>
              <option value="copyConflicts" disabled={cleanupMode || conflictSelectedFiles.length === 0}>
                Copy selected conflicts
              </option>
            </select>
          </section>

          <section className="side-section side-theme">
            <button type="button" title="Light theme" onClick={() => setTheme('light')}>
              <Sun size={16} aria-hidden="true" />
              Light
            </button>
            <button type="button" title="Dark theme" onClick={() => setTheme('dark')}>
              <Moon size={16} aria-hidden="true" />
              Dark
            </button>
          </section>
        </aside>

        <section className="main-workspace">
          <section className="status-strip">
        <span>Last scan: {formatDate(activePair?.lastScanAt ?? null)}</span>
        <span>Last copy: {formatDate(lastCopyAt)}</span>
        <span>Last cleanup: {formatDate(lastCleanupAt)}</span>
        <span>
          Missing in backup: {statusSummary.missingInBackup} files / {formatBytes(statusSummary.totalMissingSize)}
        </span>
        <span>
          Backup-only: {statusSummary.backupOnly} files / {formatBytes(statusSummary.totalBackupOnlySize)}
        </span>
        <span>Conflicts: {statusSummary.conflicts}</span>
        <span>Ignored: {statusSummary.ignored}</span>
        <span>Skipped: {skippedCount(statusSummary)}</span>
        {isLoadingMarkers ? (
          <span className="marker-loading">
            <Loader2 className="spin" size={12} aria-hidden="true" />
            Updating markers
          </span>
        ) : null}
      </section>

      {reminderMessage ? <div className="reminder-bar">{reminderMessage}</div> : null}

      {scanProgress ? (
        <section className="scan-progress">
          <div className="scan-progress-main">
            <Loader2 className={isScanning ? 'spin' : ''} size={15} aria-hidden="true" />
            <strong>{scanProgress.message}</strong>
            <span>{scanProgress.mode === 'deep' ? 'Deep scan' : 'Scan'}</span>
            <span>{scanProgress.side}</span>
            <span>{scanProgress.filesDiscovered} files</span>
            <span>{scanProgress.foldersDiscovered} folders</span>
            <span>{scanProgress.ignored} ignored</span>
            <span>{scanProgress.skipped} skipped</span>
          </div>
          <p>{scanProgress.currentPath || 'Preparing folders'}</p>
        </section>
      ) : null}

      {error ? (
        <div className="error-banner">
          <AlertTriangle size={16} aria-hidden="true" />
          {error}
        </div>
      ) : null}

      {copyPreview ? (
        <section className="operation-preview">
          <strong>Copy preview</strong>
          <span>Files selected: {copyPreview.filesSelected}</span>
          <span>Conflicts as duplicates: {copyPreview.conflictsSelected}</span>
          <span>Total size: {formatBytes(copyPreview.totalSize)}</span>
          <span>Action: copy Origin to Backup; existing Backup files stay preserved</span>
        </section>
      ) : null}

      {cleanupPreview ? (
        <section className="cleanup-preview">
          <strong>Cleanup preview</strong>
          <span>Files selected: {cleanupPreview.filesSelected}</span>
          <span>Folders selected: {cleanupPreview.foldersSelected}</span>
          <span>Total size: {formatBytes(cleanupPreview.totalSize)}</span>
          <span>Action: move selected backup-only items to Recycle Bin</span>
        </section>
      ) : null}

      <section className="path-panels">
        {renderPane('origin', leftRows, leftPath, originPath)}
        <div className="pane-divider" />
        {renderPane('backup', rightRows, rightPath, backupPath)}
      </section>

      {settingsOpen ? (
        <aside className="settings-panel">
          <header>
            <strong>Settings</strong>
            <button type="button" title="Close settings" onClick={() => setSettingsOpen(false)}>
              <X size={16} aria-hidden="true" />
            </button>
          </header>

          <section>
            <h2>Reminder interval</h2>
            {[null, 7, 14, 30].map((interval) => (
              <label className="setting-row" key={interval ?? 'off'}>
                <input
                  type="radio"
                  checked={(activePair?.reminderIntervalDays ?? null) === interval}
                  disabled={!activePair}
                  onChange={() => updatePairSettings({ reminderIntervalDays: interval })}
                />
                {interval === null ? 'Off' : `Every ${interval} days`}
              </label>
            ))}
          </section>

          <section>
            <h2>Ignore rules</h2>
            {groupedIgnoreRules.map(([category, rules]) => (
              <label className="ignore-rule-row" key={category}>
                <input
                  type="checkbox"
                  checked={rules.every((rule) => rule.enabled)}
                  onChange={(event) =>
                    window.safetwin
                      .setIgnoreRuleCategoryEnabled(category, event.target.checked)
                      .then(setIgnoreRules)
                      .catch((ignoreError: unknown) => {
                        setError(toFriendlyError(ignoreError, 'Could not update ignore rules.'));
                      })
                  }
                />
                <span>{category}</span>
                <small>{rules.map((rule) => rule.pattern).join(', ')}</small>
              </label>
            ))}
          </section>

          <section>
            <button className="link-button" type="button" onClick={() => setIgnoredOpen((current) => !current)}>
              Ignored files in last scan: {ignoredFiles.length}
              <ChevronRight size={14} aria-hidden="true" />
            </button>
            {ignoredOpen ? (
              <div className="ignored-list">
                {ignoredFiles.map((file) => (
                  <div className="ignored-row" key={`${file.path}-${file.reason}`}>
                    <span>{file.path}</span>
                    <small>{file.reason}</small>
                  </div>
                ))}
                {ignoredFiles.length === 0 ? <div className="empty-pane">No ignored files in the last scan</div> : null}
              </div>
            ) : null}
          </section>
        </aside>
      ) : null}

      {operation ? (
        <section className="operation-drawer">
          <div className="drawer-title">
            <strong>{operation.operation.type === 'copy' ? 'Copy queue' : 'Cleanup queue'}</strong>
            <span>{operation.operation.state}</span>
          </div>
          <div className="drawer-actions">
            <button type="button" title="Start" onClick={() => runOperationCommand('start')} disabled={!['pending', 'failed'].includes(operation.operation.state)}>
              <Play size={15} aria-hidden="true" />
            </button>
            <button type="button" title="Pause" onClick={() => runOperationCommand('pause')} disabled={operation.operation.state !== 'running'}>
              <Pause size={15} aria-hidden="true" />
            </button>
            <button type="button" title="Resume" onClick={() => runOperationCommand('resume')} disabled={operation.operation.state !== 'paused'}>
              <Play size={15} aria-hidden="true" />
            </button>
            <button type="button" title="Cancel" onClick={() => runOperationCommand('cancel')} disabled={!['pending', 'running', 'paused'].includes(operation.operation.state)}>
              <Square size={15} aria-hidden="true" />
            </button>
            <button type="button" title="Retry failed" onClick={() => runOperationCommand('retry')} disabled={operation.totals.failedItems === 0 && operation.totals.cancelledItems === 0}>
              <RotateCcw size={15} aria-hidden="true" />
            </button>
          </div>
          <div className="drawer-summary">
            <span>
              {operation.totals.completedItems}/{operation.totals.totalItems} items
            </span>
            <span>
              {formatBytes(operation.totals.bytesDone)} / {formatBytes(operation.totals.bytesTotal)}
            </span>
            <span>{progressPercent(operation.totals.bytesDone, operation.totals.bytesTotal)}%</span>
            <span>{formatBytes(operation.totals.currentSpeedBytesPerSecond)}/s</span>
          </div>
          <div className="drawer-items">
            {operation.items.slice(0, 10).map((item) => (
              <div className="drawer-item" key={item.id}>
                <span className={`queue-state queue-state-${item.state}`}>{item.state}</span>
                <span title={`${item.sourcePath ?? ''}\n${item.destinationPath ?? ''}`}>{item.relativePath}</span>
                <small>{progressPercent(item.bytesDone, item.bytesTotal)}%</small>
                <small>{item.verificationState}</small>
                <button
                  type="button"
                  title="Open source folder"
                  disabled={!item.sourcePath}
                  onClick={() => item.sourcePath && window.safetwin.showItemInFolder(item.sourcePath)}
                >
                  <FolderOpen size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  title="Open backup folder"
                  disabled={!item.destinationPath}
                  onClick={() => item.destinationPath && window.safetwin.showItemInFolder(item.destinationPath)}
                >
                  <HardDrive size={14} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        </section>
      ) : null}
        </section>
      </div>
    </main>
  );
};

export default App;
