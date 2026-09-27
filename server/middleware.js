// 路由守卫中间件
import db from './db.js'
import { verifyToken, resolveSession } from './auth.js'

function safeCount(table) {
  try {
    return db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n
  } catch {
    return -1
  }
}

export function readToken(req) {
  // 自定义头优先：托管平台可能改写标准 Authorization 头，导致服务端收到被替换的凭证
  const custom = req.headers['x-session-token']
  if (custom) return String(custom)
  const header = req.headers.authorization || ''
  return header.startsWith('Bearer ') ? header.slice(7) : null
}

export function requireAuth(req, res, next) {
  const token = readToken(req)
  if (!token) return res.status(401).json({ error: '未登录' })

  // 1) 数据库会话优先：与 JWT 密钥无关，多实例/多版本部署下同样有效
  //    此处直接用本文件的 db 连接查询，避免跨模块拿到不同连接
  let sessUser = null
  let sessErr = ''
  try {
    const s = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token)
    if (s) {
      if (new Date(s.expires_at).getTime() < Date.now()) {
        db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
      } else {
        sessUser = db.prepare('SELECT id, username, full_name, role FROM users WHERE id = ?').get(s.user_id) || null
      }
    }
    if (!sessUser) sessUser = resolveSession(token)
  } catch (e) {
    sessErr = e?.message || String(e)
  }
  if (sessUser) {
    req.user = sessUser
    return next()
  }

  // 2) 兼容历史 JWT（会话表不可用或旧客户端持有 JWT）
  try {
    const payload = verifyToken(token)
    const user = db
      .prepare('SELECT id, username, full_name, role FROM users WHERE id = ?')
      .get(payload.id)
    if (!user) return res.status(401).json({ error: '用户不存在' })
    req.user = user
    return next()
  } catch (e) {
    const expired = e && e.name === 'TokenExpiredError'
    res.status(401).json({
      error: expired ? '登录已过期，请重新登录' : '登录已失效，请重新登录',
      detail: e?.message || '',
      diag: { sessErr, sessions: safeCount('sessions'), tokenLen: (token || '').length },
    })
  }
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: '需要管理员权限' })
  next()
}
