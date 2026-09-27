// 多赛制端到端验证：注册 -> 建赛 -> 发布 -> 报名满员 -> 抽签 -> 录分至收官
const BASE = 'http://localhost:3001'

async function call(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${data.error || ''}`)
  return data
}

let pass = 0
let fail = 0
const ok = (c, m) => (c ? pass++ : (fail++, console.error('  ✗', m)))

// 注册管理员
const admin = await call('POST', '/api/auth/login', { username: 'admin', password: 'admin123456' })
const AT = admin.token

// 注册 4 名选手（已存在则直接登录，便于重复运行）
const players = []
for (let i = 1; i <= 4; i++) {
  const username = `play${i}`
  let u
  try {
    u = await call('POST', '/api/auth/register', { username, password: 'pw123456', fullName: `选手${i}` })
  } catch {
    u = await call('POST', '/api/auth/login', { username, password: 'pw123456' })
  }
  players.push(u.token)
}

async function driveToFinish(tid, token) {
  for (let guard = 0; guard < 300; guard++) {
    const { tournament } = await call('GET', `/api/tournaments/${tid}`, null, token)
    if (tournament.status === 'finished') return tournament
    // 小组循环（带分组）的小组赛在 groups 里，淘汰赛在 rounds 里
    const groupMs = tournament.bracket.groups
      ? tournament.bracket.groups.flatMap((g) => g.rounds.flat())
      : []
    const matches = [...groupMs, ...tournament.bracket.rounds.flat()]
    const pending = matches.filter(
      (m) => m.status !== 'done' && m.status !== 'bye' && m.slots[0] && m.slots[1]
    )
    if (!pending.length) return tournament // 卡住（理论上不会）
    for (const m of pending) {
      const a = m.slots[0]
      const b = m.slots[1]
      const winnerId = a.seed <= b.seed ? a.id : b.id // 低种子必胜，便于断言
      await call('POST', `/api/matches/${tid}-${m.id}/result`, { winnerId }, token)
    }
  }
  return null
}

for (const format of ['single_elimination', 'double_elimination', 'round_robin', 'swiss']) {
  const name = `测试-${format}`
  // 小组循环需指定分组数量（此处 4 人分 2 组，每组 2 人）
  const payload = { name, format, maxParticipants: 4 }
  if (format === 'round_robin') payload.groupCount = 2
  const { tournament } = await call('POST', '/api/tournaments', payload, AT)
  await call('POST', `/api/tournaments/${tournament.id}/publish`, {}, AT)
  for (const pt of players) await call('POST', `/api/tournaments/${tournament.id}/register`, {}, pt)

  const detail = await call('GET', `/api/tournaments/${tournament.id}`, null, AT)
  ok(detail.tournament.status === 'ongoing', `${format}: 满员后自动抽签(ongoing)`)
  ok(detail.tournament.bracket && detail.tournament.bracket.rounds.length > 0, `${format}: 生成对阵`)

  if (format === 'round_robin') {
    const gs = detail.tournament.bracket.groups
    ok(Array.isArray(gs) && gs.length === 2, `${format}: 分为 2 个小组`)
    ok(gs.every((g) => g.standings.length === 2), `${format}: 每组积分榜 2 人`)
  } else if (format === 'swiss') {
    const st = detail.tournament.bracket.standings
    ok(Array.isArray(st) && st.length === 4, `${format}: 生成积分榜(4人)`)
  }

  const finished = await driveToFinish(tournament.id, AT)
  ok(finished && finished.status === 'finished', `${format}: 录分至收官(finished)`)
  const champ = finished.bracket.champion
  ok(champ && champ.name === '选手1', `${format}: 冠军为最低种子(选手1)，实际=${champ ? champ.name : '无'}`)
  if (format === 'round_robin') {
    ok(
      finished.bracket.groups.every((g) => g.standings[0].name === '选手1' || g.standings[0].points >= 0),
      `${format}: 每组均有积分榜`
    )
  } else if (format === 'swiss') {
    ok(finished.bracket.standings[0].name === '选手1', `${format}: 积分榜第一为选手1`)
  }
}

console.log(`\n多赛制流程：通过 ${pass} 项，失败 ${fail} 项`)
process.exit(fail ? 1 : 0)
