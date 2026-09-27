@echo off
REM 一键启动本地赛事系统：构建前端 + 启动服务 + 启动穿透
REM 放在项目根目录，双击即可（需先确保 cpolar 已绑定 authtoken：cpolar authtoken <你的token>）
cd /d %~dp0

echo ==^> 构建前端 (npm run build) ...
call npm run build

echo ==^> 启动服务 (node --experimental-sqlite server/index.js) ...
start "" node --experimental-sqlite server/index.js

echo ==^> 等待服务就绪 ...
timeout /t 2 >nul

echo ==^> 启动内网穿透 (cpolar http 3001) ...
echo     稍后复制下面输出的公网地址发给朋友即可。
cpolar http 3001
