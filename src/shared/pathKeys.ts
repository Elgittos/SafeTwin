import path from 'node:path';

export const normalizeComparisonKey = (relativePath: string): string =>
  relativePath.replaceAll('\\', '/').toLowerCase();

export const toDisplayPath = (relativePath: string): string =>
  relativePath.replaceAll('\\', '/');

export const getRelativePath = (rootPath: string, absolutePath: string): string =>
  path.relative(rootPath, absolutePath);

export const getExtension = (filePath: string): string =>
  path.extname(filePath).toLowerCase();
