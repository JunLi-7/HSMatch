// 登录密码校验测试：单元测试（校验函数）+ 集成测试（HTTP 登录接口）
// 运行：node test-auth.mjs
import { DatabaseSync } from 'node:sqlite'
import { hashPassword, verifyPassword, isBcryptHash } from './server/auth.js'

const BASE = 'http://localhost:3001/api'
const db = new DatabaseSync('./data/match.db')

let pass = 0
let fail = 0
function check(name, actual, expected) {
  const ok = actual === expected
  if (ok) {
    pass++
    console.log('  PASS ', name)
  } else {
    fail++
    console.log('  FAIL ', name, '| 期望:', expected, '| 实际:', actual)
  }
}

console.log('=== 一、密码校验函数（单元） ===')
const hash = hashPassword('admin123456')
check('bcrypt 哈希格式正确', isBcryptHash(hash), true)
check('bcrypt: 正确明文可登录', verifyPassword('admin123456', hash), true)
check('bcrypt: 错误明文拒绝', verifyPassword('wrongpwd', hash), false)
check('bcrypt: 大小写敏感', verifyPassword('ADMIN123456', hash), false)

// 关键：库里存的是明文密码（历史遗留 / 手动插入），必须能登录
check('明文库值: 正确明文可登录', verifyPassword('mypassword123', 'mypassword123'), true)
check('明文库值: 错误明文拒绝', verifyPassword('otherpass', 'mypassword123'), false)
check('明文库值: 空密码拒绝', verifyPassword('', 'mypassword123'), false)

// 边界：不得抛异常（原实现会 throw -> 接口 500）
check('password=undefined 返回 false 不抛异常', verifyPassword(undefined, hash), false)
check('password=null 返回 false', verifyPassword(null, hash), false)
check('password 为数字可正常校验', verifyPassword(123456, hashPassword('123456')), true)
check('hash=undefined 返回 false', verifyPassword('admin123456', undefined), false)
check('hash=空串 返回 false', verifyPassword('admin123456', ''), false)
check('hash 为损坏值返回 false 不抛异常', verifyPassword('x', '$2b$10$broken'), false)

console.log('\n=== 二、HTTP 登录接口（集成） ===')
async function post(path, body) {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}

try {
  // 1. 管理员明文密码登录
  let r = await post('/auth/login', { username: 'admin', password: 'admin123456' })
  check('admin 明文密码登录 -> 200', r.status, 200)
  check('  返回 token', typeof r.data.token === 'string' && r.data.token.length > 20, true)
  check('  返回 admin 角色', r.data.user && r.data.user.role, 'admin')

  // 2. 错误密码
  r = await post('/auth/login', { username: 'admin', password: 'wrongpassword' })
  check('错误密码 -> 401', r.status, 401)

  // 3. 用户名不存在
  r = await post('/auth/login', { username: 'nosuchuser_xyz', password: 'admin123456' })
  check('用户不存在 -> 401', r.status, 401)

  // 4. 缺失密码不得导致 500（原实现会抛异常）
  r = await post('/auth/login', { username: 'admin' })
  check('缺少 password -> 400 而非 500', r.status, 400)

  // 5. 用户名为 undefined 不得 500
  r = await post('/auth/login', { password: 'admin123456' })
  check('缺少 username -> 400 而非 500', r.status, 400)

  // 6. 用户名带空格可容错登录
  r = await post('/auth/login', { username: '  admin  ', password: 'admin123456' })
  check('用户名首尾空格容错 -> 200', r.status, 200)

  // 7. 库中明文密码账号：能登录，且自动升级为 bcrypt 哈希
  const testUser = 'plaintext_usr'
  db.prepare('DELETE FROM users WHERE username = ?').run(testUser)
  db.prepare(
    'INSERT INTO users(username, password_hash, full_name, role, created_at) VALUES(?,?,?,?,?)'
  ).run(testUser, 'plain123456', '明文遗留测试', 'player', new Date().toISOString())

  r = await post('/auth/login', { username: testUser, password: 'plain123456' })
  check('明文遗留账号登录 -> 200', r.status, 200)

  const after = db.prepare('SELECT password_hash FROM users WHERE username = ?').get(testUser)
  check('  登录后自动升级为 bcrypt 哈希', isBcryptHash(after.password_hash), true)
  check('  升级后原密码仍可登录', verifyPassword('plain123456', after.password_hash), true)

  r = await post('/auth/login', { username: testUser, password: 'plain123456' })
  check('  升级后再次登录 -> 200', r.status, 200)

  db.prepare('DELETE FROM users WHERE username = ?').run(testUser)
  console.log('  （已清理测试账号）')
} catch (e) {
  fail++
  console.log('  FAIL  集成测试异常（后端服务是否已启动？）:', e.message)
}

console.log(`\n=== 结果：通过 ${pass} / 失败 ${fail} ===`)
process.exit(fail === 0 ? 0 : 1)
