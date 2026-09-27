#!/usr/bin/env bash
# 服务器一键更新：拉最新代码 → 装依赖 → 构建 → 重启服务
# 用法（在服务器上）： bash deploy/update.sh
# 前提：项目已 git clone 到 /opt/hs-match，且 match.service 已 enable
set -e
cd "$(dirname "$0")/.."          # 切到项目根目录
git pull
npm install
npm run build
sudo systemctl restart match
echo "✅ 更新完成，服务已重启（日志：sudo journalctl -u match -n 20）"
