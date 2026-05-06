# SafeTwin

SafeTwin is an autobacking app for now.

## Phase 1

Phase 1 is a read-only Windows desktop app that scans an origin folder and a backup folder, compares files by relative path, applies default ignore rules, skips unavailable files, and stores scan results in a local SQLite cache.

## Phase 2

Phase 2 adds safe file operations: copy queues for missing and conflict files, conflict duplicate naming, size/hash verification, cleanup queues that move backup-only items to the Recycle Bin, operation logs, and crash recovery for interrupted work.
