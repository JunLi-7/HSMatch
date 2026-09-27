// 战队赛（team_kof）端到端测试：四阶段 BP + 赛果 ban 校验 + BO11 收官
const BASE = 'http://localhost:3001/api'

async function api(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = { _raw: text }
  }
  return { status: res.status, data }
}

const results = []
function check(name, cond, extra = '') {
  results.push({ name, ok: !!cond, extra })
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? '  ' + extra : ''}`)
}

async function main() {
  const stamp = Date.now().toString().slice(-6)
  // 1) 注册两名选手
  const uA = 'teamA' + stamp
  const uB = 'teamB' + stamp
  let r = await api('POST', '/auth/register', { username: uA, password: 'abc123456', fullName: uA })
  check('注册选手A', r.status === 200 || r.status === 201, 'HTTP ' + r.status)
  r = await api('POST', '/auth/register', { username: uB, password: 'abc123456', fullName: uB })
  check('注册选手B', r.status === 200 || r.status === 201, 'HTTP ' + r.status)

  // 2) 登录（含管理员）
  const login = async (u) => (await api('POST', '/auth/login', { username: u, password: 'abc123456' })).data.token
  const tA = await login(uA)
  const tB = await login(uB)
  const tAdmin = (await api('POST', '/auth/login', { username: 'admin', password: 'admin123456' })).data.token
  check('管理员登录', !!tAdmin)
  check('选手A登录', !!tA)
  check('选手B登录', !!tB)

  // 3) 管理员创建战队赛
  r = await api('POST', '/tournaments', {
    name: '战队赛测试' + stamp,
    format: 'single_elimination',
    matchFormat: 'team_kof',
    rule: 'conquest', // 应被后端忽略，强制 kof
    maxParticipants: 2,
  }, tAdmin)
  check('创建战队赛', r.status === 200, 'HTTP ' + r.status + ' ' + JSON.stringify(r.data.error || ''))
  const tid = r.data.tournament?.id
  check('战队赛强制 KOF', r.data.tournament?.rule === 'kof', 'rule=' + r.data.tournament?.rule)

  // 4) 发布 + 双方报名（满员自动抽签）
  await api('POST', `/tournaments/${tid}/publish`, {}, tAdmin)
  await api('POST', `/tournaments/${tid}/register`, {}, tA)
  r = await api('POST', `/tournaments/${tid}/register`, {}, tB)
  check('满员自动抽签', r.status === 200 && r.data.auto === true, 'HTTP ' + r.status)

  // 5) 取对阵详情
  r = await api('GET', `/tournaments/${tid}`, null, tA)
  const match = r.data.tournament.bracket.rounds[0][0]
  const mid = match.id
  check('对阵生成', !!match, 'mid=' + mid)
  const mpath = `/matches/${tid}-${mid}`
  check('初始阶段为 team_ban1', match.deckPhase === 'team_ban1', 'phase=' + match.deckPhase)
  check('战队赛 isTeam 标记', match.isTeam === true)

  // 6) 三阶段 BP（双方各操作）：ban1 → 保护 → ban2
  // ban1: A禁B的2, B禁A的3
  r = await api('POST', mpath + '/bp-team', { step: 'ban1', ban: 2 }, tA)
  check('A ban1', r.status === 200)
  r = await api('POST', mpath + '/bp-team', { step: 'ban1', ban: 3 }, tB)
  check('B ban1 后推进到 team_protect', r.status === 200 && r.data.phase === 'team_protect', 'phase=' + r.data.phase)

  // protect: A保护0, B保护1
  r = await api('POST', mpath + '/bp-team', { step: 'protect', protect: 0 }, tA)
  check('A 保护', r.status === 200)
  r = await api('POST', mpath + '/bp-team', { step: 'protect', protect: 1 }, tB)
  check('B 保护后推进到 team_ban2', r.status === 200 && r.data.phase === 'team_ban2', 'phase=' + r.data.phase)

  // 非法：ban2 阶段不能 ban 对方已保护的职业（A 试图禁 B 的 1）应被拒
  r = await api('POST', mpath + '/bp-team', { step: 'ban2', ban2: [1, 6] }, tA)
  check('ban2 不能 ban 对方已保护职业(后端拦截)', r.status === 400, 'HTTP ' + r.status + ' ' + (r.data.error || ''))

  // ban2: A禁B的[6,7], B禁A的[8,9]
  r = await api('POST', mpath + '/bp-team', { step: 'ban2', ban2: [6, 7] }, tA)
  check('A ban2', r.status === 200)
  r = await api('POST', mpath + '/bp-team', { step: 'ban2', ban2: [8, 9] }, tB)
  check('B ban2 后 BP 公布', r.status === 200 && r.data.revealed === true && r.data.phase === 'playing', 'phase=' + r.data.phase)

  // 校验 ban 集合：A 被 ban=[3,8,9]，B 被 ban=[2,6,7]
  r = await api('GET', `/tournaments/${tid}`, null, tA)
  const m2 = r.data.tournament.bracket.rounds[0][0]
  const aBanned = m2.bp.aBanned
  const bBanned = m2.bp.bBanned
  check('A 被 ban 三套', JSON.stringify(aBanned.slice().sort()) === JSON.stringify([3, 8, 9]), 'aBanned=' + JSON.stringify(aBanned))
  check('B 被 ban 三套', JSON.stringify(bBanned.slice().sort()) === JSON.stringify([2, 6, 7]), 'bBanned=' + JSON.stringify(bBanned))
  check('A 可用 8 套', m2.bp.aDecks.length - aBanned.length === 8, 'usable=' + (m2.bp.aDecks.length - aBanned.length))

  // 7) 赛果 ban 校验：A 用被 ban 的下标 3 出战应被拒
  const badGames = [{ no: 1, winnerSide: 'A', winnerDeck: 3, loserDeck: 0 }]
  r = await api('POST', mpath + '/result-submit', { games: badGames }, tA)
  check('被 ban 卡组不可出战(后端拦截)', r.status === 400, 'HTTP ' + r.status + ' ' + (r.data.error || ''))

  // 8) 正常赛果：A 6-0（firstTo=6），A 用 usable 中的 10，B 用 usable 中的若干
  const winDeckA = 10 // A usable
  const loseDecksB = [0, 1, 4, 5, 8, 9] // B usable
  const goodGames = loseDecksB.map((ld, i) => ({ no: i + 1, winnerSide: 'A', winnerDeck: winDeckA, loserDeck: ld }))
  r = await api('POST', mpath + '/result-submit', { games: goodGames }, tA)
  check('A 提交赛果', r.status === 200)
  r = await api('POST', mpath + '/result-submit', { games: goodGames }, tB)
  check('B 提交赛果', r.status === 200)

  // 9) 管理员确认（双方一致 → 自动判定 A 胜，BO11 先赢6局）
  r = await api('POST', mpath + '/admin-confirm', { action: 'confirm' }, tAdmin)
  check('管理员确认收官', r.status === 200, 'HTTP ' + r.status + ' ' + JSON.stringify(r.data.error || ''))
  check('胜方为 A', r.data.winnerSide === 'A', 'winner=' + r.data.winnerSide)

  // 10) 赛后状态
  r = await api('GET', `/tournaments/${tid}`, null, tA)
  const m3 = r.data.tournament.bracket.rounds[0][0]
  check('比赛 done', m3.status === 'done', 'status=' + m3.status)

  // 11) 管理员删除已结束赛事（单败决赛收官后 tournament 应为 finished）
  r = await api('GET', `/tournaments/${tid}`, null, tAdmin)
  check('赛事已完赛(finished)', r.data.tournament?.status === 'finished', 'status=' + r.data.tournament?.status)
  r = await api('DELETE', `/tournaments/${tid}`, null, tAdmin)
  check('管理员删除已结束赛事', r.status === 200, 'HTTP ' + r.status + ' ' + JSON.stringify(r.data.error || ''))
  r = await api('GET', `/tournaments/${tid}`, null, tAdmin)
  check('删除后详情不可见', r.status === 404, 'HTTP ' + r.status)

  const failed = results.filter((x) => !x.ok)
  console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`)
  process.exit(failed.length ? 1 : 0)
}

main().catch((e) => {
  console.error('测试异常:', e)
  process.exit(1)
})
