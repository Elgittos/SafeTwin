# SafeTwin

SafeTwin is a personal Windows desktop app for comparing an origin folder with a backup folder, then copying missing items or cleaning backup-only differences.

The app is intentionally direct: origin is the source of truth, backup is the destination, and the UI shows only the differences that matter for copying or cleaning.

## Current Scope

- Compare two folders by relative path.
- Show missing origin files/folders with a green `+`.
- Show backup-only files/folders with a red `-`.
- Show identical folders with a subtle green check.
- Show changed same-path files/folders with an amber `!`.
- Copy all missing items or copy selected items.
- Clean backup-only differences with confirmation.
- Delete selected backup-only items.
- Move manual right-click deletes to the Windows Recycle Bin, with a local `.safetwin-trash` fallback if Windows refuses the delete.
- Stop active copy/delete operations.
- Use cached scan results for normal browsing and run a full disk scan only when requested.
- Toggle linked folder navigation on or off.
- Persist theme, folder pair settings, cached scan data, and operation state locally.

## Requirements

- Windows 11 for the target personal-use app.
- Node.js and npm for development/building.
- Git for source control.

## Development

Install dependencies:

```powershell
npm.cmd install
```

Start the live preview:

```powershell
npm.cmd start
```

Run checks:

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
```

## Build and Install Locally

Create a Windows installer:

```powershell
npm.cmd run make
```

The personal-use installer is created under:

```text
out/make/squirrel.windows/x64/SafeTwinSetup.exe
```

Run `SafeTwinSetup.exe` to install SafeTwin like a normal Windows app.

This is for personal use only right now. Public distribution should wait until code signing, release notes, and installer update strategy are decided.

## Navigation

SafeTwin has two folder navigation modes:

- **Linked navigation on:** both panes move together by relative folder path.
- **Linked navigation off:** origin and backup panes can be browsed independently.

The setting is stored with the active folder pair.

## Safety Model

SafeTwin should never silently modify files without clear action feedback.

- Copy actions first verify the current diff.
- Clean/delete actions target backup-only items.
- Clean Differences requires typed confirmation.
- Manual right-click delete asks for confirmation.
- Delete operations use the Recycle Bin when possible.
- If the Recycle Bin fails, items are moved into `.safetwin-trash` inside the selected root.
- `.safetwin-trash` is ignored by scans so recovery files do not become app differences.

## Industry Standards Checklist

Use this checklist before treating SafeTwin as production-quality software.

- [x] TypeScript typecheck passes.
- [x] Lint passes.
- [x] Automated tests pass.
- [x] App has explicit copy/delete progress feedback.
- [x] App can stop active operations.
- [x] App handles missing folders/files during navigation and scanning.
- [x] App avoids raw technical errors for normal file operation failures.
- [x] App supports light and dark mode.
- [x] App hides the default Electron menu bar.
- [x] App has Windows installer metadata and icon configured.
- [ ] Installer is tested on a clean Windows 11 user account.
- [ ] Installer is tested with external drives.
- [ ] Installer is tested with cloud-backed folders such as OneDrive or NordLocker.
- [ ] Very long paths are tested.
- [ ] Danish/special characters in paths are tested.
- [ ] Locked and in-use files are tested.
- [ ] Interrupted copy/delete recovery is tested after app restart.
- [ ] App data location is documented.
- [ ] Release notes are written for each tagged release.
- [ ] Code signing is added before public distribution.

## Repository Notes

SafeTwin is built with Electron, React, Vite, TypeScript, and Electron Forge.

The main app code lives in:

- `src/main.ts`
- `src/main/ipc.ts`
- `src/renderer/App.tsx`
- `src/index.css`
- `src/shared/types.ts`

