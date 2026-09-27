// 清空开发库中的测试数据，仅保留管理员账号
import db from './server/db.js'

const r1 = db.prepare('DELETE FROM matches').run()
const r2 = db.prepare('DELETE FROM registrations').run()
const r3 = db.prepare('DELETE FROM tournaments').run()
const r4 = db.prepare("DELETE FROM users WHERE role = 'player'").run()
const users = db.prepare('SELECT COUNT(*) c FROM users').get().c
const admins = db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'admin'").get().c
console.log(
  `cleared: matches=${r1.changes} regs=${r2.changes} tours=${r3.changes} players=${r4.changes} | users left=${users} (admins=${admins})`
)
