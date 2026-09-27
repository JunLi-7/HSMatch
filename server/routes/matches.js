// 比赛赛果录入：按赛制判定胜者 / 积分 / 晋级 / 收官
//
// 两类赛事：
//   1) 无对阵制（match_format=none）：管理员直接录总比分 / 胜者（原逻辑）
//   2) 有对阵制（炉石 Ban/Pick）：
//      - 选手网页端自主完成「先填卡组 → 再禁对手卡组」两阶段 BP（双方同时、公布）
//      - 选手赛后手动提交逐局赛果（系统不做任何处理，仅完整保存）
//      - 双方提交后，只有管理员可查看并确认；管理员确认无误才判定晋级
//      - 两边提交不一致时系统不自动处理，交由管理员裁定（驳回重交 / 指定胜方确认）
import express from 'express'
import db from '../db.js'
import { requireAuth, requireAdmin } from '../middleware.js'
import { generateSwissNextRound } from '../swissGen.js'
import { matchFormatMeta } from '../../src/lib/matchFormats.js'
import { evaluateSeries } from '../../src/lib/series.js'
import { computeStandings } from '../../src/lib/standings.js'

const router = express.Router()
router.use(requireAuth)

function shortId(full) {
  return full ? full.substring(full.indexOf('-') + 1) : null
}
function getMatch(id) {
  return db.prepare('SELECT * FROM matches WHERE id = ?').get(id)
}
function getTournament(id) {
  return db.prepare('SELECT * FROM tournaments WHERE id = ?').get(id)
}
function sideOfUser(m, userId) {
  const a = m.slot_a ? JSON.parse(m.slot_a) : null
  const b = m.slot_b ? JSON.parse(m.slot_b) : null
  if (a && String(a.id) === String(userId)) return 'A'
  if (b && String(b.id) === String(userId)) return 'B'
  return null
}
function bpFromMatch(m, t) {
  // ban 集合：旧版单 ban（bo3/bo5）；战队赛额外含 ban2 集合
  const aBanned = []
  const bBanned = []
  if (m.bp_b_ban != null) aBanned.push(m.bp_b_ban)
  if (m.bp_a_ban != null) bBanned.push(m.bp_a_ban)
  const tMf = t ? t.match_format : null
  if (tMf === 'team_kof') {
    if (m.bp_b_ban2) JSON.parse(m.bp_b_ban2).forEach((x) => aBanned.push(x))
    if (m.bp_a_ban2) JSON.parse(m.bp_a_ban2).forEach((x) => bBanned.push(x))
  }
  return {
    aDecks: m.bp_a_decks ? JSON.parse(m.bp_a_decks) : [],
    aBan: m.bp_a_ban,
    bDecks: m.bp_b_decks ? JSON.parse(m.bp_b_decks) : [],
    bBan: m.bp_b_ban,
    aBanned,
    bBanned,
    revealed: !!m.bp_revealed,
  }
}

// 该场对阵制描述符（优先每场自带 bo/ban/deck，回退赛事级命名格式做兼容）
function matchOf(m, t) {
  const mf = m.match_format || (t && t.match_format) || 'none'
  const rule = m.rule || (t && t.rule) || null
  const isTeam = mf === 'team_kof'
  const deckCount = m.deck_count != null ? m.deck_count : matchFormatMeta(mf)?.totalDecks || 0
  const ban = m.ban_count != null ? m.ban_count : matchFormatMeta(mf)?.ban || 0
  const bo = m.bo != null ? m.bo : matchFormatMeta(mf)?.bo || (isTeam ? 11 : 0)
  const noBP = !isTeam && ban === 0
  return { mf, rule, meta: { totalDecks: deckCount, ban, bo, isTeam, noBP } }
}

// 双方逐局提交是否逐局一致（用于确认时判断是否可自动判定）
function gamesAgree(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return false
  return a.every(
    (g, i) =>
      g.winnerSide === b[i].winnerSide && g.winnerDeck === b[i].winnerDeck && g.loserDeck === b[i].loserDeck
  )
}

