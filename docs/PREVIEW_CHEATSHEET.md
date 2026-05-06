# SafeTwin Preview Commands Cheat Sheet

Run these from the project folder:

```powershell
cd C:\Users\LuisDev\Desktop\SafeTwin
```

## Fastest Preview

Use this while building and testing UI changes:

```powershell
npm.cmd start
```

This opens SafeTwin in Electron with Vite live reload.

## First Time Setup

Run this once after cloning the project or after dependencies change:

```powershell
npm.cmd install
```

## Create Test Folders

Use disposable folders before testing real backups:

```powershell
npm.cmd run smoke:setup
```

This creates:

```text
C:\SafeTwinTest\Origin
C:\SafeTwinTest\Backup
```

In SafeTwin, select:

```text
Origin: C:\SafeTwinTest\Origin
Backup: C:\SafeTwinTest\Backup
```

Expected scan results:

- `Photos/cat.jpg` shows green `+`
- `orphan.txt` shows red `-`
- `same.txt` shows green check
- `Photos/conflict.txt` shows yellow warning
- `~$report.docx` and `video.mp4.part` show as ignored

## Packaged Preview

Build the local packaged app:

```powershell
npm.cmd run package
```

Run the packaged app:

```powershell
.\out\SafeTwin-win32-x64\SafeTwin.exe
```

If PowerShell does not launch it, use:

```powershell
Start-Process .\out\SafeTwin-win32-x64\SafeTwin.exe
```

## Build Installer

Create the one-click Windows installer:

```powershell
npm.cmd run make
```

Installer output:

```text
out\make\squirrel.windows\x64\SafeTwinSetup.exe
```

## Quick Quality Checks

Run these before committing bigger changes:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run lint
```

## Full Preview Build Check

Use this when you want to verify everything end to end:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run lint
npm.cmd run package
npm.cmd run make
```

## Relaunch Cleanly

If SafeTwin is already open and you want to restart the packaged preview:

```powershell
Get-Process SafeTwin -ErrorAction SilentlyContinue | Stop-Process
Start-Process .\out\SafeTwin-win32-x64\SafeTwin.exe
```

## Real Folder Test

After the smoke folders work, use your real pair:

1. Open SafeTwin.
2. Add or select your Origin folder.
3. Add or select your Backup folder.
4. Click Scan.
5. Watch the scan progress banner.
6. Review missing, backup-only, conflict, ignored, and skipped files.
7. Copy or clean only after the preview scan looks right.
