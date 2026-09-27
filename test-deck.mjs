// 对阵制（炉石）+ 选手端 BP + 手动提交赛果 + 管理员确认 的端到端验证
const BASE = 'http://localhost:3001'
let pass = 0
let fail = 0
const check = (cond, msg) => {
  if (cond) {
    pass++
    console.log('  ✓', msg)
  } else {
    fail++
    console.log('  ✗', msg)
  }
}
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${data.error || ''}`)
  return data
}

// 注册一名选手，返回 {token,user}
async function regPlayer(seq) {
  const username = `usr${seq}`
  const u = await call('POST', '/api/auth/register', { username, password: 'pw123456', fullName: `选手${seq}` })
  return u
}

async function main() {
  // 管理员
  const admin = await call('POST', '/api/auth/login', { username: 'admin', password: 'admin123456' })
  const AT = admin.token

  // 4 名选手
  const p = []
  for (let i = 1; i <= 4; i++) p.push(await regPlayer(i))
  const tokens = p.map((x) => x.token)

  // 创建：单败 + BO3禁1选2 + 征服
  const { tournament } = await call(
    'POST',
    '/api/tournaments',
    { name: '炉石测试', format: 'single_elimination', matchFormat: 'bo3_ban1_pick2', rule: 'conquest', maxParticipants: 4 },
    AT
  )
  const tid = tournament.id
  await call('POST', `/api/tournaments/${tid}/publish`, {}, AT)
  for (const t of tokens) await call('POST', `/api/tournaments/${tid}/register`, {}, t)

  let t = await call('GET', `/api/tournaments/${tid}`, null, AT)
  const rounds = t.tournament.bracket.rounds
  const r1 = rounds[0]
  check(r1.length === 2, '首轮 2 场')
  const m1 = r1[0]
  const aId = m1.slots[0].id
  const bId = m1.slots[1].id
  const tokenA = tokens.find((tk, i) => String(p[i].user.id) === String(aId))
  const tokenB = tokens.find((tk, i) => String(p[i].user.id) === String(bId))

  // ---- BP 阶段1：填卡组 ----
  console.log('[BP 填卡组]')
  await call('POST', `/api/matches/${tid}-${m1.id}/bp-decks`, { decks: ['死亡骑士', '恶魔猎手', '德鲁伊'] }, tokenA)
  let mv = (await call('GET', `/api/tournaments/${tid}`, null, tokenA)).tournament.bracket.rounds[0][0]
  check(mv.deckPhase === 'bp_decks', 'A 填卡组后仍处于 bp_decks（等 B）')
  check(mv.bp.aDecks.length === 3 && mv.bp.bDecks.length === 0, 'A 可见自己卡组，B 未公布不可见')
  await call('POST', `/api/matches/${tid}-${m1.id}/bp-decks`, { decks: ['猎人', '法师', '圣骑士'] }, tokenB)
  mv = (await call('GET', `/api/tournaments/${tid}`, null, tokenA)).tournament.bracket.rounds[0][0]
  check(mv.bp.decksRevealed === true && mv.deckPhase === 'bp_bans', '双方填卡组后公布，进入禁用阶段')
  check(mv.bp.aDecks.length === 3 && mv.bp.bDecks.length === 3, '卡组公布后双方互见')

  // ---- BP 阶段2：禁用 ----
  console.log('[BP 禁用]')
  await call('POST', `/api/matches/${tid}-${m1.id}/bp-ban`, { ban: 0 }, tokenA)
  await call('POST', `/api/matches/${tid}-${m1.id}/bp-ban`, { ban: 0 }, tokenB)
  mv = (await call('GET', `/api/tournaments/${tid}`, null, tokenA)).tournament.bracket.rounds[0][0]
  check(mv.bp.revealed === true && mv.deckPhase === 'playing', '双方禁用后完整 BP 公布，进入比赛')

  // ---- 提交赛果（一致）----
  console.log('[提交赛果-一致]')
  const gamesA = [
    { no: 1, winnerSide: 'A', winnerDeck: 1, loserDeck: 1 },
    { no: 2, winnerSide: 'A', winnerDeck: 2, loserDeck: 2 },
  ]
  const gamesB = [
    { no: 1, winnerSide: 'A', winnerDeck: 1, loserDeck: 1 },
    { no: 2, winnerSide: 'A', winnerDeck: 2, loserDeck: 2 },
  ]
  await call('POST', `/api/matches/${tid}-${m1.id}/result-submit`, { games: gamesA }, tokenA)
  mv = (await call('GET', `/api/tournaments/${tid}`, null, tokenA)).tournament.bracket.rounds[0][0]
  check(mv.deckPhase === 'bp_decks' || mv.deckPhase === 'playing' || mv.bothResultsSubmitted === false, 'A 提交后等待 B')
  check(mv.myResult?.games?.length === 2 && mv.myResultSubmitted === true, 'A 可见自己提交的赛果')
  // 另一名未参赛选手看不到任何赛果内容
  const tokenC = tokens.find((tk, i) => String(p[i].user.id) !== String(aId) && String(p[i].user.id) !== String(bId))
  const mvC = (await call('GET', `/api/tournaments/${tid}`, null, tokenC)).tournament.bracket.rounds[0][0]
  check(mvC.myResult === null && mvC.adminReview === null, '无关选手看不到赛果内容')
  await call('POST', `/api/matches/${tid}-${m1.id}/result-submit`, { games: gamesB }, tokenB)
  mv = (await call('GET', `/api/tournaments/${tid}`, null, AT)).tournament.bracket.rounds[0][0]
  check(mv.deckPhase === 'submitted' && mv.bothResultsSubmitted === true, '双方提交后进入待管理员确认')
  check(mv.status === 'pending', '确认前不对阵结果做任何处理（status 仍为 pending）')

  // ---- 管理员确认 ----
  console.log('[管理员确认-一致]')
  const conf = await call('POST', `/api/matches/${tid}-${m1.id}/admin-confirm`, { action: 'confirm' }, AT)
  check(conf.winnerSide === 'A', '一致时系统自动判定 A 胜')
  t = await call('GET', `/api/tournaments/${tid}`, null, AT)
  const fm1 = t.tournament.bracket.rounds[0][0]
  check(fm1.status === 'done' && fm1.winnerId === String(aId), '确认后写入胜者并晋级')
  check(t.tournament.bracket.rounds[1][0].slots.some((s) => s && String(s.id) === String(aId)), 'A 晋级到下一轮')

  // ---- 不一致提交：系统不处理，管理员指定胜方确认 ----
  console.log('[不一致提交-管理员裁定]')
  const m2 = t.tournament.bracket.rounds[0][1]
  const a2 = m2.slots[0].id
  const b2 = m2.slots[1].id
  const tkA2 = tokens.find((tk, i) => String(p[i].user.id) === String(a2))
  const tkB2 = tokens.find((tk, i) => String(p[i].user.id) === String(b2))
  await call('POST', `/api/matches/${tid}-${m2.id}/bp-decks`, { decks: ['萨满', '术士', '战士'] }, tkA2)
  await call('POST', `/api/matches/${tid}-${m2.id}/bp-decks`, { decks: ['死亡骑士', '德鲁伊', '猎人'] }, tkB2)
  await call('POST', `/api/matches/${tid}-${m2.id}/bp-ban`, { ban: 0 }, tkA2)
  await call('POST', `/api/matches/${tid}-${m2.id}/bp-ban`, { ban: 0 }, tkB2)
  // A 声称 2:0 胜，B 声称 2:0 胜（互相矛盾）
  await call('POST', `/api/matches/${tid}-${m2.id}/result-submit`, { games: [{ no: 1, winnerSide: 'A', winnerDeck: 1, loserDeck: 1 }, { no: 2, winnerSide: 'A', winnerDeck: 2, loserDeck: 2 }] }, tkA2)
  await call('POST', `/api/matches/${tid}-${m2.id}/result-submit`, { games: [{ no: 1, winnerSide: 'B', winnerDeck: 1, loserDeck: 1 }, { no: 2, winnerSide: 'B', winnerDeck: 2, loserDeck: 2 }] }, tkB2)
  let rejected = false
  try {
    await call('POST', `/api/matches/${tid}-${m2.id}/admin-confirm`, { action: 'confirm' }, AT)
  } catch (e) {
    rejected = /不一致/.test(e.message)
  }
  check(rejected, '不一致时系统拒绝自动确认，要求指定胜方')
  const conf2 = await call('POST', `/api/matches/${tid}-${m2.id}/admin-confirm`, { action: 'confirm', winnerSide: 'B' }, AT)
  check(conf2.winnerSide === 'B', '管理员指定 B 胜后确认成功')
  const fm2 = (await call('GET', `/api/tournaments/${tid}`, null, AT)).tournament.bracket.rounds[0][1]
  check(fm2.status === 'done' && fm2.winnerId === String(b2), '不一致由管理员裁定后正确晋级')

  // ---- 驳回重交 ----
  console.log('[驳回重交]')
  const m3 = (await call('GET', `/api/tournaments/${tid}`, null, AT)).tournament.bracket.rounds[1][0]
  const a3 = m3.slots[0].id
  const b3 = m3.slots[1].id
  const tkA3 = tokens.find((tk, i) => String(p[i].user.id) === String(a3))
  const tkB3 = tokens.find((tk, i) => String(p[i].user.id) === String(b3))
  await call('POST', `/api/matches/${tid}-${m3.id}/bp-decks`, { decks: ['法师', '圣骑士', '牧师'] }, tkA3)
  await call('POST', `/api/matches/${tid}-${m3.id}/bp-decks`, { decks: ['潜行者', '猎人', '德鲁伊'] }, tkB3)
  await call('POST', `/api/matches/${tid}-${m3.id}/bp-ban`, { ban: 0 }, tkA3)
  await call('POST', `/api/matches/${tid}-${m3.id}/bp-ban`, { ban: 0 }, tkB3)
  await call('POST', `/api/matches/${tid}-${m3.id}/result-submit`, { games: [{ no: 1, winnerSide: 'A', winnerDeck: 1, loserDeck: 1 }] }, tkA3)
  await call('POST', `/api/matches/${tid}-${m3.id}/result-submit`, { games: [{ no: 1, winnerSide: 'A', winnerDeck: 1, loserDeck: 1 }] }, tkB3)
  await call('POST', `/api/matches/${tid}-${m3.id}/admin-confirm`, { action: 'reject', note: '请核对' }, AT)
  const fm3 = (await call('GET', `/api/tournaments/${tid}`, null, AT)).tournament.bracket.rounds[1][0]
  check(fm3.deckPhase === 'playing' && fm3.myResultSubmitted === false, '驳回后回到可重交状态')
  await call('POST', `/api/matches/${tid}-${m3.id}/result-submit`, { games: [{ no: 1, winnerSide: 'B', winnerDeck: 1, loserDeck: 1 }, { no: 2, winnerSide: 'B', winnerDeck: 2, loserDeck: 2 }] }, tkB3)
  await call('POST', `/api/matches/${tid}-${m3.id}/result-submit`, { games: [{ no: 1, winnerSide: 'B', winnerDeck: 1, loserDeck: 1 }, { no: 2, winnerSide: 'B', winnerDeck: 2, loserDeck: 2 }] }, tkA3)
  await call('POST', `/api/matches/${tid}-${m3.id}/admin-confirm`, { action: 'confirm' }, AT)
  const fm3b = (await call('GET', `/api/tournaments/${tid}`, null, AT)).tournament.bracket.rounds[1][0]
  check(fm3b.status === 'done' && fm3b.winnerId === String(b3), '重交并确认后 B 晋级')

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => {
  console.error('测试异常：', e.message)
  process.exit(1)
})
