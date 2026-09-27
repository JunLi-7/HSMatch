#!/usr/bin/env bash
# SQLite 在线备份：复制 db 文件 + WAL/SHM（小流量应用足够）
# 用法：bash deploy/backup-db.sh    建议加到 crontab 每天跑一次
#   crontab -e 加一行： 0 4 * * *  /opt/hs-match/deploy/backup-db.sh >> /opt/hs-match/backups/cron.log 2>&1
set -e
cd "$(dirname "$0")/.."
mkdir -p backups
TS=$(date +%Y%m%d-%H%M%S)
DST="backups/match-$TS"
mkdir -p "$DST"
cp data/match.db     "$DST/" 2>/dev/null || true
cp data/match.db-wal "$DST/" 2>/dev/null || true
cp data/match.db-shm "$DST/" 2>/dev/null || true
# 只保留最近 14 天
find backups -maxdepth 1 -name 'match-*' -mtime +14 -exec rm -rf {} +
echo "$(date) 已备份到 $DST"
