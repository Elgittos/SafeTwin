import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Database,
  FolderOpen,
  HardDrive,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Square,
  Trash2,
} from 'lucide-react';
import type {
  CleanupPreview,
  FileCompareItem,
  FolderCompareItem,
  FolderPair,
  OperationSnapshot,
  SaveFolderPairInput,
  ScanResult,
  VerificationLevel,
} from '../shared/types';

type ActionMode = 'copy' | 'cleanup';

const formatBytes = (bytes: number): string => {
  if (bytes === 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
};

const stateLabels: Record<FileCompareItem['state'], string> = {
  identical: 'Identical',
  missingInBackup: 'Missing in backup',
  backupOnly: 'Backup-only',
  conflictSamePathDifferentContent: 'Conflict',
  ignored: 'Ignored',
  notLocalPlaceholder: 'Cloud placeholder',
  lockedOrUnreadable: 'Locked or unreadable',
  unstableChangingFile: 'Changing',
};

const stateClassNames: Record<FileCompareItem['state'], string> = {
  identical: 'state state-identical',
  missingInBackup: 'state state-missing',
  backupOnly: 'state state-backup-only',
  conflictSamePathDifferentContent: 'state state-conflict',
  ignored: 'state state-muted',
  notLocalPlaceholder: 'state state-muted',
  lockedOrUnreadable: 'state state-muted',
  unstableChangingFile: 'state state-conflict',
};

const getDefaultPairName = (originPath: string, backupPath: string): string => {
  const origin = originPath.split(/[\\/]/).filter(Boolean).at(-1) ?? 'Origin';
  const backup = backupPath.split(/[\\/]/).filter(Boolean).at(-1) ?? 'Backup';
  return `${origin} to ${backup}`;
};

const isCopyCandidate = (file: FileCompareItem): boolean =>
  file.state === 'missingInBackup' || file.state === 'conflictSamePathDifferentContent';

const isCleanupCandidate = (file: FileCompareItem): boolean => file.state === 'backupOnly';

const isSelectable = (mode: ActionMode, file: FileCompareItem): boolean =>
  mode === 'copy' ? isCopyCandidate(file) : isCleanupCandidate(file);

const selectedSize = (files: FileCompareItem[], selectedPaths: string[]): number => {
  const selected = new Set(selectedPaths);
  return files.filter((file) => selected.has(file.relativePath)).reduce((total, file) => total + file.sizeBytes, 0);
};

const App = () => {
  const [pairs, setPairs] = useState<FolderPair[]>([]);
  const [activePairId, setActivePairId] = useState<number | null>(null);
  const [originPath, setOriginPath] = useState('');
  const [backupPath, setBackupPath] = useState('');
  const [pairName, setPairName] = useState('');
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [operation, setOperation] = useState<OperationSnapshot | null>(null);
  const [cleanupPreview, setCleanupPreview] = useState<CleanupPreview | null>(null);
  const [mode, setMode] = useState<ActionMode>('copy');
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [selectedFolderPaths, setSelectedFolderPaths] = useState<string[]>([]);
  const [verificationLevel, setVerificationLevel] = useState<VerificationLevel>('auto');
  const [isScanning, setIsScanning] = useState(false);
  const [isPreparingOperation, setIsPreparingOperation] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activePair = useMemo(
    () => pairs.find((pair) => pair.id === activePairId) ?? null,
    [activePairId, pairs],
  );
  const actionableFiles = useMemo(
    () => (scanResult?.files ?? []).filter((file) => isSelectable(mode, file)),
    [mode, scanResult],
  );
  const cleanupFolders = useMemo(
    () =>
      (scanResult?.folders ?? []).filter(
        (folder): folder is FolderCompareItem => folder.relativePath !== '' && folder.counts.backupOnly > 0,
      ),
    [scanResult],
  );
  const selectedActionSize = useMemo(
    () => selectedSize(scanResult?.files ?? [], selectedPaths),
    [scanResult, selectedPaths],
  );

  const loadPairs = async () => {
    const nextPairs = await window.safetwin.listFolderPairs();
    setPairs(nextPairs);

    if (!activePairId && nextPairs.length > 0) {
      const firstPair = nextPairs[0];
      setActivePairId(firstPair.id);
      setOriginPath(firstPair.originPath);
      setBackupPath(firstPair.backupPath);
      setPairName(firstPair.name);

      const status = await window.safetwin.getLastStatus(firstPair.id);
      setScanResult(status.lastScan);
      const operations = await window.safetwin.listOperations(firstPair.id);
      setOperation(operations[0] ?? null);
    }
  };

  useEffect(() => {
    loadPairs().catch((loadError: unknown) => {
      setError(loadError instanceof Error ? loadError.message : 'Could not load folder pairs.');
    });
  }, []);

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
            setCleanupPreview(null);
          }
        })
        .catch((pollError: unknown) => {
          setError(pollError instanceof Error ? pollError.message : 'Could not refresh operation.');
        });
    }, 700);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [activePairId, operation]);

  const chooseFolder = async (side: 'origin' | 'backup') => {
    const result = await window.safetwin.chooseFolder();

    if (result.canceled || !result.path) {
      return;
    }

    if (side === 'origin') {
      setOriginPath(result.path);
      if (!pairName && backupPath) {
        setPairName(getDefaultPairName(result.path, backupPath));
      }
    } else {
      setBackupPath(result.path);
      if (!pairName && originPath) {
        setPairName(getDefaultPairName(originPath, result.path));
      }
    }
  };

  const savePair = async (): Promise<FolderPair> => {
    if (!originPath || !backupPath) {
      throw new Error('Choose both an origin folder and a backup folder.');
    }

    const input: SaveFolderPairInput = {
      id: activePairId ?? undefined,
      name: pairName || getDefaultPairName(originPath, backupPath),
      originPath,
      backupPath,
    };
    const savedPair = await window.safetwin.saveFolderPair(input);
    const nextPairs = await window.safetwin.listFolderPairs();
    setPairs(nextPairs);
    setActivePairId(savedPair.id);
    setPairName(savedPair.name);

    return savedPair;
  };

  const scan = async () => {
    setIsScanning(true);
    setError(null);

    try {
      const savedPair = await savePair();
      const result = await window.safetwin.scanPair(savedPair.id);
      setScanResult(result);
      setSelectedPaths([]);
      setSelectedFolderPaths([]);
      setCleanupPreview(null);
      await loadPairs();
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : 'Scan failed.');
    } finally {
      setIsScanning(false);
    }
  };

  const selectPair = async (pair: FolderPair) => {
    setActivePairId(pair.id);
    setOriginPath(pair.originPath);
    setBackupPath(pair.backupPath);
    setPairName(pair.name);
    setSelectedPaths([]);
    setSelectedFolderPaths([]);
    setCleanupPreview(null);
    setError(null);

    try {
      const status = await window.safetwin.getLastStatus(pair.id);
      setScanResult(status.lastScan);
      const operations = await window.safetwin.listOperations(pair.id);
      setOperation(operations[0] ?? null);
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : 'Could not load last scan.');
    }
  };

  const togglePath = (file: FileCompareItem) => {
    if (!isSelectable(mode, file)) {
      return;
    }

    setSelectedPaths((current) =>
      current.includes(file.relativePath)
        ? current.filter((relativePath) => relativePath !== file.relativePath)
        : [...current, file.relativePath],
    );
  };

  const toggleFolder = (folder: FolderCompareItem) => {
    setSelectedFolderPaths((current) =>
      current.includes(folder.relativePath)
        ? current.filter((relativePath) => relativePath !== folder.relativePath)
        : [...current, folder.relativePath],
    );
  };

  const selectEligible = () => {
    setSelectedPaths(actionableFiles.map((file) => file.relativePath));
  };

  const clearSelection = () => {
    setSelectedPaths([]);
    setSelectedFolderPaths([]);
    setCleanupPreview(null);
  };

  const createCopyQueue = async () => {
    if (!activePairId) {
      return;
    }

    setIsPreparingOperation(true);
    setError(null);

    try {
      const nextOperation = await window.safetwin.createCopyOperation({
        folderPairId: activePairId,
        selectedRelativePaths: selectedPaths,
        verificationLevel,
      });
      setOperation(nextOperation);
    } catch (operationError) {
      setError(operationError instanceof Error ? operationError.message : 'Could not create copy queue.');
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
      const preview = await window.safetwin.createCleanupPreview({
        folderPairId: activePairId,
        selectedRelativePaths: selectedPaths,
        selectedFolderPaths,
      });
      setCleanupPreview(preview);
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : 'Could not create cleanup preview.');
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
        selectedRelativePaths: selectedPaths,
        selectedFolderPaths,
      });
      setOperation(nextOperation);
    } catch (operationError) {
      setError(operationError instanceof Error ? operationError.message : 'Could not create cleanup queue.');
    } finally {
      setIsPreparingOperation(false);
    }
  };

  const runOperationCommand = async (command: 'start' | 'pause' | 'resume' | 'cancel' | 'retry') => {
    if (!operation) {
      return;
    }

    try {
      const nextOperation =
        command === 'start'
          ? await window.safetwin.startOperation(operation.operation.id)
          : command === 'pause'
            ? await window.safetwin.pauseOperation(operation.operation.id)
            : command === 'resume'
              ? await window.safetwin.resumeOperation(operation.operation.id)
              : command === 'cancel'
                ? await window.safetwin.cancelOperation(operation.operation.id)
                : await window.safetwin.retryFailedOperation(operation.operation.id);
      setOperation(nextOperation);
    } catch (commandError) {
      setError(commandError instanceof Error ? commandError.message : 'Operation command failed.');
    }
  };

  const topFiles = scanResult?.files.slice(0, 700) ?? [];

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <ShieldCheck aria-hidden="true" size={28} />
          <div>
            <h1>SafeTwin</h1>
            <p>Safe backup actions</p>
          </div>
        </div>

        <button
          className="new-pair-button"
          type="button"
          onClick={() => {
            setActivePairId(null);
            setOriginPath('');
            setBackupPath('');
            setPairName('');
            setScanResult(null);
            setOperation(null);
            clearSelection();
          }}
        >
          <Plus size={16} aria-hidden="true" />
          New pair
        </button>

        <div className="pair-list">
          {pairs.map((pair) => (
            <button
              className={pair.id === activePairId ? 'pair-item pair-item-active' : 'pair-item'}
              key={pair.id}
              type="button"
              onClick={() => selectPair(pair)}
            >
              <HardDrive size={16} aria-hidden="true" />
              <span>{pair.name}</span>
            </button>
          ))}
        </div>
      </aside>

      <section className="workspace">
        <header className="toolbar">
          <div>
            <label htmlFor="pair-name">Pair name</label>
            <input
              id="pair-name"
              value={pairName}
              onChange={(event) => setPairName(event.target.value)}
              placeholder="Photos to backup drive"
            />
          </div>

          <button className="scan-button" type="button" onClick={scan} disabled={isScanning}>
            {isScanning ? (
              <Loader2 className="spin" size={18} aria-hidden="true" />
            ) : (
              <RefreshCw size={18} aria-hidden="true" />
            )}
            Scan
          </button>
        </header>

        <section className="folder-grid">
          <div className="folder-panel">
            <div className="folder-panel-header">
              <span>Origin</span>
              <div className="folder-actions">
                <button type="button" title="Open origin folder" disabled={!originPath} onClick={() => window.safetwin.openFolder(originPath)}>
                  <FolderOpen size={18} aria-hidden="true" />
                </button>
                <button type="button" title="Choose origin folder" onClick={() => chooseFolder('origin')}>
                  <Plus size={18} aria-hidden="true" />
                </button>
              </div>
            </div>
            <p>{originPath || 'No origin folder selected'}</p>
          </div>

          <div className="folder-panel">
            <div className="folder-panel-header">
              <span>Backup</span>
              <div className="folder-actions">
                <button type="button" title="Open backup folder" disabled={!backupPath} onClick={() => window.safetwin.openFolder(backupPath)}>
                  <FolderOpen size={18} aria-hidden="true" />
                </button>
                <button type="button" title="Choose backup folder" onClick={() => chooseFolder('backup')}>
                  <Plus size={18} aria-hidden="true" />
                </button>
              </div>
            </div>
            <p>{backupPath || 'No backup folder selected'}</p>
          </div>
        </section>

        {error ? (
          <div className="error-banner">
            <AlertTriangle size={18} aria-hidden="true" />
            {error}
          </div>
        ) : null}

        <section className="summary-grid">
          <div className="summary-item">
            <CheckCircle2 size={18} aria-hidden="true" />
            <span>Identical</span>
            <strong>{scanResult?.summary.identical ?? 0}</strong>
          </div>
          <div className="summary-item">
            <Plus size={18} aria-hidden="true" />
            <span>Missing</span>
            <strong>{scanResult?.summary.missingInBackup ?? 0}</strong>
            <small>{formatBytes(scanResult?.summary.totalMissingSize ?? 0)}</small>
          </div>
          <div className="summary-item">
            <Trash2 size={18} aria-hidden="true" />
            <span>Backup-only</span>
            <strong>{scanResult?.summary.backupOnly ?? 0}</strong>
            <small>{formatBytes(scanResult?.summary.totalBackupOnlySize ?? 0)}</small>
          </div>
          <div className="summary-item">
            <AlertTriangle size={18} aria-hidden="true" />
            <span>Conflicts</span>
            <strong>{scanResult?.summary.conflicts ?? 0}</strong>
          </div>
          <div className="summary-item">
            <Database size={18} aria-hidden="true" />
            <span>Skipped</span>
            <strong>
              {(scanResult?.summary.ignored ?? 0) +
                (scanResult?.summary.notLocalPlaceholder ?? 0) +
                (scanResult?.summary.lockedOrUnreadable ?? 0) +
                (scanResult?.summary.unstableChangingFile ?? 0)}
            </strong>
          </div>
        </section>

        <section className="operations-panel">
          <div className="mode-tabs" aria-label="Operation mode">
            <button className={mode === 'copy' ? 'mode-tab mode-tab-active' : 'mode-tab'} type="button" onClick={() => {
              setMode('copy');
              clearSelection();
            }}>
              <Copy size={16} aria-hidden="true" />
              Copy
            </button>
            <button className={mode === 'cleanup' ? 'mode-tab mode-tab-active' : 'mode-tab'} type="button" onClick={() => {
              setMode('cleanup');
              clearSelection();
            }}>
              <Trash2 size={16} aria-hidden="true" />
              Cleanup
            </button>
          </div>

          <div className="operation-controls">
            <div className="selection-summary">
              <strong>{selectedPaths.length + selectedFolderPaths.length}</strong>
              <span>{formatBytes(cleanupPreview?.totalSize ?? selectedActionSize)} selected</span>
            </div>

            {mode === 'copy' ? (
              <select
                aria-label="Verification level"
                value={verificationLevel}
                onChange={(event) => setVerificationLevel(event.target.value as VerificationLevel)}
              >
                <option value="auto">Auto verify</option>
                <option value="basic">Size verify</option>
                <option value="strong">Hash verify</option>
              </select>
            ) : null}

            <button className="secondary-button" type="button" onClick={selectEligible} disabled={!scanResult}>
              Select all
            </button>
            <button className="secondary-button" type="button" onClick={clearSelection}>
              Clear
            </button>
            {mode === 'copy' ? (
              <button
                className="primary-button"
                type="button"
                disabled={selectedPaths.length === 0 || isPreparingOperation}
                onClick={createCopyQueue}
              >
                <Copy size={16} aria-hidden="true" />
                Create copy queue
              </button>
            ) : (
              <>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={(selectedPaths.length === 0 && selectedFolderPaths.length === 0) || isPreparingOperation}
                  onClick={previewCleanup}
                >
                  Preview cleanup
                </button>
                <button
                  className="danger-button"
                  type="button"
                  disabled={!cleanupPreview || cleanupPreview.filesSelected === 0 || isPreparingOperation}
                  onClick={createCleanupQueue}
                >
                  <Trash2 size={16} aria-hidden="true" />
                  Create cleanup queue
                </button>
              </>
            )}
          </div>

          {mode === 'cleanup' && cleanupFolders.length > 0 ? (
            <div className="folder-cleanup-list">
              {cleanupFolders.slice(0, 12).map((folder) => (
                <label className="folder-cleanup-item" key={folder.relativePath}>
                  <input
                    type="checkbox"
                    checked={selectedFolderPaths.includes(folder.relativePath)}
                    onChange={() => toggleFolder(folder)}
                  />
                  <span>{folder.displayPath}</span>
                  <small>{folder.counts.backupOnly} files</small>
                </label>
              ))}
            </div>
          ) : null}

          {cleanupPreview ? (
            <div className="cleanup-preview">
              <strong>Cleanup preview</strong>
              <span>{cleanupPreview.filesSelected} files</span>
              <span>{cleanupPreview.foldersSelected} folders</span>
              <span>{formatBytes(cleanupPreview.totalSize)}</span>
              <span>Move selected backup-only items to Recycle Bin</span>
            </div>
          ) : null}

          {operation ? (
            <div className="queue-panel">
              <div className="queue-header">
                <div>
                  <h2>{operation.operation.type === 'copy' ? 'Copy queue' : 'Cleanup queue'}</h2>
                  <span>{operation.operation.state}</span>
                </div>
                <div className="queue-actions">
                  <button type="button" title="Start" onClick={() => runOperationCommand('start')} disabled={!['pending', 'failed'].includes(operation.operation.state)}>
                    <Play size={16} aria-hidden="true" />
                  </button>
                  <button type="button" title="Pause" onClick={() => runOperationCommand('pause')} disabled={operation.operation.state !== 'running'}>
                    <Pause size={16} aria-hidden="true" />
                  </button>
                  <button type="button" title="Resume" onClick={() => runOperationCommand('resume')} disabled={operation.operation.state !== 'paused'}>
                    <Play size={16} aria-hidden="true" />
                  </button>
                  <button type="button" title="Cancel" onClick={() => runOperationCommand('cancel')} disabled={!['pending', 'running', 'paused'].includes(operation.operation.state)}>
                    <Square size={16} aria-hidden="true" />
                  </button>
                  <button type="button" title="Retry failed" onClick={() => runOperationCommand('retry')} disabled={operation.totals.failedItems === 0 && operation.totals.cancelledItems === 0}>
                    <RotateCcw size={16} aria-hidden="true" />
                  </button>
                </div>
              </div>

              <div className="queue-meter">
                <div>
                  <strong>
                    {operation.totals.completedItems}/{operation.totals.totalItems}
                  </strong>
                  <span>{formatBytes(operation.totals.bytesDone)} copied</span>
                </div>
                <div>
                  <strong>{formatBytes(operation.totals.currentSpeedBytesPerSecond)}/s</strong>
                  <span>{formatBytes(operation.totals.bytesTotal)} total</span>
                </div>
              </div>

              <div className="queue-items">
                {operation.items.slice(0, 8).map((item) => (
                  <div className="queue-item" key={item.id}>
                    <span className={`queue-state queue-state-${item.state}`}>{item.state}</span>
                    <span className="path-cell">{item.relativePath}</span>
                    <span>{formatBytes(item.bytesDone)} / {formatBytes(item.bytesTotal)}</span>
                    <span>{item.verificationState}</span>
                    <button
                      type="button"
                      title="Open item folder"
                      disabled={!item.destinationPath && !item.sourcePath}
                      onClick={() => window.safetwin.showItemInFolder(item.destinationPath ?? item.sourcePath ?? '')}
                    >
                      <FolderOpen size={15} aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </section>

        <section className="results-shell">
          <div className="results-header">
            <h2>{activePair ? activePair.name : 'Comparison results'}</h2>
            <span>{scanResult ? `${scanResult.files.length} files scanned` : 'No scan yet'}</span>
          </div>

          <div className="table">
            <div className="table-row table-heading">
              <span>Use</span>
              <span>State</span>
              <span>Path</span>
              <span>Size</span>
              <span>Reason</span>
            </div>

            {topFiles.map((file) => (
              <div
                className={isSelectable(mode, file) ? 'table-row table-row-selectable' : 'table-row'}
                key={`${file.state}-${file.displayPath}-${file.originPath ?? file.backupPath ?? ''}`}
                onDoubleClick={() => togglePath(file)}
              >
                <span>
                  <input
                    type="checkbox"
                    checked={selectedPaths.includes(file.relativePath)}
                    disabled={!isSelectable(mode, file)}
                    onChange={() => togglePath(file)}
                    aria-label={`Select ${file.displayPath}`}
                  />
                </span>
                <span className={stateClassNames[file.state]}>{stateLabels[file.state]}</span>
                <span className="path-cell">{file.displayPath}</span>
                <span>{formatBytes(file.sizeBytes)}</span>
                <span>{file.reason}</span>
              </div>
            ))}

            {topFiles.length === 0 ? <div className="empty-state">Choose two folders and run a scan.</div> : null}
          </div>
        </section>
      </section>
    </main>
  );
};

export default App;
