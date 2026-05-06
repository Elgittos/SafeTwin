const protectedWindowsDirectoryNames = new Set([
  '$recycle.bin',
  'system volume information',
]);

export const isProtectedWindowsDirectoryName = (name: string): boolean =>
  process.platform === 'win32' && protectedWindowsDirectoryNames.has(name.toLowerCase());
