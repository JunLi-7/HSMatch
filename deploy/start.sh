#!/usr/bin/env bash
# 生产启动脚本：单进程同时托管前端(dist) + 后端 API
# systemd / pm2 都调用这个脚本即可。
set -e
cd "$(dirname "$0")/.."          # 切到项目根目录（保证 data/match.db 路径稳定）
export PORT="${PORT:-3001}"
export NODE_ENV="production"
# 用 Node 22 LTS：必须带 --experimental-sqlite（Node 23+ 已稳定，可去掉该参数）
exec node --experimental-sqlite server/index.js
