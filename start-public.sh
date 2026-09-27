#!/usr/bin/env bash
# 一键公开运行：构建前端 + 启动单进程服务 + 内网穿透，生成公网地址发给朋友
set -e
cd "$(dirname "$0")"

echo "==> [1/3] 构建前端..."
npm run build

echo "==> [2/3] 启动服务 (前端+后端 同端口 ${PORT:-3001})..."
node --experimental-sqlite server/index.js &
SRV=$!
sleep 2

echo "==> [3/3] 启动内网穿透，生成公网地址..."
if command -v cpolar >/dev/null 2>&1; then
  echo "    使用 cpolar(国内稳)..."
  cpolar http "${PORT:-3001}"
elif command -v cloudflared >/dev/null 2>&1; then
  echo "    使用 cloudflared(免注册)..."
  cloudflared tunnel --url "http://localhost:${PORT:-3001}"
else
  echo "    未检测到穿透工具，请先安装其一："
  echo "      · cpolar(推荐,国内稳): https://cpolar.com  （注册后运行 cpolar authtoken <token>）"
  echo "      · cloudflared:        https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
  echo "    安装后重新运行本脚本，或手动执行："
  echo "      cpolar http ${PORT:-3001}"
  echo "    然后把输出的公网地址发给朋友即可访问。"
fi

# 穿透结束/退出时关闭本地服务
kill $SRV 2>/dev/null || true
