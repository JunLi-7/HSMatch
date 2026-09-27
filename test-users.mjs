// 验证用户管理接口：列表/搜索/代建/重置密码/删除保护
import db from './server/db.js'
import { hashPassword } from './server/auth.js'

const BASE = 'http://localhost:3001'
const uname = 'test_admin_' + Date.now()
const pw = 'TempTest123'

// 建临时管理员（用于拿 token）
db.prepare(
  'INSERT INTO users(username, password_hash, full_name, role, created_at) VALUES(?,?,?,?,?)'
).run(uname, hashPassword(pw), 'T', 'admin', new Date().toISOString())
const adminId = db.prepare('SELECT id FROM users WHERE username=?').get(uname).id

const log = (label, status, extra = '') =>
  console.log(`${status === 200 || status === 201 ? '✓' : '✗'} ${label} -> ${status} ${extra}`)

async function main() {
  const login = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: uname, password: pw }),
  })
  const token = (await login.json()).token
  const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }

  // 1. 列表
  let r = await fetch(BASE + '/api/users', { headers: H })
  const listAll = (await r.json()).users
  log('GET /api/users 列表', r.status, `共 ${listAll.length} 人`)

  // 2. 代建选手
  r = await fetch(BASE + '/api/users', {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ username: 'playertest1', password: 'abc123', fullName: 'P1', role: 'player' }),
  })
  const player = (await r.json()).user
  log('POST /api/users 代建选手', r.status, player ? `id=${player.id}` : '')

  // 3. 搜索
  r = await fetch(BASE + '/api/users?q=playertest', { headers: H })
  const found = (await r.json()).users
  log('GET /api/users?q= 搜索', r.status, `命中 ${found.map((u) => u.username).join(',')}`)

  // 4. 重置密码
  r = await fetch(BASE + `/api/users/${player.id}/reset-password`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ password: 'newpass1' }),
  })
  log('POST /api/users/:id/reset-password', r.status)

  // 5. 删自己（应 400）
  r = await fetch(BASE + `/api/users/${adminId}`, { method: 'DELETE', headers: H })
  log('DELETE 自己（应 400）', r.status)

  // 6. 有赛事记录则禁止删除（应 409）
  const t = await (
    await fetch(BASE + '/api/tournaments', {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ name: 'tmp_t_' + Date.now(), format: 'single_elimination', matchFormat: 'none', maxParticipants: 4 }),
    })
  ).json()
  db.prepare(
    'INSERT INTO registrations(tournament_id, user_id, status, registered_at) VALUES(?,?,?,?)'
  ).run(t.tournament?.id || t.id, player.id, 'confirmed', new Date().toISOString())
  const regCount = db.prepare('SELECT COUNT(*) AS c FROM registrations WHERE user_id=?').get(player.id).c
  r = await fetch(BASE + `/api/users/${player.id}`, { method: 'DELETE', headers: H })
  const delBody = await r.json()
  log('DELETE 有记录账号（应 409）', r.status, delBody.error || '')
  console.log(`   关联记录数=${regCount}`)

  // 7. 无记录删除（应 200）
  db.prepare('DELETE FROM registrations WHERE user_id=?').run(player.id)
  db.prepare('DELETE FROM tournaments WHERE name LIKE ?').run('tmp_t_%')
  r = await fetch(BASE + `/api/users/${player.id}`, { method: 'DELETE', headers: H })
  log('DELETE 无记录账号（应 200）', r.status)

  // 清理临时管理员
  db.prepare('DELETE FROM users WHERE username=?').run(uname)
  console.log('\n清理完成。')
}

main().catch((e) => {
  console.error('测试异常:', e)
  db.prepare('DELETE FROM users WHERE username=?').run(uname)
  process.exit(1)
})
