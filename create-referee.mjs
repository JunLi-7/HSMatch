// 一次性脚本：创建裁判管理员账号（用户名「裁判」，密码 123456，角色 admin）
// 直接操作数据库，绕过注册接口 3-30 位用户名校验（「裁判」仅 2 字）；
// 登录接口不重新校验用户名格式，故 2 字用户名可正常登录。
// 数据库已开启 WAL，可与运行中的服务并发写（已设 busy_timeout）。
import db from './server/db.js'
import { hashPassword } from './server/auth.js'

db.pragma('busy_timeout = 5000')

const username = '裁判'
const password = '123456'
const role = 'admin'

const existing = db.prepare('SELECT id, role FROM users WHERE username = ?').get(username)
if (existing) {
  console.log(`账号「${username}」已存在（角色=${existing.role}），无需重复创建。`)
  process.exit(0)
}

db.prepare(
  'INSERT INTO users(username, password_hash, full_name, role, created_at) VALUES(?,?,?,?,?)'
).run(username, hashPassword(password), username, role, new Date().toISOString())

console.log(`已创建管理员账号：用户名=${username}  密码=${password}  角色=${role}`)
console.log('该账号与你的管理员账号拥有同等权限，可用于共同管理赛事（建赛、审核赛果、删除赛事等）。')
