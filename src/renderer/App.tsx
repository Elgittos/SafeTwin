import { useEffect, useMemo, useState } from 'react';
import { Check, FolderOpen, Loader2 } from 'lucide-react';
import type {
  DirectoryPreviewEntry,
  FolderPair,
  OperationSnapshot,
  SaveFolderPairInput,
  ScanProgressEvent,
  ScanSummary,
  ScanResult,
} from '../shared/types';

type PaneSide = 'origin' | 'backup';
type ThemeMode = 'light' | 'dark';

interface ItemContextMenu {
  x: number;
  y: number;
  side: PaneSide;
  entry: DirectoryPreviewEntry;
  rootPath: string;
}

const normalizePath = (relativePath: string): string =>
  relativePath.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');

const parentPath = (relativePath: string): string => {
  const normalized = normalizePath(relativePath);
  const slashIndex = normalized.lastIndexOf('/');
  return slashIndex === -1 ? '' : normalized.slice(0, slashIndex);
};

const folderName = (folderPath: string, fallback: string): string =>
  folderPath.split(/[\\/]/).filter(Boolean).at(-1) ?? fallback;

const pairName = (originPath: string, backupPath: string): string =>
  `${folderName(originPath, 'Origin')} to ${folderName(backupPath, 'Backup')}`;

const formatBytes = (bytes: number): string => {
  if (bytes === 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
};

const toFriendlyError = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message || fallback : fallback;

const fileKey = (relativePath: string): string => normalizePath(relativePath).toLowerCase();

const isMissingDirectoryError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes('enoent') || message.includes('no such file or directory') || message.includes('scandir');
};

const folderHasDiff = (counts: ScanSummary): boolean =>
  counts.missingInBackup > 0 ||
  counts.backupOnly > 0 ||
  counts.conflicts > 0 ||
  counts.ignored > 0 ||
  counts.notLocalPlaceholder > 0 ||
  counts.lockedOrUnreadable > 0 ||
  counts.unstableChangingFile > 0;

const terminalOperationStates = ['completed', 'failed', 'cancelled'] as const;

const isTerminalOperationState = (state: OperationSnapshot['operation']['state']): boolean =>
  terminalOperationStates.includes(state as (typeof terminalOperationStates)[number]);

const operationVerb = (operation: OperationSnapshot): string =>
  operation.operation.type === 'copy' ? 'Copy' : 'Delete';

