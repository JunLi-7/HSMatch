// 对阵算法单元测试（含对阵链路模拟）
import {
  generateSingleElimination,
  generateDoubleElimination,
  generateRoundRobin,
  generateSwiss,
} from './bracket.js'

let passed = 0
let failed = 0
function assert(cond, msg) {
  if (cond) {
    passed++
  } else {
    failed++
    console.error('  ✗ FAIL:', msg)
  }
}

function realMatches(bracket) {
  // 排除轮空场
  return bracket.rounds.flat().filter((m) => !m.isBye)
}

// 模拟把整张对阵图打完：每场都让“种子号更小者”获胜（确定性）
function simulate(bracket) {
  const matches = bracket.rounds.flat().map((m) => ({ ...m, slots: m.slots.slice() }))
  const byId = {}
  matches.forEach((m) => (byId[m.id] = m))

  let guard = 0
  while (guard++ < 10000) {
    const pending = matches.filter(
      (m) => m.status !== 'done' && m.status !== 'bye' && m.slots[0] && m.slots[1]
    )
    if (!pending.length) break
    const m = pending[0]
    const a = m.slots[0]
    const b = m.slots[1]
    const winner = a.seed <= b.seed ? a : b
    const loser = winner === a ? b : a
    m.status = 'done'
    m.winnerId = String(winner.id)
    if (m.nextMatchId) {
      const nxt = byId[m.nextMatchId]
      nxt.slots[m.nextSlot === 'B' ? 1 : 0] = winner
    }
    if (m.loserNextMatchId) {
      const nxt = byId[m.loserNextMatchId]
      nxt.slots[m.loserNextSlot === 'B' ? 1 : 0] = loser
    }
  }
  return { matches, byId }
}

// ---------- 单败淘汰 ----------
for (const n of [1, 2, 3, 4, 5, 8, 10]) {
  const b = generateSingleElimination(n)
  const rm = realMatches(b)
  assert(b.size === (n <= 1 ? 1 : Math.pow(2, Math.ceil(Math.log2(n)))), `单败 n=${n} size 正确`)
  assert(rm.length === (n <= 1 ? 0 : n - 1), `单败 n=${n} 真实场数=n-1 (实际 ${rm.length})`)
  if (n >= 2) {
    const { matches } = simulate(b)
    const finals = matches.filter((m) => !m.nextMatchId && !m.loserNextMatchId)
    assert(finals.length === 1 && finals[0].status === 'done', `单败 n=${n} 仅决赛无后继且已完成`)
  }
}

// ---------- 双败淘汰 ----------
for (const n of [2, 3, 4, 5, 8]) {
  const b = generateDoubleElimination(n)
  const rm = realMatches(b)
  const expected = 2 * b.size - 2 // 2 的幂时真实场数
  assert(rm.length === expected, `双败 n=${n} 真实场数=2*size-2 (实际 ${rm.length}, size=${b.size})`)
  // WB 每场(非轮空、非决赛)应有 loserNextMatchId；WB 决赛(next 为 GF)除外
  const wb = b.rounds.flat().filter((m) => m.group === 'WB' && !m.isBye)
  wb.forEach((m) => {
    const isWBFinal = m.nextMatchId === 'GF-M1'
    if (!isWBFinal) assert(!!m.loserNextMatchId, `双败 n=${n} WB 非决赛场应有败者掉入链路 (${m.id})`)
  })
  // GF 无后继
  const gf = b.rounds.flat().find((m) => m.group === 'GF')
  assert(gf && !gf.nextMatchId, `双败 n=${n} 总决赛无后继`)
  const { matches, byId } = simulate(b)
  const champs = matches.filter((m) => m.group === 'GF' && m.status === 'done')
  assert(champs.length === 1, `双败 n=${n} 总决赛产生冠军`)
}

// ---------- 小组循环 ----------
for (const n of [2, 3, 4, 5, 6]) {
  const b = generateRoundRobin(n)
  const rm = realMatches(b)
  const expected = (n * (n - 1)) / 2
  assert(rm.length === expected, `循环 n=${n} 场数=n(n-1)/2 (实际 ${rm.length})`)
  assert(b.roundsCount === (n % 2 === 0 ? n - 1 : n), `循环 n=${n} 轮数正确`)
  // 每对选手恰好交手一次
  const played = new Set()
  b.rounds.flat().forEach((m) => {
    if (!m.isBye && m.slots[0] && m.slots[1]) {
      const k = [m.slots[0].id, m.slots[1].id].sort().join('|')
      played.add(k)
    }
  })
  assert(played.size === expected, `循环 n=${n} 每对恰好交手一次`)
}

// ---------- 瑞士轮 ----------
for (const n of [2, 3, 4, 5, 8, 10]) {
  const b = generateSwiss(n)
  assert(b.rounds.length === 1, `瑞士 n=${n} 初始仅生成第 1 轮`)
  assert(b.swissRoundsTotal >= 1 && b.swissRoundsTotal <= n - 1, `瑞士 n=${n} 总轮数合理 (${b.swissRoundsTotal})`)
  const rm = realMatches(b)
  assert(rm.length === Math.floor(n / 2), `瑞士 n=${n} 首轮真实场数=floor(n/2) (实际 ${rm.length})`)
}

console.log(`\n通过 ${passed} 项，失败 ${failed} 项`)
process.exit(failed ? 1 : 0)
