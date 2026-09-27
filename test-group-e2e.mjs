// 端到端验证：小组循环（分组数量 + 出线 + 随机抽签淘汰赛）
// 在本进程内启动真实服务，避免沙箱回收后台进程
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const NODE = 'C:/Users/29829/.workbuddy/binaries/node/versions/22.22.2-3/node.exe'
const ROOT = __dirname
const PORT = 3013

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
function ok(cond, msg) {
  if (cond) {
    pass++
    console.log('  ✓ ' + msg)
  } else {
    fail++
    console.log('  � ' + msg)
  }
}

function startServer() {
  const env = { ...process.env, PORT: String(PORT) }
  const child = spawn(NODE, ['--experimental-sqlite', 'server/index.js'], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', () => {})
  child.stderr.on('data', (d) => process.stderr.write('[srv] ' + d))
  return child
}

async function waitHealth() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://localhost:${PORT}/api/health`)
      if (r.ok) return true
    } catch {}
    await sleep(300)
  }
  return false
}

async function j(method, url, body, token) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const r = await fetch(`http://localhost:${PORT}${url}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  let data = null
  try {
    data = await r.json()
  } catch {}
  return { status: r.status, data }
}

const ts = Date.now()
const N = 20 // 总人数
const G = 4 // 分组数 → 每组 5 人 → 每组出线 2 人 → 出线 8 人

const run = async () => {
  const srv = startServer()
  try {
    if (!(await waitHealth())) {
      console.log('RESULT: 服务未启动')
      return
    }
    const admin = await j('POST', '/api/auth/login', { username: 'admin', password: 'admin123456' })
    if (admin.status !== 200) {
      console.log('RESULT: 管理员登录失败', admin)
      return
    }
    const at = admin.data.token

    // 1) 创建赛事：小组循环 + 4 组；小组赛无对阵制（直接录分），淘汰赛用无BP征服 BO3
    const create = await j(
      'POST',
      '/api/tournaments',
      {
        name: `小组循环E2E-${ts}`,
        description: '分组循环 + 出线淘汰',
        format: 'round_robin',
        maxParticipants: N,
        groupCount: G,
        groupMatchFormat: 'none',
        koMatchFormat: 'conquest_nobp_2d',
      },
      at
    )
    if (create.status !== 200) {
      console.log('RESULT: 创建失败', create)
      return
    }
    const tid = create.data.tournament.id
    ok(create.data.tournament.group_count === G, `创建成功：分组数 ${G}`)
    ok(create.data.tournament.group_match_format === 'none', '小组赛对阵制 = 无（直接录分）')
    ok(
      create.data.tournament.ko_match_format === 'conquest_nobp_2d',
      '淘汰赛对阵制 = 征服·BO3·2套(无BP)'
    )

    // 分组数量越界校验
    const bad = await j(
      'POST',
      '/api/tournaments',
      { name: `越界-${ts}`, format: 'round_robin', maxParticipants: 6, groupCount: 5 },
      at
    )
    ok(bad.status === 400, `分组数超过「每组至少2人」应报错（实际 ${bad.status}）`)
    const bad2 = await j(
      'POST',
      '/api/tournaments',
      { name: `缺分组-${ts}`, format: 'round_robin', maxParticipants: 8 },
      at
    )
    ok(bad2.status === 400, `小组循环缺分组数量应报错（实际 ${bad2.status}）`)

    // 2) 发布
    const pub = await j('POST', `/api/tournaments/${tid}/publish`, {}, at)
    ok(pub.status === 200, '赛事已发布')

    // 3) 报名 N 人（满员自动抽签）
    const tokens = []
    for (let i = 1; i <= N; i++) {
      const uname = `grp${ts}_${i}`
      const reg = await j('POST', '/api/auth/register', {
        username: uname,
        password: '123456',
        fullName: `选手${i}`,
      })
      if (reg.status !== 200) {
        console.log('注册失败', reg)
        return
      }
      tokens.push(reg.data.token)
    }
    for (let i = 0; i < N; i++) {
      const r = await j('POST', `/api/tournaments/${tid}/register`, {}, tokens[i])
      if (r.status !== 200 && !r.data?.auto) {
        console.log('报名失败', i, r)
        return
      }
    }
    console.log(`  · ${N} 人报名完成（满员自动抽签）`)

    // 4) 校验抽签结果
    const det = await j('GET', `/api/tournaments/${tid}`, null, at)
    const t = det.data.tournament
    ok(t.status === 'ongoing', '赛事已进行中')
    ok(t.bracket.groups && t.bracket.groups.length === G, `生成 ${G} 个小组`)
    ok(
      t.bracket.groups.every((g) => g.size === 5),
      `每组 5 人（实际 ${t.bracket.groups.map((g) => g.size).join('/')}）`
    )
    ok(
      t.bracket.groups.every((g) => g.advance === 2),
      '每组 5 人 → 出线 2 人'
    )
    ok(t.bracket.qualifiedCount === 8, `共出线 8 人（实际 ${t.bracket.qualifiedCount}）`)
    const groupMatches = t.bracket.groups.flatMap((g) => g.rounds.flat())
    const realGroupMatches = groupMatches.filter((m) => m.status !== 'bye')
    ok(
      realGroupMatches.length === G * 10,
      `小组赛真实场数 ${G}×10=${G * 10}（实际 ${realGroupMatches.length}，另含 ${
        groupMatches.length - realGroupMatches.length
      } 场奇数轮空）`
    )
    ok(t.bracket.groups.every((g) => g.rounds.length === 5), '每组 5 轮（5 人单循环）')
    const koMatches = t.bracket.rounds.flat()
    ok(koMatches.length === 7, `淘汰赛 7 场（4+2+1，实际 ${koMatches.length}）`)
    ok(koMatches.every((m) => m.matchFormat === 'conquest_nobp_2d'), '淘汰赛使用 BO3·2套(无BP)')
    ok(
      groupMatches.every((m) => !m.matchFormat || m.matchFormat === 'none'),
      '小组赛使用直接录分（无对阵制）'
    )
    // 组内不重复交手
    let dup = 0
    t.bracket.groups.forEach((g) => {
      const seen = new Set()
      g.rounds.flat().forEach((m) => {
        if (!m.slots[0]?.id || !m.slots[1]?.id) return
        const k = [String(m.slots[0].id), String(m.slots[1].id)].sort().join('-')
        if (seen.has(k)) dup++
        seen.add(k)
      })
    })
    ok(dup === 0, '组内无重复对阵')

    // 5) 录入小组赛全部赛果（固定让 A 位胜）
    const recResults = []
    for (const g of t.bracket.groups) {
      for (const m of g.rounds.flat()) {
        if (m.status === 'bye') continue
        const r = await j(
          'POST',
          `/api/matches/${tid}-${m.id}/result`,
          { scoreA: 1, scoreB: 0 },
          at
        )
        recResults.push(r.status)
      }
    }
    ok(recResults.every((s) => s === 200), '小组赛全部录分成功')

    // 6) 校验出线与随机抽签
    const det2 = await j('GET', `/api/tournaments/${tid}`, null, at)
    const t2 = det2.data.tournament
    const koFirst = t2.bracket.rounds[0] || []
    ok(koFirst.every((m) => m.slots[0] && m.slots[1]), '淘汰赛首轮 8 个席位已填满')
    const koIds = koFirst.flatMap((m) => [m.slots[0]?.id, m.slots[1]?.id]).filter(Boolean)
    ok(new Set(koIds.map(String)).size === 8, '出线 8 人互不重复')
    ok(t2.status === 'ongoing', '小组赛结束后赛事仍在进行（进入淘汰赛）')
    ok(
      t2.bracket.groups.every((g) => g.qualifiedIds.length === 2),
      '每组已标出 2 名出线选手'
    )

    // 7) 淘汰赛：无BP对阵制走「选手提交赛果 + 管理员确认」
    async function confirmKo(m) {
      const aTok = tokens.find((_, i) => true) // 占位，下面用选手 token 映射
      void aTok
      const idA = String(m.slots[0].id)
      const idB = String(m.slots[1].id)
      const mapName = (id) => {
        for (const g of t2.bracket.groups) {
          const p = (g.standings || []).find((x) => String(x.id) === id)
          if (p) return p
        }
        return null
      }
      void mapName
      // 找到两位选手的 token（报名顺序与 tokens 顺序一致：grp{ts}_i ↔ 选手 i）
      const idxOf = (id) => {
        // 用积分榜 id 反查用户名序号
        return Number(id)
      }
      void idxOf
      return { idA, idB }
    }
    void confirmKo

    // 用管理员代替选手提交（管理员可指定 side）
    async function playKo(roundIdx) {
      const d = await j('GET', `/api/tournaments/${tid}`, null, at)
      const round = d.data.tournament.bracket.rounds[roundIdx] || []
      for (const m of round) {
        if (!m.slots[0] || !m.slots[1]) continue
        for (const side of ['A', 'B']) {
          await j(
            'POST',
            `/api/matches/${tid}-${m.id}/result-submit`,
            { side, games: [{ winnerSide: 'A', winnerDeck: 0, loserDeck: 0 }] },
            at
          )
        }
        const c = await j(
          'POST',
          `/api/matches/${tid}-${m.id}/admin-confirm`,
          { winnerSide: 'A' },
          at
        )
        if (c.status !== 200) {
          console.log('确认失败', m.id, c)
          return false
        }
      }
      return true
    }
    ok(await playKo(0), '淘汰赛首轮 4 场完成')
    ok(await playKo(1), '半决赛 2 场完成')
    ok(await playKo(2), '决赛完成')

    const fin = await j('GET', `/api/tournaments/${tid}`, null, at)
    const t3 = fin.data.tournament
    ok(t3.status === 'finished', `赛事已结束（实际 ${t3.status}）`)
    ok(!!t3.champion, `产生冠军：${t3.champion?.name || '无'}`)

    // 8) 清理测试数据
    await j('DELETE', `/api/tournaments/${tid}`, {}, at)
    console.log('  · 已清理测试赛事')
  } finally {
    srv.kill()
  }
  console.log(`\n小组循环 E2E：${pass} 项通过，${fail} 项失败`)
  process.exit(fail ? 1 : 0)
}

run()
