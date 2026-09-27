// 认证路由：选手注册 / 通用登录（用户名 + 密码）
import express from 'express'
import db from '../db.js'
import { hashPassword, verifyPassword, isBcryptHash, signToken, createSession, USERNAME_RE, NAME_RE } from '../auth.js'

const router = express.Router()

// 签发登录凭证：优先数据库会话（跨实例可靠），会话不可用时降级 JWT
function issueToken(user) {
  return createSession(user.id) || signToken(user)
}

// 选手自助注册（角色固定为 player），用户名唯一
router.post('/register', (req, res) => {
  const { username, password, fullName } = req.body || {}
  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码均必填' })
  }
  if (!USERNAME_RE.test(username)) {
    return res.status(400).json({ error: '用户名需 3-30 位，含字母、数字、中文，以及 # 和 丨' })
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: '密码至少 6 位' })
  }
  const trimmedName = fullName && String(fullName).trim() ? String(fullName).trim() : ''
  if (trimmedName && !NAME_RE.test(trimmedName)) {
    return res.status(400).json({ error: '昵称仅可含字母、数字、中文，以及 # 和 丨（最长 30 位）' })
  }
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
    return res.status(409).json({ error: '该用户名已被注册' })
  }
  const safeName = trimmedName || username
  const info = db
    .prepare(
      'INSERT INTO users(username, password_hash, full_name, role, created_at) VALUES(?,?,?,?,?)'
    )
    .run(username, hashPassword(password), safeName, 'player', new Date().toISOString())
  const user = { id: Number(info.lastInsertRowid), username, full_name: safeName, role: 'player' }
  res.json({ token: issueToken(user), user })
})

// 登录（选手与管理员通用），用户名 + 密码
router.post('/login', (req, res) => {
  const rawName = req.body && req.body.username != null ? String(req.body.username) : ''
  const username = rawName.trim()
  // 密码保持原样，不做 trim：首尾空格可能是密码的一部分
  const password = req.body ? req.body.password : undefined
  if (!username || password === undefined || password === null || String(password) === '') {
    return res.status(400).json({ error: '请输入用户名和密码' })
  }
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username)
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: '用户名或密码错误' })
  }
  // 透明升级：库中若存的是历史明文密码，登录成功后自动刷成 bcrypt 哈希
  if (!isBcryptHash(user.password_hash)) {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(
      hashPassword(password),
      user.id
    )
  }
  const safe = { id: user.id, username: user.username, full_name: user.full_name, role: user.role }
  res.json({ token: issueToken(safe), user: safe })
})

export default router
