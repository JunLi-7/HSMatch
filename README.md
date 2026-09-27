# HSMatch · 炉石传说赛事对战系统

一个面向炉石传说赛事的**在线对战编排与裁判系统**：选手通过一个公开网址在浏览器里使用，免安装、移动端自适应。

## 功能特性

### 赛事与赛制
- **四种赛制**：单败淘汰、双败淘汰、小组循环（含出线淘汰）、瑞士轮
- **小组循环**：创建时指定分组数量 → 人数尽量平均分组 → 组内单循环 → 按积分出线（≤4 人组出 1 人，≥5 人组出 2 人）→ 出线者随机抽签进单败淘汰
- **可组合分段对阵制**：一套对阵制由若干「分段」组成，每段 5 个自由参数
  - BO（几局几胜）· 规则（征服 / KOF）· ban 数量（0 = 无 ban）· 携带卡组数 · 适用赛程范围（全程 / 小组赛 / 淘汰赛 / 八强起 / 四强起 / 决赛）
  - 一致性自动校验：`pick = 携带卡组数 − ban数`，`BO = 2 × pick − 1`（如带 4 套、禁 1 套 → 应对应 BO5）
  - 适用范围限定到后期时（如「四强起」），系统自动补一段「全程」覆盖前段赛程
- **战队赛**：固定 11 套卡组 / ban 3（保护 1 + 禁 1 + 再禁 2）/ BO11 / KOF，三阶段 BP

### 对阵流程（选手自主 + 管理员确认）
- **BP 由选手在自己的网页端完成**：两阶段 —— 双方各自提交卡组（齐后公布）→ 双方禁用对手卡组（齐后公布完整 BP）
- **赛后选手手动提交逐局赛果**，系统仅完整保存双方提交，不做自动判定
- **管理员审核确认**：核对一致 → 按规则自动判定并晋级；不一致 → 不自动判定，可驳回重交或指定胜方确认

### 平台
- 用户名 + 密码登录（选手自助注册；管理员由命令行创建，不开放注册入口）
- 对阵树 + 积分榜可视化，按角色控制赛果可见性
- 对已开赛赛事每 5 秒轮询刷新，多端展示保持一致
- **赛制调试分区**：与创建赛事同源的对阵制编辑器、空位自动生成虚拟选手、分段解析预览表

## 技术栈

| 层 | 选型 |
|---|---|
| 前端 | Vue 3 + Vite + Element Plus + Vue Router + Pinia |
| 后端 | Node + Express |
| 数据库 | Node 内置 `node:sqlite`（零原生编译），`data/match.db` |
| 鉴权 | 数据库会话优先，JWT 兜底（`jsonwebtoken` + `bcryptjs`） |
| 实时 | 轮询（5s） |

## 目录结构

```
src/                 前端
  lib/bracket.js     赛制对阵生成（单败/双败/小组循环/瑞士轮），前后端共用
  lib/matchFormats.js 对阵制数据模型、分段解析与一致性校验
  lib/series.js      系列赛胜负判定
  components/        对阵树、BP 与赛果提交 UI
  views/             赛事列表 / 详情 / 管理后台 / 赛制调试
server/              后端
  index.js           HTTP 服务（生产模式下同时托管 dist/ 前端）
  db.js              建表与迁移
  auth.js            密码哈希、会话、JWT
  routes/            赛事 / 对阵 / 认证 / 用户 / 管理接口
deploy/              自托管部署配置（systemd / nginx / 备份 / 一键更新）
```

## 本地开发

```bash
npm install

npm run seed        # 首次：创建管理员（按提示输入用户名与密码）
npm run server      # 后端 :3001
npm run dev         # 前端 :5173（代理 /api 到后端）
```

- 前端构建：`npm run build`
- 算法与流程测试：`npm run test`、`node test-format-e2e.mjs`、`node test-group-e2e.mjs` 等

> Node 22 启动后端需带 `--experimental-sqlite`（Node 23+ 可省略）。

## 生产部署（自托管）

前端构建产物由后端同进程托管，单端口即可对外服务：

```bash
npm install
npm run build
node --experimental-sqlite server/index.js      # 或使用 deploy/start.sh
```

`deploy/` 下提供：

| 文件 | 用途 |
|---|---|
| `start.sh` | 生产启动脚本 |
| `match.service` | systemd 单元（崩溃/重启自动拉起） |
| `nginx.conf` | Nginx 反向代理 + HTTPS 模板 |
| `backup-db.sh` | 每日备份数据库，保留 14 天 |
| `update.sh` | 一键更新：`git pull` → 构建 → 重启服务 |

## 配置

复制 `.env.example` 为 `.env` 按需填写：

| 变量 | 说明 |
|---|---|
| `PORT` | 服务端口，默认 `3001` |
| `JWT_SECRET` | JWT 签名密钥。**生产环境必须设置为强随机值**（`openssl rand -hex 32`） |
| `DB_PATH` | 数据库文件路径，默认 `data/match.db` |

> 登录态以数据库会话为主，`JWT_SECRET` 未设置也能运行；但生产环境务必显式设置。

## 数据与备份

- 数据库为单个 SQLite 文件 `data/match.db`（含 WAL），**重启与更新都不会覆盖**
- 备份：`bash deploy/backup-db.sh`，建议加入 crontab 每日执行
- 迁移：直接复制整个 `data/` 目录到新机器即可

## 许可

个人项目，未声明开源许可。
