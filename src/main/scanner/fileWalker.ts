import fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import path from 'node:path';
import { getExtension, getRelativePath, normalizeComparisonKey, toDisplayPath } from '../../shared/pathKeys';
import type { FolderSide, LocalAvailability } from '../../shared/types';
import { IgnoreRuleService } from '../ignore/ignoreRules';
import { getLocalAvailability } from '../platform/windowsFileAvailability';

export type AvailabilityState = LocalAvailability | 'unstable';

export interface ScannedFile {
  id?: number;
  side: FolderSide;
  relativePath: string;
  displayPath: string;
  absolutePath: string;
  normalizedKey: string;
  kind: 'file';
  size: number;
  mtimeMs: number;
  extension: string;
  availabilityState: AvailabilityState;
  ignoreReason: string | null;
  hash: string | null;
  hashCalculatedAt: string | null;
}

export interface WalkResult {
  files: ScannedFile[];
  ignoredFiles: ScannedFile[];
  skippedFiles: ScannedFile[];
}

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

const isStable = async (filePath: string): Promise<boolean> => {
  const first = await fs.stat(filePath);
  await delay(75);
  const second = await fs.stat(filePath);

  return first.size === second.size && first.mtimeMs === second.mtimeMs;
};

const createFileRecord = async (
  rootPath: string,
  absolutePath: string,
  side: FolderSide,
  availabilityState: AvailabilityState,
  ignoreReason: string | null,
): Promise<ScannedFile> => {
  const relativePath = getRelativePath(rootPath, absolutePath);
  let size = 0;
  let mtimeMs = 0;

  try {
    const stats = await fs.stat(absolutePath);
    size = stats.size;
    mtimeMs = stats.mtimeMs;
  } catch {
    // Keep skipped entries visible even when metadata cannot be read.
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
    availabilityState,
    ignoreReason,
    hash: null,
    hashCalculatedAt: null,
  };
};

export const walkFiles = async (
  rootPath: string,
  side: FolderSide,
  ignoreRules: IgnoreRuleService,
): Promise<WalkResult> => {
  const files: ScannedFile[] = [];
  const ignoredFiles: ScannedFile[] = [];
  const skippedFiles: ScannedFile[] = [];

  const visit = async (directoryPath: string): Promise<void> => {
    let entries: Dirent[];

    try {
      entries = await fs.readdir(directoryPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const absolutePath = path.join(directoryPath, entry.name);

      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }

      if (!entry.isFile()) {
        skippedFiles.push(
          await createFileRecord(rootPath, absolutePath, side, 'specialSkipped', 'Special filesystem entry'),
        );
        continue;
      }

      const relativePath = getRelativePath(rootPath, absolutePath);
      const ignoreReason = ignoreRules.match(relativePath);

      if (ignoreReason) {
        ignoredFiles.push(await createFileRecord(rootPath, absolutePath, side, 'localReady', ignoreReason));
        continue;
      }

      const availability = await getLocalAvailability(absolutePath);

      if (availability !== 'localReady') {
        skippedFiles.push(await createFileRecord(rootPath, absolutePath, side, availability, null));
        continue;
      }

      let stable = false;

      try {
        stable = await isStable(absolutePath);
      } catch {
        skippedFiles.push(await createFileRecord(rootPath, absolutePath, side, 'unreadable', null));
        continue;
      }

      if (!stable) {
        skippedFiles.push(await createFileRecord(rootPath, absolutePath, side, 'unstable', null));
        continue;
      }

      const stats = await fs.stat(absolutePath);

      files.push({
        side,
        relativePath,
        displayPath: toDisplayPath(relativePath),
        absolutePath,
        normalizedKey: normalizeComparisonKey(relativePath),
        kind: 'file',
        size: stats.size,
        mtimeMs: stats.mtimeMs,
        extension: getExtension(relativePath),
        availabilityState: availability,
        ignoreReason: null,
        hash: null,
        hashCalculatedAt: null,
      });
    }
  };

  await visit(rootPath);

  return {
    files,
    ignoredFiles,
    skippedFiles,
  };
};