// 把胜者/败者填入目标比赛槽位
function fillSlot(matchId, slot, player) {
  const m = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId)
  if (!m) return
  const col = slot === 'B' ? 'slot_b' : 'slot_a'
  db.prepare(`UPDATE matches SET ${col} = @v WHERE id = @id`).run({ v: JSON.stringify(player), id: matchId })
}

function finishWithChampion(tournamentId, winner) {
  const row = db.prepare('SELECT bracket_json FROM tournaments WHERE id = ?').get(tournamentId)
  const b = row.bracket_json ? JSON.parse(row.bracket_json) : {}
  b.champion = winner
  db.prepare('UPDATE tournaments SET status = ?, bracket_json = ? WHERE id = ?').run(
    'finished',
    JSON.stringify(b),
    tournamentId
  )
}

// 单场 -> 积分榜输入行
function standingRow(r) {
  return {
    status: r.status,
    slotA: r.slot_a ? JSON.parse(r.slot_a) : null,
    slotB: r.slot_b ? JSON.parse(r.slot_b) : null,
    scoreA: r.score_a,
    scoreB: r.score_b,
  }
}

// 洗牌（出线者随机抽签进入淘汰赛）
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

// 小组循环 + 出线淘汰赛：小组赛全部结束后，按积分取每组前 N 名，随机抽签落位淘汰赛
function tryAdvanceFromGroups(t) {
  const plan = t.bracket_json ? JSON.parse(t.bracket_json) : null
  if (!plan || !plan.groups || !plan.groups.length) return
  const groupRows = db
    .prepare("SELECT * FROM matches WHERE tournament_id = ? AND stage = 'group'")
    .all(t.id)
  if (!groupRows.length) return
  if (!groupRows.every((r) => r.status === 'done' || r.status === 'bye')) return
  // 已抽过签则不重复（首轮已有选手）
  const koFirst = db
    .prepare('SELECT * FROM matches WHERE tournament_id = ? AND stage = ? AND round = ? ORDER BY match_index')
    .all(t.id, 'ko', plan.koStartRound)
  if (!koFirst.length) return
  if (koFirst.some((r) => r.slot_a || r.slot_b)) return

  const qualifiers = []
  plan.groups.forEach((g) => {
    const gRows = groupRows.filter((r) => r.group_name === g.name)
    const st = computeStandings(g.participants || [], gRows.map(standingRow))
    st.slice(0, g.advance).forEach((x) => qualifiers.push({ id: String(x.id), name: x.name }))
  })
  if (!qualifiers.length) return
  if (qualifiers.length === 1) {
    finishWithChampion(t.id, qualifiers[0])
    return
  }

  const picked = shuffle(qualifiers)
  const fullFirst = Math.floor((plan.koSize || 0) / 2) - (plan.koByes || 0)
  const tx = db.transaction(() => {
    let i = 0
    koFirst.forEach((m, idx) => {
      const a = picked[i++]
      const b = idx < fullFirst ? picked[i++] : null
      if (!a) return
      db.prepare('UPDATE matches SET slot_a = @a, slot_b = @b WHERE id = @id').run({
        a: JSON.stringify(a),
        b: b ? JSON.stringify(b) : null,
        id: m.id,
      })
      if (!b) {
        // 轮空场：直接晋级
        db.prepare("UPDATE matches SET status = 'bye', winner_id = @w WHERE id = @id").run({
          w: String(a.id),
          id: m.id,
        })
        if (m.next_match_id) fillSlot(m.next_match_id, m.next_slot, a)
      }
    })
  })
  tx()
}

function handleGroupOrSwiss(t, m) {
  // 小组循环（带分组）：小组赛阶段先做出线抽签，不直接收官
  if (t.format === 'round_robin' && m.stage === 'group' && t.group_count) {
    tryAdvanceFromGroups(t)
    return
  }
  const rows = db.prepare('SELECT * FROM matches WHERE tournament_id = ? AND round = ?').all(t.id, m.round)
  const allDone = rows.every((r) => r.status === 'done' || r.status === 'bye')
  if (!allDone) return
  if (t.format === 'round_robin') {
    db.prepare("UPDATE tournaments SET status = 'finished' WHERE id = ?").run(t.id)
  } else if (t.format === 'swiss') {
    const plan = JSON.parse(t.bracket_json)
    if (m.round >= plan.swissRoundsTotal) {
      db.prepare("UPDATE tournaments SET status = 'finished' WHERE id = ?").run(t.id)
    } else {
      generateSwissNextRound(t.id)
    }
  }
}

