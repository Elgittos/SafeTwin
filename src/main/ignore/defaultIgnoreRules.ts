export interface DefaultIgnoreRule {
  category: string;
  pattern: string;
  reason: string;
}

export const defaultIgnoreRules: DefaultIgnoreRule[] = [
  { category: 'Temporary files', pattern: '*.tmp', reason: 'Temporary file' },
  { category: 'Temporary files', pattern: '*.temp', reason: 'Temporary file' },
  { category: 'Office lock files', pattern: '~$*', reason: 'Office lock file' },
  { category: 'Partial downloads', pattern: '*.crdownload', reason: 'Partial download' },
  { category: 'Partial downloads', pattern: '*.part', reason: 'Partial download' },
  { category: 'Partial downloads', pattern: '*.partial', reason: 'Partial download' },
  { category: 'Partial downloads', pattern: '*.download', reason: 'Partial download' },
  { category: 'Windows metadata files', pattern: 'Thumbs.db', reason: 'Windows metadata file' },
  { category: 'Windows metadata files', pattern: 'ehthumbs.db', reason: 'Windows metadata file' },
  { category: 'Windows metadata files', pattern: 'desktop.ini', reason: 'Windows metadata file' },
  { category: 'Windows metadata files', pattern: '.DS_Store', reason: 'macOS metadata file' },
  { category: 'SafeTwin recovery', pattern: '.safetwin-trash', reason: 'SafeTwin local trash folder' },
  { category: 'SafeTwin recovery', pattern: '**/.safetwin-trash/**', reason: 'SafeTwin local trash folder' },
  { category: 'Editor swap files', pattern: '*.swp', reason: 'Editor swap file' },
  { category: 'Editor swap files', pattern: '*.swo', reason: 'Editor swap file' },
  { category: 'LibreOffice lock files', pattern: '.~lock.*#', reason: 'LibreOffice lock file' },
];
