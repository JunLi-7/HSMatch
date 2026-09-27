// 对阵生成算法（纯逻辑，无框架依赖）
// 支持赛制：single_elimination(单败) / double_elimination(双败) / round_robin(小组循环) / swiss(瑞士轮)
// 约定：种子按 1..n 排序；人数不足 2 的幂时单/双败用“轮空”补满，循环/瑞士天然支持任意人数。
// 比赛对象统一形状：
//   { id, round, index, slots:[A,B], status, winnerId, score_a, score_b,
//     nextMatchId, nextSlot, loserNextMatchId, loserNextSlot, group, roundName, isBye, byeWinner }

function nextPow2(n) {
  let s = 1
  while (s < n) s *= 2
  return s
}

function normalizeParticipants(input) {
  if (typeof input === 'number') {
    const arr = []
    for (let i = 1; i <= input; i++) arr.push({ id: `P${i}`, name: `选手${i}`, seed: i })
    return arr
  }
  return input.map((p, i) => ({
    id: p.id != null ? p.id : `P${i + 1}`,
    name: p.name != null ? p.name : `选手${i + 1}`,
    seed: p.seed != null ? p.seed : i + 1,
  }))
}

function makeMatch(round, index, a, b, opts = {}) {
  return {
    id: opts.id || `R${round}M${index}`,
    round,
    index,
    slots: [a, b],
    isBye: false,
    isDoubleBye: false,
    byeWinner: null,
    status: 'pending',
    winnerId: null,
    score_a: null,
    score_b: null,
    nextMatchId: null,
    nextSlot: null,
    loserNextMatchId: null,
    loserNextSlot: null,
    group: opts.group || null,
    // 阶段标记：'group' 小组赛 / 'ko' 淘汰赛 / null 常规（单败·双败·瑞士轮）
    stage: opts.stage || null,
    roundName: null,
  }
}

// 洗牌（Fisher-Yates）：用于随机落位、随机抽签
function shuffle(arr) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const t = a[i]
    a[i] = a[j]
    a[j] = t
  }
  return a
}

// 仅第一轮做轮空判定：恰好一个空位 => 另一方轮空直接晋级；两个空位 => 双轮空（本布局不应出现）
// 注意：轮空席位有两种等价形态——真正的空位(null)，以及补齐人数用的虚拟「轮空」对象(_bye)。
// 双败/瑞士轮用后者填充，若只按 null 判定会导致轮空永不生效、对阵卡死在 pending。
function classifyFirstRound(round) {
  round.forEach((m) => {
    const isEmpty = (s) => s === null || s === undefined || s._bye === true
    const real = m.slots.filter((s) => !isEmpty(s))
    const emptyCount = m.slots.length - real.length
    if (real.length === 1 && emptyCount === 1) {
      m.isBye = true
      m.byeWinner = real[0]
    } else if (real.length === 0) {
      m.isDoubleBye = true
    }
  })
}

function roundName(round, roundsCount) {
  if (round === roundsCount) return '决赛'
  if (round === roundsCount - 1) return '半决赛'
  if (round === roundsCount - 2) return '四分之一决赛'
  return `第 ${round} 轮`
}

// ============ 单败淘汰 ============
export function generateSingleElimination(input) {
  const participants = normalizeParticipants(input)
  const n = participants.length
  if (n < 1) throw new Error('参赛人数必须 >= 1')
  if (n === 1) {
    return {
      format: 'single_elimination',
      participantCount: 1,
      size: 1,
      roundsCount: 0,
      byes: 0,
      champion: participants[0],
      rounds: [],
      participants,
    }
  }

  const size = nextPow2(n)
  const roundsCount = Math.log2(size)
  const byes = size - n

  const slots = participants.slice()
  while (slots.length < size) slots.push(null)

  const rounds = []
  const first = []
  for (let i = 0; i < size / 2; i++) {
    const a = slots[i]
    const b = slots[size - 1 - i]
    first.push(makeMatch(1, i + 1, a, b))
  }
  rounds.push(first)
  classifyFirstRound(first)

  for (let r = 2; r <= roundsCount; r++) {
    const prev = rounds[r - 2]
    const next = []
    for (let k = 0; k < prev.length / 2; k++) {
      const m = makeMatch(r, k + 1, null, null)
      const top = prev[2 * k]
      const bottom = prev[2 * k + 1]
      top.nextMatchId = m.id
      top.nextSlot = 'A'
      bottom.nextMatchId = m.id
      bottom.nextSlot = 'B'
      if (top.byeWinner) m.slots[0] = top.byeWinner
      if (bottom.byeWinner) m.slots[1] = bottom.byeWinner
      next.push(m)
    }
    rounds.push(next)
  }

  rounds.forEach((matches, idx) => {
    const name = roundName(idx + 1, roundsCount)
    matches.forEach((m) => {
      m.roundName = name
    })
  })

  return { format: 'single_elimination', participantCount: n, size, roundsCount, byes, rounds, participants }
}

