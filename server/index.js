// 后端入口：Express + SQLite，生产环境同时托管前端构建产物(dist)
import './env.js'
import express from 'express'
import cors from 'cors'
import fs from 'fs'
import path from 'path'
import authRoutes from './routes/auth.js'
import tournamentRoutes from './routes/tournaments.js'
import matchRoutes from './routes/matches.js'
import userRoutes from './routes/users.js'
import adminRoutes from './routes/admin.js'
import { requireAuth } from './middleware.js'
import db, { DB_PATH } from './db.js'
import { secretFingerprint } from './auth.js'
const dbPath = DB_PATH

const app = express()
app.use(cors())
app.use(express.json())

// 健康/诊断接口：实例指纹用于排查线上多实例密钥或数据库是否一致（不含任何明文密钥）
const BOOT_AT = new Date().toISOString()
// 临时排障端点：查看会话是否跨请求可见（不含任何密钥明文）
app.get('/api/diag', (req, res) => {
  const out = {
    pid: process.pid,
    bootAt: BOOT_AT,
    secret: secretFingerprint(),
    cwd: process.cwd(),
    dbPath: dbPath,
  }
  try {
    out.users = db.prepare('SELECT COUNT(*) AS n FROM users').get().n
  } catch (e) {
    out.usersErr = e.message
  }
  try {
    out.sessions = db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n
    out.lastSession = db.prepare('SELECT token FROM sessions ORDER BY rowid DESC LIMIT 1').get()?.token?.slice(0, 8) || null
  } catch (e) {
    out.sessionsErr = e.message
  }
  // 只回显长度，不回显内容：托管平台会用自身凭证覆盖 Authorization 头，回显有泄露风险
  out.authHeaderLen = (req.headers.authorization || '').length
  out.customTokenLen = (req.headers['x-session-token'] || '').length

  const q = String(req.query.token || req.headers['x-session-token'] || '').trim()
  if (q) {
    try {
      out.queryFound = !!db.prepare('SELECT 1 FROM sessions WHERE token = ?').get(q)
    } catch (e) {
      out.queryErr = e.message
    }
  }
  res.json(out)
})

app.get('/api/health', (req, res) => {
  let users = -1
  try {
    users = db.prepare('SELECT COUNT(*) AS n FROM users').get().n
  } catch {}
  res.json({ ok: true, pid: process.pid, bootAt: BOOT_AT, secret: secretFingerprint(), users })
})
app.use('/api/auth', authRoutes)
app.use('/api/tournaments', tournamentRoutes)
app.use('/api/matches', matchRoutes)
app.use('/api/users', userRoutes)
app.use('/api/admin', adminRoutes)
app.get('/api/me', requireAuth, (req, res) => res.json({ user: req.user }))

// 生产环境：若已构建前端(dist)，则同源托管前端 + 后端（单端口部署）
const distDir = path.join(process.cwd(), 'dist')
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir))
  // SPA history 回退：非 /api 的 GET 请求返回 index.html
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
      return res.sendFile(path.join(distDir, 'index.html'))
    }
    next()
  })
}

const PORT = process.env.PORT || 3001
// 显式绑定 0.0.0.0，便于发布平台反代到公网域名
app.listen(PORT, '0.0.0.0', () => {
  console.log(`服务已启动: http://0.0.0.0:${PORT}`)
})
