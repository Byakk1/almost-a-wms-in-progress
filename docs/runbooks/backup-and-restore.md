# Backup & restore — Cherry WMS database

**Status (2026-11-02):** first backups taken; restore rehearsal passed; schedule pending.

## What is protected

The deployment DB (`DATABASE_URL` in `wms-backend/.env`) is a **self-hosted Supabase
Postgres 15** with **no managed PITR**. It holds the only copy of:

- the imported commercial rate cards (`RateCard` 10 · `RateCardItem` 8,211 · `ShippingZone` 15,584)
- customer master data + fulfillment orders + inventory + audit logs (32 tables, ~25k rows, 80 MB)

A `pg_dump` is currently the **only** recovery path. There is no second copy of the
rate-card data outside the DB except the original workbooks (kept outside the repo).

## Where backups live

`E:\wms-backups\wms-YYYYMMDD-HHMMSS.dump` + `.sha256` sidecar. Custom format, gzip-6,
~4.7 MB each. Retention 30 days (script prunes).

> ⚠ Same machine as the app. Until E6 (deploy) lands, copy the newest dump off-box after
> each run (cloud drive / USB / another host). A backup on the same disk as the thing
> it protects survives a bad `DELETE`, not a dead disk.

## Taking a backup

```bash
cd "E:/Antigravity folder/cherry logistics platform/wms-backend"
bash scripts/backup-db.sh                 # → OK /e/wms-backups/wms-<stamp>.dump (<bytes>)
```

The script fails loudly if the dump lacks `RateCardItem` / `ShippingZone` / `OutboundOrder`
/ `User`. Verify any dump later with `sha256sum -c <file>.sha256`.

Tools: PostgreSQL 17 client tools at `D:\Postgres\bin` (installed 2026-10-30 via winget;
17.x client dumping a 15.x server is the supported direction).

## Restore rehearsal — proven 2026-10-30

| Step | Result |
|---|---|
| `pg_restore --list` | 935 TOC entries, 112 TABLE DATA incl. RateCardItem + ShippingZone |
| `pg_restore --schema=public --jobs=4` into scratch PG17 | exit 0, **0 errors** |
| per-table row counts, live vs restored (32 tables) | **identical**, 24,739 rows each |
| content spot-check: Σ RateCardItem.unitPrice, distinct zone cards, bcrypt prefix, max orderNo | **identical** |

Only `--schema=public` is restored; `_analytics`, `auth`, `storage`, etc. are Supabase
internals and not ours.

## Restoring for real

1. **Stop the API** so nothing writes mid-restore.
2. Create an empty target DB (or a scratch one to inspect first — recommended).
3. `pg_restore -h <host> -U <user> -d <db> --schema=public --no-owner --no-privileges --jobs=4 <dump>`
4. Compare counts against the table in this doc / the last known state. Prisma-side:
   `npx prisma generate` is NOT needed (schema unchanged); do NOT run `migrate`/`db push`.
5. Rotate `JWT_SECRET` if the incident involved a compromised host.

### Partial restore (one table)

```bash
pg_restore --list dump > toc.txt            # find the entry, e.g. "TABLE DATA public RateCardItem"
pg_restore -L toc-subset.txt -d <db> dump   # restore only listed entries
```

## Scheduling

Wrapper: `wms-backend/scripts/backup-db.cmd` (logs to `E:\wms-backups\backup.log`).

Registering the daily task needs an **elevated** prompt (non-elevated registration fails
with "拒绝访问 / Access denied"). From an Administrator PowerShell:

```powershell
$a = New-ScheduledTaskAction -Execute 'E:\Antigravity folder\cherry logistics platform\wms-backend\scripts\backup-db.cmd'
$t = New-ScheduledTaskTrigger -Daily -At 3:00AM
Register-ScheduledTask -TaskName 'CherryWMS-DB-Backup' -Action $a -Trigger $t -Force
Start-ScheduledTask -TaskName 'CherryWMS-DB-Backup'      # run once now; then check backup.log
```

Until that's registered, run `bash scripts/backup-db.sh` by hand before any DDL or import.
Off-box copy target: decide with D2 in the Phase 4 plan.

## Housekeeping note

The winget installer set up a **full PostgreSQL 17 server** (service `postgresql-x64-17`,
`D:\Postgres`) rather than client tools only. It is contained — password-only auth,
loopback-only `pg_hba`, no firewall allow rule — but it is unneeded. Stop + disable from an
**elevated** prompt (the service runs as a different account; non-elevated attempts fail):

```powershell
Stop-Service postgresql-x64-17 -Force; Set-Service postgresql-x64-17 -StartupType Disabled
```

Keep `D:\Postgres\bin` — that's `pg_dump`/`pg_restore`.