// 统一收官：写胜者 + 计分 + 晋级/积分联动（仅在管理员确认后调用）
function finalizeMatch(t, m, winner, scoreA, scoreB) {
  const tx = db.transaction(() => {
    db.prepare(
      "UPDATE matches SET status = 'done', winner_id = @w, score_a = @a, score_b = @b WHERE id = @id"
    ).run({ w: winner ? String(winner.id) : null, a: scoreA ?? null, b: scoreB ?? null, id: m.id })

    if (t.format === 'round_robin' && m.stage === 'ko') {
      // 出线淘汰赛：单败，胜者晋级；决赛无下一场即为冠军
      if (m.next_match_id) fillSlot(m.next_match_id, m.next_slot, winner)
      if (!m.next_match_id) finishWithChampion(t.id, winner)
    } else if (t.format === 'single_elimination' || t.format === 'double_elimination') {
      if (m.next_match_id) fillSlot(m.next_match_id, m.next_slot, winner)
      if (t.format === 'double_elimination' && m.loser_next_match_id && winner) {
        const loser = winner === JSON.parse(m.slot_a) ? JSON.parse(m.slot_b) : JSON.parse(m.slot_a)
        fillSlot(m.loser_next_match_id, m.loser_next_slot, loser)
      }
      if (!m.next_match_id) finishWithChampion(t.id, winner)
    } else {
      handleGroupOrSwiss(t, m)
    }
  })
  tx()
}

// ---------- 无对阵制：管理员直接录比分 / 胜者 ----------
router.post('/:id/result', (req, res) => {
  const m = getMatch(req.params.id)
  if (!m) return res.status(404).json({ error: '比赛不存在' })
  const t = getTournament(m.tournament_id)
  // 按「本场」对阵制判断（小组赛/淘汰赛可能各用一套）
  const mfThis = m.match_format || t.match_format
  if (mfThis && mfThis !== 'none') {
    return res.status(400).json({ error: '该场使用对阵制，请由选手提交赛果后管理员确认' })
  }
  if (req.user.role !== 'admin') return res.status(403).json({ error: '仅管理员可录入赛果' })
  if (m.status === 'bye') return res.status(400).json({ error: '轮空场无需录入' })
  if (m.status === 'done') return res.status(400).json({ error: '该场赛果已录入' })

  const { scoreA, scoreB, winnerId } = req.body || {}
  const slotA = m.slot_a ? JSON.parse(m.slot_a) : null
  const slotB = m.slot_b ? JSON.parse(m.slot_b) : null
  if (!slotA || !slotB) return res.status(400).json({ error: '对阵未确定，暂不能录入' })

  const format = t.format
  let winner
  const a = Number(scoreA)
  const b = Number(scoreB)
  if (winnerId) {
    if (String(winnerId) !== String(slotA.id) && String(winnerId) !== String(slotB.id)) {
      return res.status(400).json({ error: '胜者必须是本场参赛方' })
    }
    winner = String(winnerId) === String(slotA.id) ? slotA : slotB
  } else {
    if (Number.isNaN(a) || Number.isNaN(b)) return res.status(400).json({ error: '比分必须为数字' })
    const isKnockout =
      format === 'single_elimination' || format === 'double_elimination' || m.stage === 'ko'
    if (isKnockout) {
      if (a === b) return res.status(400).json({ error: '淘汰赛不允许平局' })
      winner = a > b ? slotA : slotB
    } else {
      winner = a === b ? null : a > b ? slotA : slotB
    }
  }
  finalizeMatch(t, m, winner, scoreA ?? null, scoreB ?? null)
  res.json({ ok: true, winner: winner || null })
})

// ============================================================
// 有对阵制（炉石）：选手端自主 BP + 手动提交赛果 + 管理员确认
// ============================================================

