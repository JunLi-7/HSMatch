// 小组循环 + 出线淘汰赛 算法自检
import { generateGroupKnockout } from './src/lib/bracket.js'

let pass = 0
let fail = 0
function ok(cond, msg) {
  if (cond) {
    pass++
  } else {
    fail++
    console.log('  ✗ ' + msg)
  }
}

function build(n, groupCount) {
  const ps = []
  for (let i = 1; i <= n; i++) ps.push({ id: String(i), name: `选手${i}`, seed: i })
  return generateGroupKnockout(ps, { groupCount })
}

// 1) 分组尽量平均
for (const [n, g] of [
  [32, 8],
  [20, 6],
  [23, 5],
  [17, 4],
  [12, 5],
]) {
  const b = build(n, g)
  const sizes = b.groups.map((x) => x.size)
  const mx = Math.max(...sizes)
  const mn = Math.min(...sizes)
  ok(sizes.reduce((a, c) => a + c, 0) === n, `${n}人/${g}组：总人数守恒 (${sizes})`)
  ok(mx - mn <= 1, `${n}人/${g}组：分组尽量平均 (${sizes})`)
  ok(b.groups.length === g, `${n}人/${g}组：组数正确`)
}

// 2) 组内单循环：每对恰好交手一次，且无自交手
{
  const b = build(24, 6)
  b.groups.forEach((g) => {
    const pairs = new Set()
    let cnt = 0
    g.rounds.forEach((rr) =>
      rr.forEach((m) => {
        if (!m.slots[0] || !m.slots[1]) return // 轮空场
        cnt++
        const [x, y] = [String(m.slots[0].id), String(m.slots[1].id)].sort()
        ok(x !== y, `${g.name}：不应与自己交手`)
        const key = `${x}-${y}`
        ok(!pairs.has(key), `${g.name}：${key} 不应重复交手`)
        pairs.add(key)
      })
    )
    const expect = (g.size * (g.size - 1)) / 2
    ok(pairs.size === expect, `${g.name}：应产生 ${expect} 组不重复对阵，实际 ${pairs.size}`)
    ok(cnt === expect, `${g.name}：场数应为 ${expect}，实际 ${cnt}`)
  })
}

// 3) 4 人组 = 3 轮；5 人组 = 5 轮（含轮空）；6 人组 = 5 轮
{
  const b = build(24, 6) // 每组 4 人
  ok(b.groupRounds === 3, `4人组应为 3 轮，实际 ${b.groupRounds}`)
  const b2 = build(30, 6) // 每组 5 人
  ok(b2.groupRounds === 5, `5人组应为 5 轮，实际 ${b2.groupRounds}`)
}

// 4) 出线人数：<=4 出 1，>=5 出 2
{
  const b = build(32, 8) // 8 组 × 4 人
  ok(b.groups.every((g) => g.advance === 1), '4人组出线 1 人')
  ok(b.qualifiedCount === 8, `32人8组应出线 8 人，实际 ${b.qualifiedCount}`)
  ok(b.koSize === 8, `淘汰赛规模应为 8，实际 ${b.koSize}`)
  ok(b.koByes === 0, '8 强不应有轮空')

  const b2 = build(20, 4) // 4 组 × 5 人
  ok(b2.groups.every((g) => g.advance === 2), '5人组出线 2 人')
  ok(b2.qualifiedCount === 8, `20人4组应出线 8 人，实际 ${b2.qualifiedCount}`)

  const b3 = build(14, 3) // 5/5/4 人 → 2+2+1 = 5 人出线
  ok(b3.qualifiedCount === 5, `14人3组应出线 5 人，实际 ${b3.qualifiedCount}`)
  ok(b3.koSize === 8, '出线 5 人应补齐到 8 强')
  ok(b3.koByes === 3, `出线 5 人应有 3 个轮空，实际 ${b3.koByes}`)
}

// 5) 淘汰赛树结构：场数递减、链路闭合、末轮为决赛
{
  const b = build(32, 8)
  const ko = b.rounds.slice(b.groupRounds)
  ok(ko.length === 3, `8 强应有 3 轮淘汰，实际 ${ko.length}`)
  ok(ko[0].length === 4 && ko[1].length === 2 && ko[2].length === 1, '淘汰赛场数应 4→2→1')
  ok(ko[2][0].roundName.includes('决赛'), '末轮应为决赛')
  const ids = new Set(b.rounds.flat().map((m) => m.id))
  b.rounds.flat().forEach((m) => {
    if (m.nextMatchId) ok(ids.has(m.nextMatchId), `${m.id} 的下一场 ${m.nextMatchId} 应存在`)
  })
  // 首轮 4 场全部指向半决赛的 2 场
  ok(new Set(ko[0].map((m) => m.nextMatchId)).size === 2, '首轮 4 场应汇入 2 场半决赛')
}

// 6) 轮空场数量与分布（首轮末尾为轮空场）
{
  const b = build(14, 3) // 出线 5 人 → size 8，首轮 4 场，其中 3 场轮空
  const firstKo = b.rounds[b.groupRounds]
  ok(firstKo.length === 4, '首轮应有 4 场')
  const byeMatches = firstKo.filter((m) => m.byeSlot)
  ok(byeMatches.length === 3, `应有 3 个轮空场，实际 ${byeMatches.length}`)
  ok(
    firstKo.map((m) => !!m.byeSlot).join(',') === 'false,true,true,true',
    '轮空场应集中在首轮末尾'
  )
}

// 7) 小组赛与淘汰赛的 round 编号连续且不冲突
{
  const b = build(23, 5)
  const all = b.rounds.flat()
  const groupMs = all.filter((m) => m.stage === 'group')
  const koMs = all.filter((m) => m.stage === 'ko')
  ok(groupMs.every((m) => m.round <= b.groupRounds), '小组赛轮次不超过 groupRounds')
  ok(koMs.every((m) => m.round > b.groupRounds), '淘汰赛轮次应在小组赛之后')
  ok(koMs.length > 0, '应生成淘汰赛')
  ok(new Set(all.map((m) => m.id)).size === all.length, '比赛 id 应唯一')
}

// 8) 分组数量越界收敛
{
  const b = build(6, 10) // 每组至少 2 人 → 最多 3 组
  ok(b.groups.length === 3, `6 人最多分 3 组，实际 ${b.groups.length}`)
  const b2 = build(3, 4)
  ok(b2.groups.every((g) => g.size >= 1), '3 人应能分组')
}

console.log(`\n小组循环+淘汰赛算法：${pass} 项通过，${fail} 项失败`)
process.exit(fail ? 1 : 0)
