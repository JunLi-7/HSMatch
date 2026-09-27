// 对阵制「可组合分段」模型端到端验证
// 启动真实服务进程（同进程，端口 3099），通过 HTTP API 验证：
//   1) validateFormat 一致性规则（纯逻辑）
//   2) normalizeSegments 自动补「全程」段（纯逻辑）
//   3) resolveSegment 后期段覆盖（纯逻辑）
//   4) 创建赛事(自定义) + 抽签后，matches 落库 bo/ban_count/deck_count 正确
//   5) 后期段(四强起)覆盖前期段
//   6) ban=0 → 无 BP（deck_phase=playing, ban_count=0）
//   7) 战队赛固定不变
import process from 'process'
import { createSession } from './server/auth.js'
import db from './server/db.js'

process.env.PORT = '3099'
// 启动服务（app.listen 在导入时自动发生）
await import('./server/index.js')
// 给监听一点时间
await new Promise((r) => setTimeout(r, 400))

const BASE = 'http://127.0.0.1:3099'
let passed = 0
let failed = 0
function ok(cond, msg) {
  if (cond) {
    passed++
    console.log('  ✓', msg)
  } else {
    failed++
    console.log('  ✗', msg)
  }
}
function eq(a, b, msg) {
  ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (得到 ${JSON.stringify(a)}, 期望 ${JSON.stringify(b)})`)
}

// ---------- 准备管理员 + 测试账号 ----------
const mkUser = async (username, role) => {
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username)
  if (existing) return existing.id
  const { hashPassword: hp } = await import('./server/auth.js')
  const info = db
    .prepare('INSERT INTO users(username, password_hash, full_name, role, created_at) VALUES(?,?,?,?,?)')
    .run(username, hp('test1234'), username, role, new Date().toISOString())
  return Number(info.lastInsertRowid)
}
const adminId = await mkUser('e2e_admin_zx9', 'admin')

// 确保 8 个选手
const playerIds = []
for (let i = 1; i <= 8; i++) playerIds.push(await mkUser('e2e_p' + i, 'player'))

const token = createSession(adminId)
const H = { 'Content-Type': 'application/json', 'X-Session-Token': token }
async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: H,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    data = text
  }
  return { status: res.status, data }
}

// ============ 纯逻辑测试 ============
console.log('\n[1] validateFormat 一致性规则')
const {
  validateFormat,
  normalizeSegments,
  resolveSegment,
  roundStageLevel,
  segToStyle,
  segmentSummary,
} = await import('./src/lib/matchFormats.js')

ok(validateFormat({ rule: 'conquest', bo: 3, ban: 1, decks: 3 }).ok, '带3禁1 → pick2 → BO3 一致')
ok(validateFormat({ rule: 'conquest', bo: 5, ban: 1, decks: 4 }).ok, '带4禁1 → pick3 → BO5 一致')
ok(!validateFormat({ rule: 'conquest', bo: 3, ban: 1, decks: 4 }).ok, '带4禁1 但 BO3 → 不一致应拦截')
eq(
  validateFormat({ rule: 'conquest', bo: 3, ban: 1, decks: 4 }).error.includes('BO5'),
  true,
  '不一致错误信息提示应对应 BO5'
)
ok(validateFormat({ rule: 'conquest', bo: 1, ban: 0, decks: 1 }).ok, '带1禁0 → BO1 一致')
ok(!validateFormat({ rule: 'conquest', bo: 4, ban: 1, decks: 3 }).ok, 'BO 为偶数应拦截')

console.log('\n[2] normalizeSegments 自动补全程段')
const norm = normalizeSegments(
  [{ appliesTo: 'semi', rule: 'conquest', bo: 5, ban: 1, decks: 4 }],
  'single_elimination'
)
ok(norm.some((s) => s.appliesTo === 'all'), '仅设四强段时自动补「全程」段覆盖前期')
ok(!norm.some((s) => s.appliesTo === 'quarter' || s.appliesTo === 'final'), '过滤掉非法阶段')

console.log('\n[3] resolveSegment 后期段覆盖')
const segs = [
  { appliesTo: 'all', rule: 'conquest', bo: 3, ban: 1, decks: 3 },
  { appliesTo: 'semi', rule: 'conquest', bo: 5, ban: 1, decks: 4 },
]
eq(resolveSegment(segs, { stage: null, round: 1, totalRounds: 3 }).appliesTo, 'all', '第1轮用全程段')
eq(resolveSegment(segs, { stage: null, round: 2, totalRounds: 3 }).appliesTo, 'semi', '半决赛轮用四强段')
eq(resolveSegment(segs, { stage: null, round: 3, totalRounds: 3 }).appliesTo, 'semi', '决赛轮也用四强段(层级覆盖)')
ok(
  roundStageLevel(3, 3) === 4 && roundStageLevel(2, 3) === 3 && roundStageLevel(1, 3) === 2,
  'roundStageLevel 层级映射正确(8人3轮: 第1轮八强=2, 半决赛=3, 决赛=4)'
)

console.log('\n[4] segToStyle / segmentSummary')
eq(segToStyle(segs[0]).matchFormat, 'conquest', '非战队赛 style=规则名')
eq(segmentSummary(segs[0]), 'BO3 · 征服 · 禁1 · 带3套', '分段摘要格式正确')

// ============ 后端集成测试 ============
console.log('\n[5] 创建自定义赛事(全程BO3 + 四强起BO5) + 抽签')
const createRes = await api('POST', '/api/tournaments', {
  name: 'e2e_自定义赛',
  format: 'single_elimination',
  maxParticipants: 8,
  matchKind: 'custom',
  formatSegments: [
    { appliesTo: 'all', rule: 'conquest', bo: 3, ban: 1, decks: 3 },
    { appliesTo: 'semi', rule: 'conquest', bo: 5, ban: 1, decks: 4 },
  ],
})
ok(createRes.status === 200, '创建自定义赛事成功')
const tid = createRes.data.tournament?.id
ok(!!tid, '返回赛事 id')

// 报名 8 人
for (let i = 1; i <= 8; i++) {
  db.prepare(
    'INSERT OR IGNORE INTO registrations(tournament_id, user_id, status, registered_at) VALUES(?,?,?,?)'
  ).run(tid, playerIds[i - 1], 'confirmed', new Date().toISOString())
}
await api('POST', `/api/tournaments/${tid}/publish`)
const drawRes = await api('POST', `/api/tournaments/${tid}/draw`)
ok(drawRes.status === 200, '抽签成功')

const matches = db
  .prepare('SELECT round, bo, ban_count, deck_count, deck_phase, match_format FROM matches WHERE tournament_id = ? ORDER BY round')
  .all(tid)
ok(matches.length > 0, '已生成比赛')
const r1 = matches.filter((m) => m.round === 1)
const r2 = matches.filter((m) => m.round === 2)
ok(r1.every((m) => m.deck_count === 3 && m.bo === 3 && m.ban_count === 1), '第1轮(前期)用全程段: BO3/带3/禁1')
ok(r2.every((m) => m.deck_count === 4 && m.bo === 5 && m.ban_count === 1), '第2轮(四强)用四强段: BO5/带4/禁1')
ok(
  matches.every((m) => m.deck_phase === null || m.deck_phase === 'bp_decks'),
  'ban>0 的场次初始进入 BP 阶段(非 playing)'
)

console.log('\n[6] ban=0 无 BP 路径')
const noBpRes = await api('POST', '/api/tournaments', {
  name: 'e2e_无ban赛',
  format: 'single_elimination',
  maxParticipants: 8,
  matchKind: 'custom',
  formatSegments: [{ appliesTo: 'all', rule: 'conquest', bo: 3, ban: 0, decks: 2 }],
})
const tid2 = noBpRes.data.tournament?.id
for (let i = 1; i <= 8; i++) {
  db.prepare(
    'INSERT OR IGNORE INTO registrations(tournament_id, user_id, status, registered_at) VALUES(?,?,?,?)'
  ).run(tid2, playerIds[i - 1], 'confirmed', new Date().toISOString())
}
await api('POST', `/api/tournaments/${tid2}/publish`)
await api('POST', `/api/tournaments/${tid2}/draw`)
const m2 = db.prepare('SELECT ban_count, deck_phase, match_format FROM matches WHERE tournament_id = ? LIMIT 1').get(tid2)
ok(m2 && m2.ban_count === 0, '无BP赛事 ban_count=0 落库')
ok(m2 && (m2.deck_phase === 'playing'), '无BP赛事初始 deck_phase=playing(无需BP)')

console.log('\n[7] 战队赛固定不变')
const teamRes = await api('POST', '/api/tournaments', {
  name: 'e2e_战队赛',
  format: 'single_elimination',
  maxParticipants: 8,
  matchKind: 'team',
})
const tid3 = teamRes.data.tournament?.id
eq(teamRes.data.tournament?.match_format, 'team_kof', '战队赛 match_format=team_kof')
for (let i = 1; i <= 8; i++) {
  db.prepare(
    'INSERT OR IGNORE INTO registrations(tournament_id, user_id, status, registered_at) VALUES(?,?,?,?)'
  ).run(tid3, playerIds[i - 1], 'confirmed', new Date().toISOString())
}
await api('POST', `/api/tournaments/${tid3}/publish`)
await api('POST', `/api/tournaments/${tid3}/draw`)
const tm = db.prepare('SELECT bo, ban_count, deck_count, deck_phase FROM matches WHERE tournament_id = ? LIMIT 1').get(tid3)
eq([tm.bo, tm.ban_count, tm.deck_count], [11, 3, 11], '战队赛固定 BO11/禁3/带11')
ok(tm.deck_phase === 'team_ban1', '战队赛进入 team_ban1 阶段')

// ============ 清理（按名称匹配，兼容历史残留） ============
db.exec('PRAGMA foreign_keys = OFF')
const e2eTours = db.prepare("SELECT id FROM tournaments WHERE name LIKE 'e2e_%'").all().map((r) => r.id)
for (const id of e2eTours) {
  db.prepare('DELETE FROM matches WHERE tournament_id = ?').run(id)
  db.prepare('DELETE FROM registrations WHERE tournament_id = ?').run(id)
}
db.prepare("DELETE FROM tournaments WHERE name LIKE 'e2e_%'").run()
db.prepare("DELETE FROM users WHERE username LIKE 'e2e_%'").run()
db.exec('PRAGMA foreign_keys = ON')

console.log(`\n结果：通过 ${passed}，失败 ${failed}`)
process.exit(failed === 0 ? 0 : 1)