// 选手/管理员确定要操作的“一方”（选手只能操作自己所在方；管理员可指定 side）
function resolveSide(m, body, user) {
  if (user.role === 'admin' && body && body.side && (body.side === 'A' || body.side === 'B')) return body.side
  const my = sideOfUser(m, user.id)
  if (!my) return null
  return my
}

// 阶段 1：提交卡组（盲填，双方齐后公布卡组）
router.post('/:id/bp-decks', (req, res) => {
  const m = getMatch(req.params.id)
  if (!m) return res.status(404).json({ error: '比赛不存在' })
  const t = getTournament(m.tournament_id)
  const { mf, meta } = matchOf(m, t)
  if (!mf || mf === 'none') return res.status(400).json({ error: '该赛事无对阵制' })
  if (mf === 'team_kof') return res.status(400).json({ error: '战队赛无需提交卡组，直接进入 BP 阶段' })
  if (meta?.noBP) return res.status(400).json({ error: '该赛事无需 Ban/Pick，请直接提交赛果' })
  if (m.status === 'done' || m.status === 'bye') return res.status(400).json({ error: '该场已结束' })
  if (m.bp_revealed) return res.status(400).json({ error: 'BP 已公布，不可再修改卡组' })

  const { decks } = req.body || {}
  const side = resolveSide(m, req.body, req.user)
  if (!side) return res.status(403).json({ error: '你不是本场参赛方' })

  if (!Array.isArray(decks) || decks.length !== meta.totalDecks) {
    return res.status(400).json({ error: `需提交 ${meta.totalDecks} 套卡组（一个职业一套）` })
  }
  const cleaned = decks.map((x) => String(x).trim()).filter(Boolean)
  if (cleaned.length !== meta.totalDecks) return res.status(400).json({ error: '卡组不能为空' })
  if (new Set(cleaned).size !== cleaned.length) return res.status(400).json({ error: '同一套卡组（职业）不可重复' })

  const colDecks = side === 'A' ? 'bp_a_decks' : 'bp_b_decks'
  db.prepare(`UPDATE matches SET ${colDecks} = @d WHERE id = @id`).run({ d: JSON.stringify(cleaned), id: m.id })

  const updated = getMatch(m.id)
  const aReady = !!updated.bp_a_decks
  const bReady = !!updated.bp_b_decks
  if (aReady && bReady) {
    db.prepare("UPDATE matches SET bp_decks_revealed = 1, deck_phase = 'bp_bans' WHERE id = ?").run(m.id)
  }
  res.json({ ok: true, decksRevealed: !!updated.bp_decks_revealed })
})

// 阶段 2：禁掉对手卡组（卡组已公布，双方齐后公布完整 BP）
router.post('/:id/bp-ban', (req, res) => {
  const m = getMatch(req.params.id)
  if (!m) return res.status(404).json({ error: '比赛不存在' })
  const t = getTournament(m.tournament_id)
  const { mf, meta } = matchOf(m, t)
  if (!mf || mf === 'none') return res.status(400).json({ error: '该赛事无对阵制' })
  if (meta?.noBP) return res.status(400).json({ error: '该赛事无需 Ban/Pick，请直接提交赛果' })
  if (m.status === 'done' || m.status === 'bye') return res.status(400).json({ error: '该场已结束' })
  if (!m.bp_decks_revealed) return res.status(400).json({ error: '请先双方提交卡组并公布后再禁用' })
  if (m.bp_revealed) return res.status(400).json({ error: 'BP 已公布，不可再修改' })

  const { ban } = req.body || {}
  const side = resolveSide(m, req.body, req.user)
  if (!side) return res.status(403).json({ error: '你不是本场参赛方' })

  const bi = Number(ban)
  if (!Number.isInteger(bi) || bi < 0 || bi >= meta.totalDecks) {
    return res.status(400).json({ error: 'ban 下标不合法' })
  }

  const colBan = side === 'A' ? 'bp_a_ban' : 'bp_b_ban'
  db.prepare(`UPDATE matches SET ${colBan} = @b WHERE id = @id`).run({ b: bi, id: m.id })

  const updated = getMatch(m.id)
  const aReady = updated.bp_a_ban != null
  const bReady = updated.bp_b_ban != null
  if (aReady && bReady) {
    db.prepare("UPDATE matches SET bp_revealed = 1, deck_phase = 'playing' WHERE id = ?").run(m.id)
  }
  res.json({ ok: true, revealed: !!updated.bp_revealed })
})