// ============ 双败淘汰 ============
export function generateDoubleElimination(input) {
  const participants = normalizeParticipants(input)
  const n = participants.length
  if (n < 1) throw new Error('参赛人数必须 >= 1')
  if (n === 1) {
    return { format: 'double_elimination', participantCount: 1, size: 1, roundsCount: 0, byes: 0, champion: participants[0], rounds: [], participants }
  }

  let size = nextPow2(n)
  if (size < 4) size = 4 // 双败至少需要 4 个槽位才能构成败者组
  const k = Math.log2(size)
  const byes = size - n

  // 用虚拟“轮空”选手补齐到 2 的幂，简化败者组掉入逻辑（虚拟轮空不会进入败者组）
  const parts = participants.slice()
  for (let i = 0; i < byes; i++) parts.push({ id: `BYE${i}`, name: '轮空', seed: 9000 + i, _bye: true })

  const slots = parts.slice()
  while (slots.length < size) slots.push(null)

  const all = {}
  const reg = (m) => {
    all[m.id] = m
    return m
  }

  // ---- 胜者组 WB ----
  const wb = []
  const first = []
  for (let i = 0; i < size / 2; i++) {
    first.push(reg(makeMatch(1, i + 1, slots[i], slots[size - 1 - i], { id: `WB-R1-M${i + 1}`, group: 'WB' })))
  }
  wb.push(first)
  classifyFirstRound(first)

  for (let r = 2; r <= k; r++) {
    const prev = wb[r - 2]
    const round = []
    for (let i2 = 0; i2 < prev.length / 2; i2++) {
      const m = reg(makeMatch(r, i2 + 1, null, null, { id: `WB-R${r}-M${i2 + 1}`, group: 'WB' }))
      const top = prev[2 * i2]
      const bottom = prev[2 * i2 + 1]
      top.nextMatchId = m.id
      top.nextSlot = 'A'
      bottom.nextMatchId = m.id
      bottom.nextSlot = 'B'
      if (top.byeWinner) m.slots[0] = top.byeWinner
      if (bottom.byeWinner) m.slots[1] = bottom.byeWinner
      round.push(m)
    }
    wb.push(round)
  }

  // ---- 败者组 LB ----
  const lb = []
  function pairInto(sources, overallRound) {
    if (sources.length % 2 === 1) sources = sources.concat([null]) // 奇数补一个空位(轮空)
    const round = []
    let idx = 1
    for (let i = 0; i < sources.length; i += 2) {
      const sA = sources[i]
      const sB = sources[i + 1]
      const m = reg(makeMatch(overallRound, idx, null, null, { id: `LB-R${overallRound - k}-M${idx}`, group: 'LB' }))
      idx++
      if (sA) {
        const X = all[sA.matchId]
        if (sA.type === 'loser') {
          X.loserNextMatchId = m.id
          X.loserNextSlot = 'A'
        } else {
          X.nextMatchId = m.id
          X.nextSlot = 'A'
        }
      }
      if (sB) {
        const X = all[sB.matchId]
        if (sB.type === 'loser') {
          X.loserNextMatchId = m.id
          X.loserNextSlot = 'B'
        } else {
          X.nextMatchId = m.id
          X.nextSlot = 'B'
        }
      }
      round.push(m)
    }
    return round
  }

  // LB-1：胜者组第一轮的真实败者掉入
  const lb1Sources = first.filter((m) => !m.isBye).map((m) => ({ type: 'loser', matchId: m.id }))
  lb.push(pairInto(lb1Sources, k + 1))

  for (let j = 2; j <= 2 * k - 2; j++) {
    const overallRound = k + j
    let sources
    if (j % 2 === 0) {
      // 掉入轮：上一轮 LB 胜者 + 胜者组第 r 轮败者(r = j/2+1) 交错配对
      const r = j / 2 + 1
      const wbLosers = wb[r - 1].filter((m) => !m.isBye).map((m) => ({ type: 'loser', matchId: m.id }))
      const lw = lb[j - 2].map((m) => ({ type: 'winner', matchId: m.id }))
      sources = []
      const len = Math.max(lw.length, wbLosers.length)
      for (let x = 0; x < len; x++) {
        if (lw[x]) sources.push(lw[x])
        if (wbLosers[x]) sources.push(wbLosers[x])
      }
    } else {
      // 内部轮：上一轮 LB 胜者两两互配
      sources = lb[j - 2].map((m) => ({ type: 'winner', matchId: m.id }))
    }
    lb.push(pairInto(sources, overallRound))
  }

  // ---- 总决赛 GF ----
  const gfRound = k + (2 * k - 2) + 1
  const gf = reg(makeMatch(gfRound, 1, null, null, { id: 'GF-M1', group: 'GF' }))
  wb[k - 1][0].nextMatchId = 'GF-M1'
  wb[k - 1][0].nextSlot = 'A'
  lb[lb.length - 1][0].nextMatchId = 'GF-M1'
  lb[lb.length - 1][0].nextSlot = 'B'

  wb.forEach((round, idx) => round.forEach((m) => (m.roundName = `胜者组 第${idx + 1}轮`)))
  lb.forEach((round, idx) => round.forEach((m) => (m.roundName = `败者组 第${idx + 1}轮`)))
  gf.roundName = '总决赛'

  const rounds = [...wb, ...lb, [gf]]
  return { format: 'double_elimination', participantCount: n, size, roundsCount: rounds.length, byes, rounds, participants }
}

