import fs from 'node:fs/promises';
import path from 'node:path';

const pad = (value: number): string => value.toString().padStart(2, '0');

export const formatCopyTimestamp = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}-${pad(
    date.getMinutes(),
  )}`;

export const createConflictDuplicatePath = (backupPath: string, date = new Date()): string => {
  const parsed = path.parse(backupPath);
  return path.join(parsed.dir, `${parsed.name} (origin copy ${formatCopyTimestamp(date)})${parsed.ext}`);
};

const exists = async (filePath: string): Promise<boolean> => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

export const createAvailableConflictDuplicatePath = async (
  backupPath: string,
  date = new Date(),
): Promise<string> => {
  const firstChoice = createConflictDuplicatePath(backupPath, date);

  if (!(await exists(firstChoice))) {
    return firstChoice;
  }

  const parsed = path.parse(firstChoice);
  let suffix = 2;
  let candidate = path.join(parsed.dir, `${parsed.name} ${suffix}${parsed.ext}`);

  while (await exists(candidate)) {
    suffix += 1;
    candidate = path.join(parsed.dir, `${parsed.name} ${suffix}${parsed.ext}`);
  }

  return candidate;
};

export const getTempCopyPath = (destinationPath: string): string => `${destinationPath}.__safetwin_tmp__`;
