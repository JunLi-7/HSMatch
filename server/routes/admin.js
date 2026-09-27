// 管理员运维路由：全量数据导出 / 导入
// 用途：重新发布会用本地 data/match.db 覆盖线上数据库，发布前先 export 备份线上数据，
// 发布后再 import 写回，即可做到"改功能不丢线上正式数据"。
import express from 'express'
import db from '../db.js'
import { requireAuth, requireAdmin } from '../middleware.js'

const router = express.Router()

// 需要迁移的业务表（顺序：导入时先子表后主表；导出顺序无关）
const TABLES = ['users', 'tournaments', 'registrations', 'matches']

function columnsOf(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name)
}

// 导出全量业务数据（管理员）
router.get('/export', requireAuth, requireAdmin, (req, res) => {
  const data = { exportedAt: new Date().toISOString() }
  for (const t of TABLES) {
    try {
      data[t] = db.prepare(`SELECT * FROM ${t}`).all()
    } catch (e) {
      data[t] = []
      data[`${t}_err`] = e.message
    }
  }
  res.json(data)
})

// 导入业务数据（管理员）：用导入内容替换当前库中的同名表数据，保留原始 id
router.post('/import', requireAuth, requireAdmin, (req, res) => {
  const payload = req.body || {}
  if (!payload.users && !payload.tournaments) {
    return res.status(400).json({ error: '导入内容为空或格式不正确' })
  }

  const summary = {}
  const tx = db.transaction(() => {

    // 先清会话（user_id 外键），再按 子表→主表 顺序清空
    try {
      db.prepare('DELETE FROM sessions').run()
    } catch {}
    for (const t of ['matches', 'registrations', 'tournaments', 'users']) {
      try {
        db.prepare(`DELETE FROM ${t}`).run()
      } catch (e) {
        // 表不存在时跳过
      }
    }

    for (const t of ['users', 'tournaments', 'registrations', 'matches']) {
      const rows = Array.isArray(payload[t]) ? payload[t] : []
      if (!rows.length) {
        summary[t] = 0
        continue
      }
      const cols = columnsOf(t)
      const usable = cols.filter((c) => c !== 'rowid')
      let n = 0
      for (const r of rows) {
        // 只取目标表实际存在的列，避免版本差异导致 SQL 报错
        const keys = usable.filter((c) => Object.prototype.hasOwnProperty.call(r, c))
        if (!keys.length) continue
        const sql = `INSERT INTO ${t} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`
        // node:sqlite 不支持把数组整体作为绑定参数（会把下标当命名参数），需展开
        db.prepare(sql).run(...keys.map((k) => r[k]))
        n++
      }
      summary[t] = n
    }
    return summary
  })

  try {
    const imported = tx()
    res.json({ ok: true, imported })
  } catch (e) {
    // 返回具体错误，便于定位导入失败原因（如外键约束、列不匹配）
    res.status(500).json({ error: '导入失败', detail: e?.message || String(e) })
  }
})

export default router