// ============================================================
// 战队赛（team_kof）BP 三阶段：ban1 → 保护 → ban2
// 双方各完成当前阶段后推进；ban2 双方完成后完整公布 BP，进入比赛
// ban1 禁 1 套、保护 1 套（免疫 ban、可出战）、ban2 禁 2 套，共 ban 3 套、剩 8 套可用
// ============================================================
const TEAM_STEPS = ['ban1', 'protect', 'ban2']
const TEAM_NEXT = { ban1: 'team_protect', protect: 'team_ban2', ban2: 'playing' }

function teamVal(m, side, step) {
  const col = side === 'A' ? 'a' : 'b'
  if (step === 'ban1') return col === 'a' ? m.bp_a_ban : m.bp_b_ban
  if (step === 'protect') return col === 'a' ? m.bp_a_protect : m.bp_b_protect
  if (step === 'ban2') {
    const raw = col === 'a' ? m.bp_a_ban2 : m.bp_b_ban2
    return raw ? JSON.parse(raw) : null
  }
  return null
}
function teamSet(m, side, step, val) {
  const col = side === 'A' ? 'a' : 'b'
  if (step === 'ban1') db.prepare(`UPDATE matches SET bp_${col}_ban = @v WHERE id = @id`).run({ v: val, id: m.id })
  else if (step === 'protect') db.prepare(`UPDATE matches SET bp_${col}_protect = @v WHERE id = @id`).run({ v: val, id: m.id })
  else if (step === 'ban2') db.prepare(`UPDATE matches SET bp_${col}_ban2 = @v WHERE id = @id`).run({ v: JSON.stringify(val), id: m.id })
}

router.post('/:id/bp-team', (req, res) => {
  const m = getMatch(req.params.id)
  if (!m) return res.status(404).json({ error: '比赛不存在' })
  const t = getTournament(m.tournament_id)
  if (!t || t.match_format !== 'team_kof') return res.status(400).json({ error: '该赛事非战队赛' })
  if (m.status === 'done' || m.status === 'bye') return res.status(400).json({ error: '该场已结束' })
  if (m.bp_revealed) return res.status(400).json({ error: 'BP 已公布，不可再修改' })

  const { step } = req.body || {}
  if (!TEAM_STEPS.includes(step)) return res.status(400).json({ error: '无效的 BP 阶段' })
  const expectedPhase = 'team_' + step
  if (m.deck_phase !== expectedPhase) return res.status(400).json({ error: '当前不是该阶段，请按顺序进行 BP' })

  const side = resolveSide(m, req.body, req.user)
  if (!side) return res.status(403).json({ error: '你不是本场参赛方' })

  // 对手已保护/已 ban 的卡组（用于禁止重复 ban 或 ban 保护卡组）
  const oppProtect = side === 'A' ? m.bp_b_protect : m.bp_a_protect
  const oppBan1 = side === 'A' ? m.bp_b_ban : m.bp_a_ban
  const oppBan2 = side === 'A'
    ? m.bp_b_ban2
      ? JSON.parse(m.bp_b_ban2)
      : []
    : m.bp_a_ban2
    ? JSON.parse(m.bp_a_ban2)
    : []

  if (step === 'protect') {
    const idx = Number(req.body.protect)
    if (!Number.isInteger(idx) || idx < 0 || idx >= 11) return res.status(400).json({ error: '保护职业下标不合法' })
    teamSet(m, side, 'protect', idx)
  } else if (step === 'ban1') {
    const idx = Number(req.body.ban)
    if (!Number.isInteger(idx) || idx < 0 || idx >= 11) return res.status(400).json({ error: 'ban 下标不合法' })
    if (oppProtect != null && idx === oppProtect) return res.status(400).json({ error: '不能禁用对方已保护的职业' })
    teamSet(m, side, 'ban1', idx)
  } else if (step === 'ban2') {
    const arr = (req.body.ban2 || []).map(Number)
    if (!Array.isArray(arr) || arr.length !== 2) return res.status(400).json({ error: '需禁用 2 套卡组' })
    for (const x of arr) if (!Number.isInteger(x) || x < 0 || x >= 11) return res.status(400).json({ error: 'ban 下标不合法' })
    if (new Set(arr).size !== 2) return res.status(400).json({ error: '两套 ban 不可重复' })
    if (oppProtect != null && arr.includes(oppProtect)) return res.status(400).json({ error: '不能禁用对方已保护的职业' })
    if (oppBan1 != null && arr.includes(oppBan1)) return res.status(400).json({ error: '该套已被 ban1 禁用' })
    if (oppBan2.length && arr.some((x) => oppBan2.includes(x))) return res.status(400).json({ error: '该套已在本阶段禁用' })
    teamSet(m, side, 'ban2', arr)
  }

  // 双方都完成当前阶段则推进到下一阶段（ban2 完成后公布 BP）
  const updated = getMatch(m.id)
  const aDone = stepDone(updated, 'A', step)
  const bDone = stepDone(updated, 'B', step)
  if (aDone && bDone) {
    if (step === 'ban2') {
      db.prepare("UPDATE matches SET bp_revealed = 1, deck_phase = 'playing' WHERE id = ?").run(m.id)
    } else {
      db.prepare('UPDATE matches SET deck_phase = ? WHERE id = ?').run(TEAM_NEXT[step], m.id)
    }
  }
  const after = getMatch(m.id)
  res.json({
    ok: true,
    revealed: !!after.bp_revealed,
    phase: aDone && bDone ? TEAM_NEXT[step] : m.deck_phase,
  })
})

