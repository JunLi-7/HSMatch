// 清理本地库中的测试残留：测试账号、其创建的赛事及关联数据（管理员账号一律保留）
import db from './server/db.js'

const PREFIX_RE = /^(probe|share|diag|delp|delp2|tmp|test|t_|user_?\d|swiss|rr_|dd_)/i

const targets = db
  .prepare("SELECT id, username FROM users WHERE role='player'")
  .all()
  .filter((u) => PREFIX_RE.test(u.username))

console.log(`命中测试账号 ${targets.length} 个`)

const tx = db.transaction(() => {
  let tournaments = 0
  let registrations = 0
  for (const u of targets) {
    const ts = db.prepare('SELECT id FROM tournaments WHERE created_by = ?').all(u.id)
    for (const t of ts) {
      db.prepare('DELETE FROM matches WHERE tournament_id = ?').run(t.id)
      db.prepare('DELETE FROM registrations WHERE tournament_id = ?').run(t.id)
      db.prepare('DELETE FROM tournaments WHERE id = ?').run(t.id)
      tournaments++
    }
    registrations += db.prepare('DELETE FROM registrations WHERE user_id = ?').run(u.id).changes
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id)
    db.prepare('DELETE FROM users WHERE id = ?').run(u.id)
  }
  return { tournaments, registrations }
})

const r = tx()
console.log(`已清理：账号 ${targets.length} 个、其创建的赛事 ${r.tournaments} 场、报名记录 ${r.registrations} 条`)

const left = db.prepare('SELECT username, role FROM users ORDER BY id').all()
console.log(`剩余账号 ${left.length} 个：`)
console.log('  ' + left.map((u) => `${u.username}(${u.role})`).join(', '))
const ts = db.prepare('SELECT COUNT(*) AS n FROM tournaments').get().n
console.log(`剩余赛事 ${ts} 场`)