// ============ 小组循环（单循环） ============
export function generateRoundRobin(input) {
  const participants = normalizeParticipants(input)
  const n = participants.length
  if (n < 2) throw new Error('小组循环至少需要 2 人')

  const list = participants.slice()
  let hasBye = false
  if (n % 2 === 1) {
    list.push(null) // 奇数人时每轮一人轮空
    hasBye = true
  }
  const m = list.length
  const rounds = []
  const arr = list.slice()

  for (let r = 0; r < m - 1; r++) {
    const round = []
    for (let i = 0; i < m / 2; i++) {
      const a = arr[i]
      const b = arr[m - 1 - i]
      const match = makeMatch(r + 1, i + 1, a, b, { id: `RR-R${r + 1}-M${i + 1}`, group: 'RR' })
      if (a && b) match.roundName = `第 ${r + 1} 轮`
      else match.roundName = `第 ${r + 1} 轮`
      round.push(match)
    }
    // 轮转（固定首位）
    const fixed = arr[0]
    const rest = arr.slice(1)
    rest.unshift(rest.pop())
    arr.splice(0, arr.length, fixed, ...rest)
    rounds.push(round)
  }

  rounds.forEach((round) =>
    round.forEach((mt) => {
      const nullCount = mt.slots.filter((s) => s === null).length
      if (nullCount === 1) {
        mt.isBye = true
        mt.byeWinner = mt.slots.find((s) => s !== null)
        mt.status = 'bye'
        mt.winnerId = String(mt.byeWinner.id)
      }
    })
  )

  return {
    format: 'round_robin',
    participantCount: n,
    size: n,
    roundsCount: rounds.length,
    byes: hasBye ? 1 : 0,
    rounds,
    participants,
  }
}

