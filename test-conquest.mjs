// 端到端验证：无BP征服赛（四强后切换 BO5/3套）+ 用户名校验扩容
const BASE = 'http://localhost:3001'
const log = (...a) => console.log(...a)

async function call(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = text }
  return { status: res.status, data }
}

const assert = (cond, msg) => {
  if (!cond) { console.log('✗ FAIL:', msg); process.exitCode = 1 }
  else console.log('✓', msg)
}

const admin = (await call('POST', '/api/auth/login', { username: 'admin', password: 'admin123456' })).data.token
assert(admin, '管理员登录成功')

// 1) 创建无BP征服赛（8人，便于出现四强阶段）
const t = (await call('POST', '/api/tournaments', {
  name: '测试·无BP征服赛',
  format: 'single_elimination',
  matchFormat: 'conquest_nobp_2d',
  maxParticipants: 8,
}, admin)).data.tournament
assert(t && t.id, '创建赛事成功')
assert(t.late_match_format === 'conquest_nobp_3d', '后端自动写入四强后配置 conquest_nobp_3d，实际=' + t.late_match_format)
assert(t.rule === 'conquest', '规则强制为 conquest，实际=' + t.rule)

// 2) 建 8 名选手
const players = []
for (let i = 1; i <= 8; i++) {
  const u = (await call('POST', '/api/users', { username: 'p' + i, password: 'test123', fullName: '选手' + i }, admin)).data.user
  players.push(u)
}
assert(players.length === 8, '创建 8 名选手')

// 3) 各选手报名（满 8 自动抽签）
const tokens = {}
for (const p of players) {
  const tk = (await call('POST', '/api/auth/login', { username: p.username, password: 'test123' })).data.token
  tokens[p.id] = tk
  const r = await call('POST', '/api/tournaments/' + t.id + '/register', {}, tk)
  assert(r.status === 200, '选手 ' + p.username + ' 报名')
}

// 4) 检查对阵树：早期轮 BO3/2套，四强轮 BO5/3套
const det = (await call('GET', '/api/tournaments/' + t.id, null, admin)).data.tournament
assert(det.status === 'ongoing', '赛事已进行中（自动抽签）')
const rounds = det.bracket.rounds
assert(rounds.length === 3, '8人单败共 3 轮，实际=' + rounds.length)
const r1 = rounds[0][0]
assert(r1.match_format === 'conquest_nobp_2d', 'R1 早期场 match_format=conquest_nobp_2d，实际=' + r1.match_format)
assert(r1.noBP === true, 'R1 标记 noBP=true')
assert(rounds[1][0].match_format === 'conquest_nobp_3d', 'R2(四强) match_format=conquest_nobp_3d，实际=' + rounds[1][0].match_format)
assert(rounds[2][0].match_format === 'conquest_nobp_3d', 'R3(决赛) match_format=conquest_nobp_3d，实际=' + rounds[2][0].match_format)

// 5) 早期场：双方提交赛果（A 用两套卡组征服 B）
const mA = r1.slots[0].id, mB = r1.slots[1].id
const gid = t.id + '-' + r1.id
const gamesA = [
  { no: 1, winnerSide: 'A', winnerDeck: 0, loserDeck: 1 },
  { no: 2, winnerSide: 'A', winnerDeck: 1, loserDeck: 0 },
]
const subA = await call('POST', '/api/matches/' + gid + '/result-submit', { games: gamesA }, tokens[mA])
assert(subA.status === 200, 'A 提交早期赛果')
const subB = await call('POST', '/api/matches/' + gid + '/result-submit', { games: gamesA }, tokens[mB])
assert(subB.status === 200, 'B 提交早期赛果（一致）')

// 6) 管理员确认 → 应判定 A 胜并晋级
const conf = await call('POST', '/api/matches/' + gid + '/admin-confirm', { action: 'confirm' }, admin)
assert(conf.status === 200, '管理员确认')
const det2 = (await call('GET', '/api/tournaments/' + t.id, null, admin)).data.tournament
const m1 = det2.bracket.rounds[0].find((x) => x.id === r1.id)
assert(m1.status === 'done' && String(m1.winnerId) === String(mA), '早期场已收官且 A 晋级')
const nextM = det2.bracket.rounds[1][0]
const advanced = nextM.slots.some((s) => s && String(s.id) === String(mA))
assert(advanced, 'A 已进入四强场 slot')

// 7) 四强场：验证 3 套卡组可提交（deck 下标 2 合法）
const gid2 = t.id + '-' + nextM.id
const gamesLate = [
  { no: 1, winnerSide: 'A', winnerDeck: 0, loserDeck: 1 },
  { no: 2, winnerSide: 'A', winnerDeck: 1, loserDeck: 2 },
  { no: 3, winnerSide: 'A', winnerDeck: 2, loserDeck: 0 },
]
// 四强场此时可能只有一个槽位已填（A 方），用 A 方 token 提交
const subLate = await call('POST', '/api/matches/' + gid2 + '/result-submit', { games: gamesLate }, tokens[mA])
assert(subLate.status === 200, '四强场提交 3 套卡组合法（deck 下标 2 通过校验）')
const badLate = await call('POST', '/api/matches/' + gid2 + '/result-submit', { games: [{ no: 1, winnerSide: 'A', winnerDeck: 5, loserDeck: 0 }] }, tokens[mA])
assert(badLate.status === 400, '四强场 deck 下标越界被正确拒绝')

// 8) 用户名校验扩容：10 汉字 + 8 数字
const bigName = '选手选手选手选手选手选手选手选手选手选手' + '12345678'
assert(bigName.length === 18, '构造用户名长度=18')
const reg = await call('POST', '/api/auth/register', { username: bigName, password: 'test123456', fullName: '大号' })
assert(reg.status === 200, '10汉字+8数字 用户名注册成功')
const tooLong = '选手'.repeat(16) + '12345678' // 32+8=40 汉字+数字，超 30
const reg2 = await call('POST', '/api/auth/register', { username: tooLong, password: 'test123456' })
assert(reg2.status === 400, '超长用户名被拒绝')

// 清理：删除测试赛事
await call('DELETE', '/api/tournaments/' + t.id, null, admin)

log('\n=== 测试完成 ===')
