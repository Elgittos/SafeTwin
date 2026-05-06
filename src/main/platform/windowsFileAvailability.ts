import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import { promisify } from 'node:util';
import type { LocalAvailability } from '../../shared/types';

const execFileAsync = promisify(execFile);
const cloudAttributeFlags = new Set(['O', 'U']);
const cloudPathHints = ['onedrive', 'dropbox', 'google drive', 'iclouddrive'];

export interface AvailabilityOptions {
  checkCloudAttributes?: boolean;
}

const isLikelyCloudPath = (filePath: string): boolean => {
  const normalizedPath = filePath.toLowerCase();
  const envRoots = [
    process.env.OneDrive,
    process.env.OneDriveConsumer,
    process.env.OneDriveCommercial,
    process.env.DROPBOX,
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase());

  return (
    envRoots.some((root) => normalizedPath.startsWith(root)) ||
    cloudPathHints.some((hint) => normalizedPath.includes(`\\${hint}\\`) || normalizedPath.includes(`/${hint}/`))
  );
};

const getAttribFlags = async (filePath: string): Promise<Set<string>> => {
  if (process.platform !== 'win32') {
    return new Set();
  }

  const { stdout } = await execFileAsync('attrib.exe', [filePath], {
    windowsHide: true,
    timeout: 5000,
  });
  const attributeText = stdout.split(filePath)[0] ?? '';
  return new Set(attributeText.replaceAll(' ', '').split(''));
};

export const getLocalAvailability = async (
  filePath: string,
  options: AvailabilityOptions = {},
): Promise<LocalAvailability> => {
  try {
    const stats = await fs.lstat(filePath);

    if (!stats.isFile() || stats.isSymbolicLink()) {
      return 'specialSkipped';
    }

    if (process.platform === 'win32' && options.checkCloudAttributes !== false && isLikelyCloudPath(filePath)) {
      const flags = await getAttribFlags(filePath);

      for (const flag of cloudAttributeFlags) {
        if (flags.has(flag)) {
          return 'cloudPlaceholder';
        }
      }
    }

    await fs.access(filePath, fs.constants.R_OK);
    return 'localReady';
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;

    if (code === 'EBUSY' || code === 'EPERM') {
      return 'locked';
    }

    return 'unreadable';
  }
};