// ============ 小组循环 + 出线淘汰赛 ============
// 规则：
//   1) 按分组数量把总人数尽可能平均分配（前 n%G 组各多 1 人）
//   2) 组内单循环：随机排位、每对仅交手一次（4 人组 = 3 轮；奇数人每轮 1 人轮空）
//   3) 出线：组内 <=4 人出 1 人，>=5 人出 2 人（按积分排序）
//   4) 出线者随机抽签进入单败淘汰赛（人数不足 2 的幂时首轮安排轮空）
export function generateGroupKnockout(input, options = {}) {
  const participants = normalizeParticipants(input)
  const n = participants.length
  if (n < 2) throw new Error('小组循环至少需要 2 人')

  // 分组数量：至少 2 组（人数不足则收敛），且保证每组不少于 2 人
  let G = Math.floor(Number(options.groupCount) || 0)
  if (G < 2) G = 2
  const maxG = Math.max(1, Math.floor(n / 2))
  if (G > maxG) G = maxG

  const groupKey = (i) => (i < 26 ? String.fromCharCode(65 + i) : `G${i + 1}`)

  // 1) 平均分组（参与者已随机打乱，组内再洗一次保证落位随机）
  const pool = shuffle(participants)
  const base = Math.floor(n / G)
  const rem = n % G
  const groups = []
  let cursor = 0
  for (let gi = 0; gi < G; gi++) {
    const size = base + (gi < rem ? 1 : 0)
    const members = shuffle(pool.slice(cursor, cursor + size))
    cursor += size
    groups.push({
      key: groupKey(gi),
      name: `${groupKey(gi)}组`,
      members,
      size,
      advance: size >= 5 ? 2 : 1, // 4 人及以下出 1 人，5 人及以上出 2 人
    })
  }

  // 2) 组内单循环（circle method，保证不重复交手）
  const groupRoundsOf = (g) => {
    const arr = g.members.slice()
    const hasBye = arr.length % 2 === 1
    const list = hasBye ? arr.concat([null]) : arr
    const m = list.length
    const rounds = []
    for (let r = 0; r < m - 1; r++) {
      const round = []
      for (let i = 0; i < m / 2; i++) {
        const a = list[i]
        const b = list[m - 1 - i]
        const mt = makeMatch(r + 1, i + 1, a, b, {
          id: `G${g.key}-R${r + 1}M${i + 1}`,
          group: g.name,
          stage: 'group',
        })
        mt.roundName = `${g.name} 第 ${r + 1} 轮`
        if (!a || !b) {
          mt.isBye = true
          mt.byeWinner = a || b
          mt.status = 'bye'
          mt.winnerId = String(mt.byeWinner.id)
        }
        round.push(mt)
      }
      // 轮转（固定首位）：生成下一轮不重复的对阵
      const fixed = list[0]
      const rest = list.slice(1)
      rest.unshift(rest.pop())
      list.splice(0, list.length, fixed, ...rest)
      rounds.push(round)
    }
    return rounds
  }
  groups.forEach((g) => (g.rounds = groupRoundsOf(g)))
  const groupRounds = groups.reduce((mx, g) => Math.max(mx, g.rounds.length), 0)

  // 3) 出线人数 + 淘汰赛树
  const qualifiedCount = groups.reduce((s, g) => s + g.advance, 0)
  const koSize = qualifiedCount >= 2 ? nextPow2(qualifiedCount) : 0
  const koRoundsCount = koSize ? Math.log2(koSize) : 0
  const koStartRound = groupRounds + 1
  const koByes = koSize ? koSize - qualifiedCount : 0
  const koRounds = []
  if (koSize) {
    const firstCount = koSize / 2
    const fullFirst = firstCount - koByes // 这些场次双人；其余场次单人（对手轮空）
    const first = []
    for (let i = 0; i < firstCount; i++) {
      const mt = makeMatch(koStartRound, i + 1, null, null, { id: `KO-R1-M${i + 1}`, stage: 'ko' })
      mt.byeSlot = i >= fullFirst
      mt.roundName = koRoundName(1, koRoundsCount)
      first.push(mt)
    }
    koRounds.push(first)
    for (let r = 2; r <= koRoundsCount; r++) {
      const prev = koRounds[r - 2]
      const next = []
      for (let j = 0; j < prev.length / 2; j++) {
        const mt = makeMatch(koStartRound + r - 1, j + 1, null, null, {
          id: `KO-R${r}-M${j + 1}`,
          stage: 'ko',
        })
        mt.roundName = koRoundName(r, koRoundsCount)
        prev[2 * j].nextMatchId = mt.id
        prev[2 * j].nextSlot = 'A'
        prev[2 * j + 1].nextMatchId = mt.id
        prev[2 * j + 1].nextSlot = 'B'
        next.push(mt)
      }
      koRounds.push(next)
    }
  }

  // 4) 汇总：按 round 编号分组（小组赛 1..groupRounds，淘汰赛紧随其后）
  const rounds = []
  groups.forEach((g) => {
    g.rounds.forEach((rr, ri) => {
      rounds[ri] = rounds[ri] || []
      rounds[ri].push(...rr)
    })
  })
  koRounds.forEach((rr, ri) => {
    rounds[groupRounds + ri] = rr
  })

  return {
    format: 'round_robin',
    participantCount: n,
    size: n,
    roundsCount: groupRounds + koRoundsCount,
    byes: 0,
    groupCount: G,
    groupRounds,
    koStartRound: koSize ? koStartRound : null,
    koSize,
    koByes,
    koRoundsCount,
    qualifiedCount,
    groups: groups.map((g) => ({
      key: g.key,
      name: g.name,
      size: g.size,
      advance: g.advance,
      memberIds: g.members.map((x) => String(x.id)),
      rounds: g.rounds,
    })),
    rounds,
    participants,
  }
}