const getInitialTheme = (): ThemeMode => {
  const savedTheme = window.localStorage.getItem('safetwin-theme');

  if (savedTheme === 'light' || savedTheme === 'dark') {
    return savedTheme;
  }

  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

const App = () => {
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);
  const [activePair, setActivePair] = useState<FolderPair | null>(null);
  const [originPath, setOriginPath] = useState('');
  const [backupPath, setBackupPath] = useState('');
  const [originCurrentPath, setOriginCurrentPath] = useState('');
  const [backupCurrentPath, setBackupCurrentPath] = useState('');
  const [linkedNavigation, setLinkedNavigation] = useState(true);
  const [originEntries, setOriginEntries] = useState<DirectoryPreviewEntry[]>([]);
  const [backupEntries, setBackupEntries] = useState<DirectoryPreviewEntry[]>([]);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [selectedCopyPaths, setSelectedCopyPaths] = useState<string[]>([]);
  const [selectedCopyFolderPaths, setSelectedCopyFolderPaths] = useState<string[]>([]);
  const [selectedDeletePaths, setSelectedDeletePaths] = useState<string[]>([]);
  const [selectedDeleteFolderPaths, setSelectedDeleteFolderPaths] = useState<string[]>([]);
  const [cleanAllConfirmOpen, setCleanAllConfirmOpen] = useState(false);
  const [cleanAllConfirmText, setCleanAllConfirmText] = useState('');
  const [operation, setOperation] = useState<OperationSnapshot | null>(null);
  const [scanProgress, setScanProgress] = useState<ScanProgressEvent | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [itemContextMenu, setItemContextMenu] = useState<ItemContextMenu | null>(null);

  const missingFiles = useMemo(
    () => scanResult?.files.filter((file) => file.state === 'missingInBackup') ?? [],
    [scanResult],
  );
  const backupOnlyFiles = useMemo(
    () => scanResult?.files.filter((file) => file.state === 'backupOnly') ?? [],
    [scanResult],
  );
  const conflictFiles = useMemo(
    () => scanResult?.files.filter((file) => file.state === 'conflictSamePathDifferentContent') ?? [],
    [scanResult],
  );
  const conflictByPath = useMemo(
    () => new Map(conflictFiles.map((file) => [fileKey(file.displayPath), file])),
    [conflictFiles],
  );
  const folderSummaryByPath = useMemo(
    () => new Map((scanResult?.folders ?? []).map((folder) => [fileKey(folder.displayPath), folder.counts])),
    [scanResult],
  );
  const copyCandidateByPath = useMemo(
    () => new Map(missingFiles.map((file) => [fileKey(file.displayPath), file])),
    [missingFiles],
  );
  const cleanupCandidateByPath = useMemo(
    () => new Map(backupOnlyFiles.map((file) => [fileKey(file.displayPath), file])),
    [backupOnlyFiles],
  );

  const selectedCopyBytes = selectedCopyPaths.reduce(
    (total, path) => total + (copyCandidateByPath.get(fileKey(path))?.sizeBytes ?? 0),
    0,
  );
  const selectedCopyFolderBytes = selectedCopyFolderPaths.reduce(
    (total, path) => total + (folderSummaryByPath.get(fileKey(path))?.totalMissingSize ?? 0),
    0,
  );
  const selectedCopyCount = selectedCopyPaths.length + selectedCopyFolderPaths.length;
  const selectedDeleteBytes = selectedDeletePaths.reduce(
    (total, path) => total + (cleanupCandidateByPath.get(fileKey(path))?.sizeBytes ?? 0),
    0,
  );
  const selectedDeleteFolderBytes = selectedDeleteFolderPaths.reduce(
    (total, path) => total + (folderSummaryByPath.get(fileKey(path))?.totalBackupOnlySize ?? 0),
    0,
  );
  const selectedDeleteCount = selectedDeletePaths.length + selectedDeleteFolderPaths.length;
  const cleanAllBytes = backupOnlyFiles.reduce((total, file) => total + file.sizeBytes, 0);
  const cleanAllConfirmed = cleanAllConfirmText.trim().toUpperCase() === 'CLEAN DIFFERENCES';
  const operationPercent =
    operation && operation.totals.bytesTotal > 0
      ? Math.min(100, Math.round((operation.totals.bytesDone / operation.totals.bytesTotal) * 100))
      : 0;

  useEffect(() => {
    window.localStorage.setItem('safetwin-theme', theme);
  }, [theme]);

  useEffect(() => {
    window.safetwin
      .getLastFolderPair()
      .then((pair) => {
        if (!pair) {
          return;
        }

        setActivePair(pair);
        setOriginPath(pair.originPath);
        setBackupPath(pair.backupPath);
        setLinkedNavigation(pair.mirrorNavigationEnabled);
        return window.safetwin.getLastStatus(pair.id);
      })
      .then((status) => {
        if (status?.lastScan) {
          setScanResult(status.lastScan);
        }
      })
      .catch((loadError: unknown) => {
        setError(toFriendlyError(loadError, 'Could not load the saved folder pair.'));
      });

    return window.safetwin.onScanProgress(setScanProgress);
  }, []);

  useEffect(() => {
    if (!originPath) {
      setOriginEntries([]);
      return;
    }

    window.safetwin
      .listDirectory(originPath, originCurrentPath)
      .then((entries) => {
        setOriginEntries(entries);
      })
      .catch((listError: unknown) => {
        setOriginEntries([]);
        if (!isMissingDirectoryError(listError)) {
          setError(toFriendlyError(listError, 'Could not read the origin folder.'));
        }
      });
  }, [originCurrentPath, originPath, refreshToken]);

  useEffect(() => {
    if (!backupPath) {
      setBackupEntries([]);
      return;
    }

    window.safetwin
      .listDirectory(backupPath, backupCurrentPath)
      .then((entries) => {
        setBackupEntries(entries);
      })
      .catch((listError: unknown) => {
        setBackupEntries([]);
        if (!isMissingDirectoryError(listError)) {
          setError(toFriendlyError(listError, 'Could not read the backup folder.'));
        }
      });
  }, [backupCurrentPath, backupPath, refreshToken]);

  useEffect(() => {
    if (!operation || isTerminalOperationState(operation.operation.state)) {
      return undefined;
    }

    const interval = window.setInterval(() => {
      window.safetwin
        .getOperation(operation.operation.id)
        .then((snapshot) => {
          setOperation(snapshot);
          if (isTerminalOperationState(snapshot.operation.state)) {
            const verb = operationVerb(snapshot);
            const failedText = snapshot.totals.failedItems > 0 ? `, ${snapshot.totals.failedItems} failed` : '';
            setActionMessage(
              `${verb} ${snapshot.operation.state}: ${snapshot.totals.completedItems}/${snapshot.totals.totalItems} items${failedText}.`,
            );
            setRefreshToken((token) => token + 1);
            if (activePair) {
              window.safetwin
                .getLastStatus(activePair.id)
                .then((status) => setScanResult(status.lastScan))
                .catch(() => undefined);
            }
          }
        })
        .catch(() => undefined);
    }, 500);

    return () => window.clearInterval(interval);
  }, [activePair, operation]);

  useEffect(() => {
    if (!itemContextMenu) {
      return undefined;
    }

    const closeMenu = () => {
      setItemContextMenu(null);
    };

    window.addEventListener('click', closeMenu);
    window.addEventListener('keydown', closeMenu);
    window.addEventListener('resize', closeMenu);

    return () => {
      window.removeEventListener('click', closeMenu);
      window.removeEventListener('keydown', closeMenu);
      window.removeEventListener('resize', closeMenu);
    };
  }, [itemContextMenu]);

  const savePair = async (nextOriginPath: string, nextBackupPath: string): Promise<FolderPair> => {
    if (!nextOriginPath || !nextBackupPath) {
      throw new Error('Choose both an origin folder and a backup folder.');
    }

    const input: SaveFolderPairInput = {
      id:
        activePair?.originPath === nextOriginPath && activePair.backupPath === nextBackupPath
          ? activePair.id
          : undefined,
      name: pairName(nextOriginPath, nextBackupPath),
      originPath: nextOriginPath,
      backupPath: nextBackupPath,
      mirrorNavigationEnabled: linkedNavigation,
      reminderIntervalDays: null,
    };
    const savedPair = await window.safetwin.saveFolderPair(input);
    setActivePair(savedPair);
    setOriginPath(savedPair.originPath);
    setBackupPath(savedPair.backupPath);
    setLinkedNavigation(savedPair.mirrorNavigationEnabled);
    return savedPair;
  };

  const resetPanePaths = () => {
    setOriginCurrentPath('');
    setBackupCurrentPath('');
  };

  const navigatePane = (side: PaneSide, nextPath: string) => {
    const normalizedPath = normalizePath(nextPath);

    if (linkedNavigation) {
      setOriginCurrentPath(normalizedPath);
      setBackupCurrentPath(normalizedPath);
      return;
    }

    if (side === 'origin') {
      setOriginCurrentPath(normalizedPath);
      return;
    }

    setBackupCurrentPath(normalizedPath);
  };

  const toggleLinkedNavigation = async () => {
    const nextValue = !linkedNavigation;
    setLinkedNavigation(nextValue);
    setError(null);

    if (nextValue) {
      setBackupCurrentPath(originCurrentPath);
    }

    if (!activePair) {
      return;
    }

    try {
      const updatedPair = await window.safetwin.updateFolderPairSettings({
        id: activePair.id,
        mirrorNavigationEnabled: nextValue,
      });
      setActivePair(updatedPair);
      setLinkedNavigation(updatedPair.mirrorNavigationEnabled);
    } catch (settingsError: unknown) {
      setLinkedNavigation(!nextValue);
      setError(toFriendlyError(settingsError, 'Could not save the navigation setting.'));
    }
  };

  const chooseFolder = async (side: PaneSide) => {
    const result = await window.safetwin.chooseFolder();

    if (result.canceled || !result.path) {
      return;
    }

    const nextOriginPath = side === 'origin' ? result.path : originPath;
    const nextBackupPath = side === 'backup' ? result.path : backupPath;
    setError(null);
    resetPanePaths();
    setSelectedCopyPaths([]);
    setSelectedCopyFolderPaths([]);
    setSelectedDeletePaths([]);
    setSelectedDeleteFolderPaths([]);
    setOriginPath(nextOriginPath);
    setBackupPath(nextBackupPath);

    if (nextOriginPath && nextBackupPath) {
      try {
        const savedPair = await savePair(nextOriginPath, nextBackupPath);
        await runScan(savedPair);
      } catch (folderError: unknown) {
        setError(toFriendlyError(folderError, 'Could not save or scan the selected folders.'));
      }
    }
  };

  const runScan = async (pair = activePair, mode: 'metadata' | 'deep' = 'metadata') => {
    if (!pair) {
      throw new Error('Choose both folders first.');
    }

    setIsBusy(true);
    setError(null);
    try {
      setActionMessage(mode === 'deep' ? 'Full scan started: rebuilding the complete diff from disk.' : 'Refreshing diff from disk.');
      const result = await window.safetwin.scanPair(pair.id, mode);
      setScanResult(result);
      setScanProgress(null);
      setRefreshToken((token) => token + 1);
      setActionMessage(
        mode === 'deep'
          ? `Full scan completed: ${result.summary.missingInBackup} missing, ${result.summary.backupOnly} extra, ${result.summary.conflicts} different.`
          : `Diff refreshed: ${result.summary.missingInBackup} missing, ${result.summary.backupOnly} extra, ${result.summary.conflicts} different.`,
      );
      return result;
    } finally {
      setIsBusy(false);
    }
  };

  const startOperation = async (snapshot: OperationSnapshot) => {
    setActionMessage(
      `${operationVerb(snapshot)} queued: ${snapshot.totals.totalItems} items, ${formatBytes(snapshot.totals.bytesTotal)}.`,
    );
    setOperation(snapshot);
    const started = await window.safetwin.startOperation(snapshot.operation.id);
    setActionMessage(
      `${operationVerb(started)} running: ${started.totals.totalItems} items, ${formatBytes(started.totals.bytesTotal)}.`,
    );
    setOperation(started);
  };

  const stopOperation = async () => {
    if (!operation || !['pending', 'running', 'paused'].includes(operation.operation.state)) {
      return;
    }

    setError(null);
    try {
      const cancelled = await window.safetwin.cancelOperation(operation.operation.id);
      setOperation(cancelled);
      setActionMessage(`Stopped ${operationVerb(cancelled).toLowerCase()}: ${cancelled.totals.cancelledItems} items cancelled.`);
      setRefreshToken((token) => token + 1);
    } catch (stopError: unknown) {
      setError(toFriendlyError(stopError, 'Could not stop the current operation.'));
    }
  };

  const refreshAfterManualFileChange = async () => {
    setRefreshToken((token) => token + 1);

    if (activePair) {
      try {
        await runScan(activePair);
      } catch (scanError: unknown) {
        setError(toFriendlyError(scanError, 'File was changed, but the diff refresh failed.'));
      }
    }
  };

  const deleteContextItem = async (menu: ItemContextMenu) => {
    const itemLabel = menu.entry.kind === 'folder' ? 'folder and everything inside it' : 'file';
    const confirmed = window.confirm(`Move this ${itemLabel} to Recycle Bin?\n\n${menu.entry.absolutePath}`);

    if (!confirmed) {
      return;
    }

    setIsBusy(true);
    setError(null);

    try {
      const trashResult = await window.safetwin.trashItem({
        rootPath: menu.rootPath,
        itemPath: menu.entry.absolutePath,
      });
      setActionMessage(
        trashResult.method === 'recycleBin'
          ? `Moved ${menu.entry.kind} to Recycle Bin: ${menu.entry.name}.`
          : `Windows Recycle Bin refused it, so SafeTwin moved ${menu.entry.kind} to local trash: ${menu.entry.name}.`,
      );
      setSelectedCopyPaths((paths) => paths.filter((selectedPath) => selectedPath !== menu.entry.relativePath));
      setSelectedCopyFolderPaths((paths) => paths.filter((selectedPath) => selectedPath !== menu.entry.relativePath));
      setSelectedDeletePaths((paths) => paths.filter((selectedPath) => selectedPath !== menu.entry.relativePath));
      setSelectedDeleteFolderPaths((paths) => paths.filter((selectedPath) => selectedPath !== menu.entry.relativePath));
      await refreshAfterManualFileChange();
    } catch (deleteError: unknown) {
      setError(toFriendlyError(deleteError, 'Could not move the item to Recycle Bin.'));
    } finally {
      setIsBusy(false);
    }
  };

  const copyPaths = async (paths: string[], folderPaths: string[] = []) => {
    if (!activePair || (paths.length === 0 && folderPaths.length === 0)) {
      return;
    }

    setIsBusy(true);
    setError(null);
    const selectedCount = paths.length + folderPaths.length;
    setActionMessage(`Copy requested now: ${selectedCount} selected items. Verifying current diff before copying.`);
    try {
      const latestScan = await runScan(activePair);
      const stillCopyable = new Set(
        latestScan.files.filter((file) => file.state === 'missingInBackup').map((file) => fileKey(file.relativePath)),
      );
      const selectedRelativePaths = paths.filter((path) => stillCopyable.has(fileKey(path)));
      const snapshot = await window.safetwin.createCopyOperation({
        folderPairId: activePair.id,
        selectedRelativePaths,
        selectedFolderPaths: folderPaths,
        includeConflictsAsDuplicates: false,
        verificationLevel: 'auto',
      });
      await startOperation(snapshot);
      setSelectedCopyPaths([]);
      setSelectedCopyFolderPaths([]);
      setCleanAllConfirmOpen(false);
      setCleanAllConfirmText('');
    } catch (copyError: unknown) {
      setError(toFriendlyError(copyError, 'Could not copy files.'));
    } finally {
      setIsBusy(false);
    }
  };

  const deletePaths = async (paths: string[], folderPaths: string[] = []) => {
    if (!activePair || (paths.length === 0 && folderPaths.length === 0)) {
      return;
    }

    setIsBusy(true);
    setError(null);
    const selectedCount = paths.length + folderPaths.length;
    setActionMessage(`Delete requested now: ${selectedCount} selected items. Verifying current diff before moving to Recycle Bin.`);
    try {
      await runScan(activePair);
      const snapshot = await window.safetwin.createCleanupOperation({
        folderPairId: activePair.id,
        selectedRelativePaths: paths,
        selectedFolderPaths: folderPaths,
      });
      await startOperation(snapshot);
      setSelectedDeletePaths([]);
      setSelectedDeleteFolderPaths([]);
      setCleanAllConfirmOpen(false);
      setCleanAllConfirmText('');
    } catch (deleteError: unknown) {
      setError(toFriendlyError(deleteError, 'Could not delete backup files.'));
    } finally {
      setIsBusy(false);
    }
  };

  const invertRoles = async () => {
    if (!originPath || !backupPath) {
      setError('Choose both folders before using Invert.');
      return;
    }

    setIsBusy(true);
    setError(null);
    try {
      const savedPair = await savePair(backupPath, originPath);
      resetPanePaths();
      setSelectedCopyPaths([]);
      setSelectedCopyFolderPaths([]);
      setSelectedDeletePaths([]);
      setSelectedDeleteFolderPaths([]);
      await runScan(savedPair);
    } catch (invertError: unknown) {
      setError(toFriendlyError(invertError, 'Could not invert the folder roles.'));
    } finally {
      setIsBusy(false);
    }
  };

  const toggleSelected = (side: PaneSide, relativePath: string) => {
    const setter = side === 'origin' ? setSelectedCopyPaths : setSelectedDeletePaths;
    setter((current) =>
      current.includes(relativePath)
        ? current.filter((selectedPath) => selectedPath !== relativePath)
        : [...current, relativePath],
    );
  };

  const toggleCopyFolderSelected = (relativePath: string) => {
    setSelectedCopyFolderPaths((current) =>
      current.includes(relativePath)
        ? current.filter((selectedPath) => selectedPath !== relativePath)
        : [...current, relativePath],
    );
  };

  const toggleDeleteFolderSelected = (relativePath: string) => {
    setSelectedDeleteFolderPaths((current) =>
      current.includes(relativePath)
        ? current.filter((selectedPath) => selectedPath !== relativePath)
        : [...current, relativePath],
    );
  };

  const renderPane = (
    side: PaneSide,
    entries: DirectoryPreviewEntry[],
    rootPath: string,
    currentPath: string,
    oppositeEntries: DirectoryPreviewEntry[],
  ) => {
    const isOrigin = side === 'origin';
    const selectedPaths = isOrigin ? selectedCopyPaths : selectedDeletePaths;
    const markerMap = isOrigin ? copyCandidateByPath : cleanupCandidateByPath;
    const oppositeEntryKeys = new Set(oppositeEntries.map((entry) => fileKey(entry.relativePath)));

    return (
      <section className={`pane pane-${side}`}>
        <header className="pane-header">
          <div>
            <strong>{isOrigin ? 'Origin folder' : 'Backup folder'}</strong>
            <button type="button" className="folder-picker" onClick={() => chooseFolder(side)}>
              <FolderOpen size={15} aria-hidden="true" />
              <span>{rootPath || `Choose ${isOrigin ? 'origin' : 'backup'}`}</span>
            </button>
          </div>
        </header>

        <div className="breadcrumb">
          <button type="button" disabled={!currentPath} onClick={() => navigatePane(side, parentPath(currentPath))}>
            Up
          </button>
          <span>{currentPath || 'Root'}</span>
        </div>

        <div className="file-list">
          {entries.map((entry) => {
            const key = fileKey(entry.relativePath);
            const markedFile = entry.kind === 'file' ? markerMap.get(key) : null;
            const conflictFile = entry.kind === 'file' ? conflictByPath.get(key) : null;
            const folderSummary = entry.kind === 'folder' ? folderSummaryByPath.get(key) : null;
            const shouldShowPlus =
              isOrigin &&
              ((entry.kind === 'file' && Boolean(markedFile)) ||
                (entry.kind === 'folder' && Boolean(folderSummary && folderSummary.missingInBackup > 0)));
            const shouldShowMinus =
              !isOrigin &&
              ((entry.kind === 'file' && Boolean(markedFile)) ||
                (entry.kind === 'folder' && Boolean(folderSummary && folderSummary.backupOnly > 0)));
            const shouldShowChanged =
              (entry.kind === 'file' && Boolean(conflictFile)) ||
              (entry.kind === 'folder' && Boolean(folderSummary && folderSummary.conflicts > 0));
            const shouldShowCheck =
              entry.kind === 'folder' && Boolean(folderSummary && !folderHasDiff(folderSummary));
            const isOriginOnlyFolder =
              isOrigin &&
              entry.kind === 'folder' &&
              !oppositeEntryKeys.has(key) &&
              Boolean(folderSummary && folderSummary.missingInBackup > 0);
            const isBackupOnlyFolder =
              !isOrigin &&
              entry.kind === 'folder' &&
              !oppositeEntryKeys.has(key) &&
              Boolean(folderSummary && folderSummary.backupOnly > 0);
            const canSelectFile = entry.kind === 'file' && Boolean(markedFile);
            const canSelectFolder = isOriginOnlyFolder || isBackupOnlyFolder;
            const selected =
              entry.kind === 'folder'
                ? isOrigin
                  ? selectedCopyFolderPaths.includes(entry.relativePath)
                  : selectedDeleteFolderPaths.includes(entry.relativePath)
                : selectedPaths.includes(entry.relativePath);

            return (
              <div className="file-row" key={`${side}-${entry.relativePath}`}>
                <span className="check-cell">
                  {canSelectFile || canSelectFolder ? (
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => {
                        if (entry.kind === 'folder') {
                          if (isOrigin) {
                            toggleCopyFolderSelected(entry.relativePath);
                            return;
                          }

                          toggleDeleteFolderSelected(entry.relativePath);
                          return;
                        }

                        toggleSelected(side, entry.relativePath);
                      }}
                      aria-label={`Select ${entry.name}`}
                    />
                  ) : null}
                </span>
                <button
                  type="button"
                  className="file-main"
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setItemContextMenu({
                      x: event.clientX,
                      y: event.clientY,
                      side,
                      entry,
                      rootPath,
                    });
                  }}
                  onClick={() => {
                    if (entry.kind === 'folder') {
                      navigatePane(side, entry.relativePath);
                    } else if (canSelectFile) {
                      toggleSelected(side, entry.relativePath);
                    }
                  }}
                >
                  <span className={`file-icon ${entry.kind}`}>{entry.kind === 'folder' ? 'Folder' : 'File'}</span>
                  <span className="file-name">{entry.name}</span>
                  <span className="file-size">{entry.kind === 'file' ? formatBytes(entry.sizeBytes) : ''}</span>
                  {shouldShowPlus || shouldShowMinus || shouldShowChanged || shouldShowCheck ? (
                    <span
                      className={`corner-marker ${
                        shouldShowCheck
                          ? 'same-marker'
                          : shouldShowChanged
                            ? 'changed-marker'
                            : shouldShowPlus
                              ? 'copy-marker'
                              : 'delete-marker'
                      }`}
                      title={
                        shouldShowCheck
                          ? 'This folder is fully identical'
                          : shouldShowChanged
                            ? 'Same path exists on both sides, but the file content or modified time is different'
                            : shouldShowPlus
                              ? 'This folder or file is missing from backup'
                              : 'This folder or file exists only in backup'
                      }
                    >
                      {shouldShowCheck ? (
                        <Check size={13} strokeWidth={3} aria-hidden="true" />
                      ) : shouldShowChanged ? (
                        '!'
                      ) : shouldShowPlus ? (
                        '+'
                      ) : (
                        '-'
                      )}
                    </span>
                  ) : null}
                </button>
              </div>
            );
          })}
          {entries.length === 0 ? <div className="empty-pane">No files here.</div> : null}
        </div>
      </section>
    );
  };

  return (
    <main className={`app-frame theme-${theme}`}>
      <aside className="action-bar">
        <div className="brand">
          <h1>SafeTwin</h1>
          <span>Origin -&gt; Backup</span>
          <button
            type="button"
            className="theme-toggle"
            onClick={() => setTheme((current) => (current === 'light' ? 'dark' : 'light'))}
          >
            {theme === 'light' ? 'Dark mode' : 'Light mode'}
          </button>
        </div>

        <button
          type="button"
          className={`link-toggle ${linkedNavigation ? 'link-toggle-on' : ''}`}
          disabled={!originPath || !backupPath || isBusy}
          onClick={() => {
            void toggleLinkedNavigation();
          }}
          title={
            linkedNavigation
              ? 'Folder panes move together'
              : 'Folder panes navigate independently'
          }
        >
          Linked navigation: {linkedNavigation ? 'On' : 'Off'}
        </button>

        <button
          type="button"
          disabled={!activePair || isBusy}
          onClick={() => {
            void runScan(activePair, 'deep');
          }}
        >
          Full Scan
        </button>
        <button type="button" disabled={!activePair || missingFiles.length === 0 || isBusy} onClick={() => copyPaths(missingFiles.map((file) => file.relativePath))}>
          Copy All
        </button>
        <button
          type="button"
          disabled={!activePair || selectedCopyCount === 0 || isBusy}
          onClick={() => {
            void copyPaths(selectedCopyPaths, selectedCopyFolderPaths);
          }}
        >
          Copy Selected
        </button>
        <button
          type="button"
          disabled={!activePair || backupOnlyFiles.length === 0 || isBusy}
          onClick={() => {
            setCleanAllConfirmOpen(true);
            setCleanAllConfirmText('');
          }}
        >
          Clean Differences
        </button>
        <button
          type="button"
          disabled={!activePair || selectedDeleteCount === 0 || isBusy}
          onClick={() => {
            void deletePaths(selectedDeletePaths, selectedDeleteFolderPaths);
          }}
        >
          Delete Selected
        </button>
        <button type="button" disabled={!originPath || !backupPath || isBusy} onClick={invertRoles}>
          Invert
        </button>
        <button
          type="button"
          className="stop-button"
          disabled={!operation || !['pending', 'running', 'paused'].includes(operation.operation.state)}
          onClick={stopOperation}
        >
          Stop
        </button>

        {cleanAllConfirmOpen ? (
          <section className="selection-panel danger-panel">
            <strong>Clean {backupOnlyFiles.length} differences</strong>
            <span>{formatBytes(cleanAllBytes)} will be moved from backup to Recycle Bin.</span>
            <label>
              Type CLEAN DIFFERENCES
              <input
                value={cleanAllConfirmText}
                onChange={(event) => setCleanAllConfirmText(event.target.value)}
                aria-label="Type CLEAN DIFFERENCES to confirm Clean Differences"
              />
            </label>
            <button
              type="button"
              disabled={!cleanAllConfirmed || isBusy}
              onClick={() => deletePaths(backupOnlyFiles.map((file) => file.relativePath))}
            >
              Clean now
            </button>
            <button
              type="button"
              onClick={() => {
                setCleanAllConfirmOpen(false);
                setCleanAllConfirmText('');
              }}
            >
              Cancel
            </button>
          </section>
        ) : null}

        {selectedCopyCount > 0 ? (
          <section className="selection-panel">
            <strong>{selectedCopyCount} copy items</strong>
            <span>{formatBytes(selectedCopyBytes + selectedCopyFolderBytes)}</span>
            <span>Press Copy Selected to copy checked items.</span>
          </section>
        ) : null}

        {selectedDeleteCount > 0 ? (
          <section className="selection-panel">
            <strong>{selectedDeleteCount} delete items</strong>
            <span>{formatBytes(selectedDeleteBytes + selectedDeleteFolderBytes)}</span>
            <span>Press Delete Selected to clean checked items.</span>
          </section>
        ) : null}

        <section className="counts">
          <span>+ {missingFiles.length} missing</span>
          <span>- {backupOnlyFiles.length} extra</span>
          <span>-/+ {conflictFiles.length} different</span>
        </section>
      </aside>

      <section className="workspace">
        {actionMessage || operation ? (
          <section className={`action-status ${operation ? `action-status-${operation.operation.state}` : ''}`}>
            <div>
              <strong>
                {operation ? `${operationVerb(operation)} ${operation.operation.state}` : 'Action'}
              </strong>
              <span>{actionMessage}</span>
            </div>
            {operation ? (
              <>
                <span>
                  {operation.totals.completedItems}/{operation.totals.totalItems} items
                </span>
                <span>
                  {formatBytes(operation.totals.bytesDone)} / {formatBytes(operation.totals.bytesTotal)}
                </span>
                <span>{operationPercent}%</span>
              </>
            ) : null}
          </section>
        ) : null}

        {scanProgress || isBusy ? (
          <div className="status-line">
            <Loader2 className="spin" size={15} aria-hidden="true" />
            <span>{scanProgress?.message ?? 'Working...'}</span>
          </div>
        ) : null}

        {error ? <div className="error-line">{error}</div> : null}

        <section className="panes">
          {renderPane('origin', originEntries, originPath, originCurrentPath, backupEntries)}
          {renderPane('backup', backupEntries, backupPath, backupCurrentPath, originEntries)}
        </section>

        {operation ? (
          <section className="operation-line">
            <strong>{operation.operation.type === 'copy' ? 'Copy' : 'Delete'}: {operation.operation.state}</strong>
            <span>
              {operation.totals.completedItems}/{operation.totals.totalItems} files
            </span>
            <span>{formatBytes(operation.totals.bytesDone)} / {formatBytes(operation.totals.bytesTotal)}</span>
          </section>
        ) : null}
      </section>

      {itemContextMenu ? (
        <div
          className="context-menu"
          style={{ left: itemContextMenu.x, top: itemContextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="context-menu-title">
            <strong>{itemContextMenu.entry.name}</strong>
            <span>
              {itemContextMenu.side === 'origin' ? 'Origin' : 'Backup'} {itemContextMenu.entry.kind}
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              window.safetwin.showItemInFolder(itemContextMenu.entry.absolutePath);
              setItemContextMenu(null);
            }}
          >
            Show in folder
          </button>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(itemContextMenu.entry.absolutePath);
              setItemContextMenu(null);
            }}
          >
            Copy path
          </button>
          <button
            type="button"
            className="context-danger"
            onClick={() => {
              const menu = itemContextMenu;
              setItemContextMenu(null);
              void deleteContextItem(menu);
            }}
          >
            Move to Recycle Bin
          </button>
        </div>
      ) : null}
    </main>
  );
};

export default App;
