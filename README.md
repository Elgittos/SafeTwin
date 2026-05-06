# SafeTwin

SafeTwin is an autobacking app for now.

## Phase 1

Phase 1 is a read-only Windows desktop app that scans an origin folder and a backup folder, compares files by relative path, applies default ignore rules, skips unavailable files, and stores scan results in a local SQLite cache.

## Phase 2

Phase 2 adds safe file operations: copy queues for missing and conflict files, conflict duplicate naming, size/hash verification, cleanup queues that move backup-only items to the Recycle Bin, operation logs, and crash recovery for interrupted work.

## Phase 3

Phase 3 adds the Windows Explorer-style UI: two-pane Origin and Backup navigation, mirrored folder browsing, compact state indicators, selection mode, filters, search, ignore-rule settings, reminder settings, last backup status, and a bottom operation drawer.

See [SafeTwin Preview Cheat Sheet](docs/PREVIEW_CHEATSHEET.md) for local preview commands.
