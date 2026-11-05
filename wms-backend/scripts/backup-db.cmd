@echo off
rem Cherry WMS — scheduled wrapper for scripts/backup-db.sh (see docs/runbooks/backup-and-restore.md)
"C:\Program Files\Git\usr\bin\bash.exe" -l "E:\Antigravity folder\cherry logistics platform\wms-backend\scripts\backup-db.sh" >> "E:\wms-backups\backup.log" 2>&1
