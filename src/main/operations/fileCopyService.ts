import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import type { OperationAction, VerificationLevel, VerificationState } from '../../shared/types';
import { getLocalAvailability } from '../platform/windowsFileAvailability';
import { hashFileSha256 } from '../scanner/hashService';
import { getTempCopyPath } from './destinationPlanner';

export class OperationCancelledError extends Error {
  constructor() {
    super('Operation cancelled.');
  }
}

export interface CopyProgress {
  bytesDone: number;
  currentSpeedBytesPerSecond: number;
}

export interface CopyOptions {
  action: OperationAction;
  sourcePath: string;
  destinationPath: string;
  verificationLevel: VerificationLevel;
  onProgress: (progress: CopyProgress) => void;
  waitIfPaused: () => Promise<void>;
  isCancelled: () => boolean;
}

const largeFileThreshold = 100 * 1024 * 1024;
const videoExtensions = new Set(['.mp4', '.mov', '.avi', '.mkv', '.wmv', '.m4v', '.webm']);

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

const ensureDoesNotExist = async (filePath: string): Promise<void> => {
  try {
    await fsp.access(filePath);
  } catch {
    return;
  }

  throw new Error(`Destination already exists: ${filePath}`);
};

const isStable = async (filePath: string): Promise<boolean> => {
  const first = await fsp.stat(filePath);
  await delay(75);
  const second = await fsp.stat(filePath);

  return first.size === second.size && first.mtimeMs === second.mtimeMs;
};

const shouldHashVerify = (
  action: OperationAction,
  sourcePath: string,
  size: number,
  verificationLevel: VerificationLevel,
): boolean => {
  if (verificationLevel === 'strong') {
    return true;
  }

  if (verificationLevel === 'basic') {
    return false;
  }

  return action === 'copyConflictDuplicate' || size >= largeFileThreshold || videoExtensions.has(path.extname(sourcePath));
};

export class FileCopyService {
  async copySafely(options: CopyOptions): Promise<VerificationState> {
    const sourceAvailability = await getLocalAvailability(options.sourcePath);

    if (sourceAvailability !== 'localReady') {
      throw new Error(`Source is not ready for copying: ${sourceAvailability}`);
    }

    if (!(await isStable(options.sourcePath))) {
      throw new Error('Source file changed during final recheck.');
    }

    const sourceStats = await fsp.stat(options.sourcePath);

    if (!sourceStats.isFile()) {
      throw new Error('Source is not a file.');
    }

    await ensureDoesNotExist(options.destinationPath);
    await fsp.mkdir(path.dirname(options.destinationPath), { recursive: true });

    const tempPath = getTempCopyPath(options.destinationPath);
    await fsp.rm(tempPath, { force: true });

    let bytesDone = 0;
    let lastBytes = 0;
    let lastTick = Date.now();

    const readStream = fs.createReadStream(options.sourcePath);
    const writeStream = fs.createWriteStream(tempPath, { flags: 'wx' });

    try {
      for await (const chunk of readStream) {
        if (options.isCancelled()) {
          throw new OperationCancelledError();
        }

        await options.waitIfPaused();

        if (options.isCancelled()) {
          throw new OperationCancelledError();
        }

        if (!writeStream.write(chunk)) {
          await once(writeStream, 'drain');
        }

        bytesDone += chunk.length;
        const now = Date.now();

        if (now - lastTick >= 250 || bytesDone === sourceStats.size) {
          const elapsedSeconds = Math.max((now - lastTick) / 1000, 0.001);
          const currentSpeedBytesPerSecond = Math.round((bytesDone - lastBytes) / elapsedSeconds);
          options.onProgress({ bytesDone, currentSpeedBytesPerSecond });
          lastBytes = bytesDone;
          lastTick = now;
        }
      }

      await new Promise<void>((resolve, reject) => {
        writeStream.end((error?: Error | null) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });

      const tempStats = await fsp.stat(tempPath);

      if (tempStats.size !== sourceStats.size) {
        throw new Error(`Copied size mismatch. Expected ${sourceStats.size}, got ${tempStats.size}.`);
      }

      let verificationState: VerificationState = 'sizeVerified';

      if (shouldHashVerify(options.action, options.sourcePath, sourceStats.size, options.verificationLevel)) {
        const [sourceHash, tempHash] = await Promise.all([hashFileSha256(options.sourcePath), hashFileSha256(tempPath)]);

        if (sourceHash !== tempHash) {
          throw new Error('Copied hash does not match source hash.');
        }

        verificationState = 'hashVerified';
      }

      await ensureDoesNotExist(options.destinationPath);
      await fsp.rename(tempPath, options.destinationPath);
      await fsp.utimes(options.destinationPath, sourceStats.atime, sourceStats.mtime);
      options.onProgress({ bytesDone: sourceStats.size, currentSpeedBytesPerSecond: 0 });

      return verificationState;
    } catch (error) {
      readStream.destroy();
      writeStream.destroy();
      await fsp.rm(tempPath, { force: true });
      throw error;
    }
  }
}