// 某方在某 BP 阶段是否已提交
function stepDone(m, side, step) {
  const v = teamVal(m, side, step)
  if (step === 'ban2') return Array.isArray(v) && v.length === 2
  return v != null
}

// 阶段 3：选手手动提交逐局赛果（系统不做任何处理，仅完整保存，待管理员确认）
router.post('/:id/result-submit', (req, res) => {
  const m = getMatch(req.params.id)
  if (!m) return res.status(404).json({ error: '比赛不存在' })
  const t = getTournament(m.tournament_id)
  const { mf, meta } = matchOf(m, t)
  if (!mf || mf === 'none') return res.status(400).json({ error: '该赛事无对阵制' })
  if (m.status === 'done' || m.status === 'bye') return res.status(400).json({ error: '该场已结束' })
  // 无BP对阵制无 Ban/Pick，可直接提交赛果；其余需先完成 BP 并公布
  if (!meta?.noBP && !m.bp_revealed) return res.status(400).json({ error: '请先完成 BP 并公布后再提交赛果' })

  const side = resolveSide(m, req.body, req.user)
  if (!side) return res.status(403).json({ error: '你不是本场参赛方' })

  if (!meta) return res.status(400).json({ error: '对阵制无效' })
  const { games, note } = req.body || {}
  if (!Array.isArray(games) || games.length === 0) return res.status(400).json({ error: '请至少提交一局赛果' })
  if (games.length > meta.bo) return res.status(400).json({ error: `赛果局数不能超过 ${meta.bo}` })
  for (const g of games) {
    if (g.winnerSide !== 'A' && g.winnerSide !== 'B') return res.status(400).json({ error: '每局胜方必须为 A 或 B' })
    const wi = Number(g.winnerDeck)
    const li = Number(g.loserDeck)
    if (!Number.isInteger(wi) || !Number.isInteger(li) || wi < 0 || wi >= meta.totalDecks || li < 0 || li >= meta.totalDecks) {
      return res.status(400).json({ error: '卡组下标不合法' })
    }
  }
  // 被 ban 的卡组不可用于赛果（修复：提交赛果的选择栏不应出现被 ban 卡组；后端兜底校验）
  const bpView = bpFromMatch(m, t)
  for (const g of games) {
    const wSide = g.winnerSide
    const lSide = wSide === 'A' ? 'B' : 'A'
    const wBan = wSide === 'A' ? bpView.aBanned : bpView.bBanned
    const lBan = lSide === 'A' ? bpView.aBanned : bpView.bBanned
    if (wBan.includes(Number(g.winnerDeck))) {
      return res.status(400).json({ error: `胜方卡组（下标 ${g.winnerDeck}）已被 ban，不可出战` })
    }
    if (lBan.includes(Number(g.loserDeck))) {
      return res.status(400).json({ error: `败方卡组（下标 ${g.loserDeck}）已被 ban，不可出战` })
    }
  }

  const colRes = side === 'A' ? 'result_a' : 'result_b'
  const colSub = side === 'A' ? 'result_submitted_a' : 'result_submitted_b'
  db.prepare(`UPDATE matches SET ${colRes} = @r, ${colSub} = 1 WHERE id = @id`).run({
    r: JSON.stringify({ games, note: note || '' }),
    id: m.id,
  })

  const updated = getMatch(m.id)
  if (updated.result_submitted_a && updated.result_submitted_b) {
    db.prepare("UPDATE matches SET deck_phase = 'submitted' WHERE id = ?").run(m.id)
  }
  res.json({ ok: true, bothSubmitted: !!(updated.result_submitted_a && updated.result_submitted_b) })
})

