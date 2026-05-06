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

Create `C:\SafeTwinTest\Origin` and `C:\SafeTwinTest\Backup`, put a few files in Origin, a few backup-only files in Backup, and one file with the same relative path but different content. Run Scan, try mirrored navigation, use filters, create a copy queue, and test cleanup with disposable files only.

## Fast Smoke Test Folder Setup

```powershell
npm.cmd run smoke:setup
```

This creates `C:\SafeTwinTest\Origin` and `C:\SafeTwinTest\Backup`.

Manual equivalent:

```powershell
$origin = "C:\SafeTwinTest\Origin"
$backup = "C:\SafeTwinTest\Backup"
Remove-Item "C:\SafeTwinTest" -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $origin, $backup, "$origin\Photos", "$backup\Photos" | Out-Null
"only origin" | Set-Content "$origin\Photos\cat.jpg"
"only backup" | Set-Content "$backup\orphan.txt"
"same" | Set-Content "$origin\same.txt"
"same" | Set-Content "$backup\same.txt"
"origin version" | Set-Content "$origin\Photos\conflict.txt"
"backup version" | Set-Content "$backup\Photos\conflict.txt"
"temp" | Set-Content (Join-Path $origin '~$report.docx')
"partial" | Set-Content (Join-Path $origin 'video.mp4.part')
```

Expected after Scan:

- `Photos/cat.jpg` shows green `+`
- `orphan.txt` shows red `-`
- `same.txt` shows green check
- `Photos/conflict.txt` shows yellow warning
- `~$report.docx` and `video.mp4.part` show as ignored

Use these smoke-test folders only for first copy and cleanup tests.
