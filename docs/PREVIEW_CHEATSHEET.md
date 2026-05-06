# SafeTwin Preview Cheat Sheet

## First Time Setup

```powershell
npm.cmd install
```

## Start the Live Preview

```powershell
npm.cmd start
```

This opens the Electron app with Vite hot reload.

## Useful Verification Commands

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run lint
npm.cmd run package
```

## Packaged Preview

```powershell
npm.cmd run package
.\out\SafeTwin-win32-x64\SafeTwin.exe
```

## Suggested Manual Test

Create two test folders, put a few files in Origin, a few backup-only files in Backup, and one file with the same relative path but different content. Run Scan, try mirrored navigation, use filters, create a copy queue, and test cleanup with disposable files only.
