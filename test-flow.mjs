// 后端端到端冒烟测试：注册->建赛->发布->报名->满员自动抽签->录分晋级
const BASE = 'http://localhost:3001/api'

async function j(method, path, body, token) {
  const opts = { method, headers: {} }
  if (token) opts.headers.Authorization = `Bearer ${token}`
  if (body !== undefined && body !== null) {
    opts.headers['Content-Type'] = 'application/json'
    opts.body = JSON.stringify(body)
  }
  const r = await fetch(BASE + path, opts)
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(data)}`)
  return data
}

const run = async () => {
  const admin = await j('POST', '/auth/login', { email: 'admin@match.local', password: 'admin123456' })
  const at = admin.token

  const t = await j('POST', '/tournaments', {
    name: '冒烟测试杯', description: 'auto', format: 'single_elimination', maxParticipants: 4,
  }, at)
  const tid = t.tournament.id
  console.log('创建赛事 id=', tid)

  await j('POST', `/tournaments/${tid}/publish`, {}, at)
  console.log('发布赛事 ok')

  const players = []
  for (let i = 1; i <= 4; i++) {
    const p = await j('POST', '/auth/register', {
      email: `p${i}@x.com`, password: 'player1', fullName: `选手${i}`,
    })
    players.push(p)
  }
  console.log('注册 4 名选手 ok')

  for (let i = 0; i < 3; i++) {
    const r = await j('POST', `/tournaments/${tid}/register`, {}, players[i].token)
    console.log(`选手${i + 1} 报名 ok, 当前人数=${r.registeredCount}`)
  }
  const last = await j('POST', `/tournaments/${tid}/register`, {}, players[3].token)
  console.log('第4人报名触发满员自动抽签, rounds=', last.bracket.rounds.length, 'byes=', last.bracket.byes)

  const detail = await j('GET', `/tournaments/${tid}`, null, at)
  const m0 = detail.tournament.bracket.rounds[0][0]
  const res1 = await j('POST', `/matches/${tid}-${m0.id}/result`, { scoreA: 2, scoreB: 0 }, at)
  console.log('录入首场赛果, 胜者=', res1.winner.name)

  const d2 = await j('GET', `/tournaments/${tid}`, null, at)
  console.log('赛事状态=', d2.tournament.status, '首轮场1状态=', d2.tournament.bracket.rounds[0][0].status)

  // 选手视角：应能看到该赛事
  const pHome = await j('GET', '/tournaments', null, players[0].token)
  console.log('选手大厅可见赛事数=', pHome.tournaments.length)
  console.log('ALL FLOW OK')
}

run().catch((e) => {
  console.error('FLOW FAILED:', e.message)
  process.exit(1)
})
