// 手动创建管理员账号（不开放注册）：node server/seedAdmin.js <用户名> <密码> <姓名>
import db from './db.js'
import { hashPassword } from './auth.js'

const username = process.argv[2] || 'admin'
const password = process.argv[3] || 'admin123456'
const name = process.argv[4] || '系统管理员'

if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
  console.log('管理员已存在，跳过：', username)
  process.exit(0)
}
db.prepare(
  'INSERT INTO users(username, password_hash, full_name, role, created_at) VALUES(?,?,?,?,?)'
).run(username, hashPassword(password), name, 'admin', new Date().toISOString())
console.log(`已创建管理员 -> 用户名: ${username}  密码: ${password}`)