// 阶段 4：管理员确认 / 驳回（系统仅在“确认”时判定晋级）
router.post('/:id/admin-confirm', requireAdmin, (req, res) => {
  const m = getMatch(req.params.id)
  if (!m) return res.status(404).json({ error: '比赛不存在' })
  const t = getTournament(m.tournament_id)
  const { mf, rule, meta } = matchOf(m, t)
  if (!mf || mf === 'none') return res.status(400).json({ error: '该赛事无对阵制' })
  if (m.status === 'done' || m.status === 'bye') return res.status(400).json({ error: '该场已结束' })
  if (!m.result_submitted_a || !m.result_submitted_b) {
    return res.status(400).json({ error: '双方尚未提交赛果，无法确认' })
  }

  const { action, winnerSide, note } = req.body || {}
  if (action === 'reject') {
    // 驳回：清除双方赛果，回到可重交状态（系统不做任何判定）
    db.prepare(
      "UPDATE matches SET result_a = NULL, result_b = NULL, result_submitted_a = 0, result_submitted_b = 0, deck_phase = 'playing', admin_note = @n WHERE id = @id"
    ).run({ n: note || '', id: m.id })
    return res.json({ ok: true, action: 'reject' })
  }

  // 确认：系统只在「双方提交一致」且未显式指定胜方时自动判定；
  // 一旦不一致，系统不做任何处理，必须交由管理员指定胜方。
  const ra = m.result_a ? JSON.parse(m.result_a) : { games: [] }
  const rb = m.result_b ? JSON.parse(m.result_b) : { games: [] }
  const games = ra.games && ra.games.length ? ra.games : rb.games || []
  let ws = winnerSide
  if (!ws) {
    if (!gamesAgree(ra.games, rb.games)) {
      return res.status(400).json({ error: '双方提交不一致，请指定胜方后再确认' })
    }
    const st = evaluateSeries({ bo: meta.bo, decks: meta.totalDecks, rule: rule, bp: bpFromMatch(m, t), games })
    ws = st ? st.winnerSide : null
  }
  if (ws !== 'A' && ws !== 'B') {
    return res.status(400).json({ error: '赛果未分胜负或无效，请指定胜方后再确认' })
  }

  const slotA = JSON.parse(m.slot_a)
  const slotB = JSON.parse(m.slot_b)
  const winner = ws === 'A' ? slotA : slotB
  const aWins = games.filter((g) => g.winnerSide === 'A').length
  const bWins = games.filter((g) => g.winnerSide === 'B').length

  db.prepare('UPDATE matches SET games = @g, admin_note = @n WHERE id = @id').run({
    g: JSON.stringify(games),
    n: note || '',
    id: m.id,
  })
  finalizeMatch(t, m, winner, aWins, bWins)
  db.prepare("UPDATE matches SET deck_phase = 'confirmed' WHERE id = ?").run(m.id)
  res.json({ ok: true, action: 'confirm', winnerSide: ws })
})

export default router