// 淘汰赛轮次命名（相对淘汰赛自身轮数）
function koRoundName(koIdx, koRoundsCount) {
  const n = koRoundName2(koIdx, koRoundsCount)
  return `淘汰赛 · ${n}`
}
function koRoundName2(koIdx, koRoundsCount) {
  if (koIdx === koRoundsCount) return '决赛'
  if (koIdx === koRoundsCount - 1) return '半决赛'
  if (koIdx === koRoundsCount - 2) return '四分之一决赛'
  return `第 ${koIdx} 轮`
}

// ============ 瑞士轮 ============
// 首轮按种子顺序配对(1v2,3v4,...)，后续轮次在录入赛果后由服务端按积分动态生成（见 server/swissGen.js）。
export function generateSwiss(input, options = {}) {
  const participants = normalizeParticipants(input)
  const n = participants.length
  if (n < 2) throw new Error('瑞士轮至少需要 2 人')

  const total =
    options.rounds && options.rounds >= 1
      ? Math.min(options.rounds, n - 1)
      : Math.min(n - 1, Math.max(3, Math.ceil(Math.log2(n))))

  const sorted = participants.slice().sort((a, b) => a.seed - b.seed)
  const arr = sorted.slice()
  let byeP = null
  if (arr.length % 2 === 1) byeP = arr.pop()

  const first = []
  for (let i = 0; i < arr.length; i += 2) {
    first.push(makeMatch(1, i / 2 + 1, arr[i], arr[i + 1], { id: `SW-R1-M${i / 2 + 1}`, group: 'SW' }))
  }
  if (byeP) {
    const bm = makeMatch(1, first.length + 1, byeP, null, { id: `SW-R1-M${first.length + 1}`, group: 'SW' })
    bm.isBye = true
    bm.byeWinner = byeP
    bm.status = 'bye'
    bm.winnerId = String(byeP.id)
    first.push(bm)
  }
  first.forEach((m) => (m.roundName = '第 1 轮'))

  return {
    format: 'swiss',
    participantCount: n,
    size: n,
    roundsCount: total,
    swissRoundsTotal: total,
    byes: 0,
    rounds: [first],
    participants,
  }
}

// ============ 分发入口 ============
export function generateBracket(format, input, options = {}) {
  switch (format) {
    case 'single_elimination':
      return generateSingleElimination(input)
    case 'double_elimination':
      return generateDoubleElimination(input)
    case 'round_robin':
      // 带分组数量 => 小组循环 + 出线淘汰赛；否则退化为纯单循环
      return options.groupCount ? generateGroupKnockout(input, options) : generateRoundRobin(input)
    case 'swiss':
      return generateSwiss(input, options)
    default:
      throw new Error(`暂不支持的赛制: ${format}`)
  }
}

// 网页端下拉框数据源
export const SUPPORTED_FORMATS = [
  { value: 'single_elimination', label: '单败淘汰', desc: '一场定胜负，输即淘汰' },
  { value: 'double_elimination', label: '双败淘汰', desc: '输一场掉败者组，两败出局（建议人数为 2 的幂）' },
  { value: 'round_robin', label: '小组循环', desc: '单循环，按积分排名' },
  { value: 'swiss', label: '瑞士轮', desc: '每轮按积分配对，最终积分排名' },
]
