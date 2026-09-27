// 用户管理路由（仅管理员）：列表/搜索、代建账号、重置密码、删除（有赛事记录则禁止）
import express from 'express'
import db from '../db.js'
import { hashPassword, USERNAME_RE, NAME_RE } from '../auth.js'
import { requireAuth, requireAdmin } from '../middleware.js'

const router = express.Router()

// 列表 + 搜索（按用户名/昵称模糊匹配），附带报名场数
router.get('/', requireAuth, requireAdmin, (req, res) => {
  const q = String(req.query.q || '').trim()
  const select = `SELECT u.id, u.username, u.full_name, u.role, u.created_at,
        COALESCE(r.c, 0) AS reg_count
      FROM users u
      LEFT JOIN (SELECT user_id, COUNT(*) AS c FROM registrations GROUP BY user_id) r ON r.user_id = u.id`
  let rows
  if (q) {
    rows = db
      .prepare(`${select} WHERE u.username LIKE ? OR u.full_name LIKE ? ORDER BY u.id DESC`)
      .all(`%${q}%`, `%${q}%`)
  } else {
    rows = db.prepare(`${select} ORDER BY u.id DESC`).all()
  }
  res.json({ users: rows })
})

// 管理员代建账号（选手或管理员）
router.post('/', requireAuth, requireAdmin, (req, res) => {
  const { username, password, fullName, role } = req.body || {}
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
  const r = role === 'admin' ? 'admin' : 'player'
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
    return res.status(409).json({ error: '该用户名已被注册' })
  }
  const safeName = trimmedName || username
  const info = db
    .prepare(
      'INSERT INTO users(username, password_hash, full_name, role, created_at) VALUES(?,?,?,?,?)'
    )
    .run(username, hashPassword(password), safeName, r, new Date().toISOString())
  res.json({ user: { id: Number(info.lastInsertRowid), username, full_name: safeName, role: r } })
})

// 重置密码（管理员代操作）
router.post('/:id/reset-password', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id)
  const { password } = req.body || {}
  if (!password || String(password).length < 6) {
    return res.status(400).json({ error: '新密码至少 6 位' })
  }
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(id)
  if (!user) return res.status(404).json({ error: '用户不存在' })
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), id)
  res.json({ ok: true })
})

// 删除账号：有报名/对阵记录则禁止，禁止删自己与最后一个管理员
router.delete('/:id', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id)
  if (id === req.user.id) {
    return res.status(400).json({ error: '不能删除当前登录的管理员账号' })
  }
  const user = db.prepare('SELECT id, role FROM users WHERE id = ?').get(id)
  if (!user) return res.status(404).json({ error: '用户不存在' })

  if (user.role === 'admin') {
    const adminCount = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role='admin'").get().c
    if (adminCount <= 1) {
      return res.status(400).json({ error: '不能删除最后一个管理员账号' })
    }
  }

  // 有赛事报名/对阵记录则禁止删除，避免数据断裂
  const regCount = db.prepare('SELECT COUNT(*) AS c FROM registrations WHERE user_id = ?').get(id).c
  if (regCount > 0) {
    return res
      .status(409)
      .json({
        error: `该账号已有 ${regCount} 条赛事报名/对阵记录，无法删除。请先处理其赛事记录后再删除。`,
      })
  }

  // 自己创建过赛事也不能删（tournaments.created_by 是外键，直接删会触发约束导致服务端 500）
  const createdCount = db
    .prepare('SELECT COUNT(*) AS c FROM tournaments WHERE created_by = ?')
    .get(id).c
  if (createdCount > 0) {
    return res
      .status(409)
      .json({
        error: `该账号创建过 ${createdCount} 场赛事，无法删除。请先在「赛事管理」删除这些赛事后再删除账号。`,
      })
  }

  db.prepare('DELETE FROM users WHERE id = ?').run(id)
  res.json({ ok: true })
})

export default router
