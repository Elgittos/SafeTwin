import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  FolderOpen,
  HardDrive,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import type { FileCompareItem, FolderPair, SaveFolderPairInput, ScanResult } from '../shared/types';

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

const App = () => {
  const [pairs, setPairs] = useState<FolderPair[]>([]);
  const [activePairId, setActivePairId] = useState<number | null>(null);
  const [originPath, setOriginPath] = useState('');
  const [backupPath, setBackupPath] = useState('');
  const [pairName, setPairName] = useState('');
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activePair = useMemo(
    () => pairs.find((pair) => pair.id === activePairId) ?? null,
    [activePairId, pairs],
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
    }
  };

  useEffect(() => {
    loadPairs().catch((loadError: unknown) => {
      setError(loadError instanceof Error ? loadError.message : 'Could not load folder pairs.');
    });
  }, []);

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
    setError(null);

    try {
      const status = await window.safetwin.getLastStatus(pair.id);
      setScanResult(status.lastScan);
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : 'Could not load last scan.');
    }
  };

  const topFiles = scanResult?.files.slice(0, 500) ?? [];

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <ShieldCheck aria-hidden="true" size={28} />
          <div>
            <h1>SafeTwin</h1>
            <p>Read-only folder comparison</p>
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
              <button type="button" title="Choose origin folder" onClick={() => chooseFolder('origin')}>
                <FolderOpen size={18} aria-hidden="true" />
              </button>
            </div>
            <p>{originPath || 'No origin folder selected'}</p>
          </div>

          <div className="folder-panel">
            <div className="folder-panel-header">
              <span>Backup</span>
              <button type="button" title="Choose backup folder" onClick={() => chooseFolder('backup')}>
                <FolderOpen size={18} aria-hidden="true" />
              </button>
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

        <section className="results-shell">
          <div className="results-header">
            <h2>{activePair ? activePair.name : 'Comparison results'}</h2>
            <span>{scanResult ? `${scanResult.files.length} files scanned` : 'No scan yet'}</span>
          </div>

          <div className="table">
            <div className="table-row table-heading">
              <span>State</span>
              <span>Path</span>
              <span>Size</span>
              <span>Reason</span>
            </div>

            {topFiles.map((file) => (
              <div
                className="table-row"
                key={`${file.state}-${file.displayPath}-${file.originPath ?? file.backupPath ?? ''}`}
              >
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
