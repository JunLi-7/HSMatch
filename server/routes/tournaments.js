// 赛事路由：列表/详情/创建/发布/报名/抽签
import express from 'express'
import db from '../db.js'
import { requireAuth, requireAdmin } from '../middleware.js'
import { generateBracket, SUPPORTED_FORMATS } from '../../src/lib/bracket.js'
import { computeStandings } from '../../src/lib/standings.js'
import {
  MATCH_FORMATS,
  RULES,
  HS_CLASSES,
  matchFormatMeta,
  defaultSegment,
  validateFormat,
  normalizeSegments,
  resolveSegment,
  segToStyle,
} from '../../src/lib/matchFormats.js'

const router = express.Router()
router.use(requireAuth)

const SUPPORTED = SUPPORTED_FORMATS.map((f) => f.value)

const MATCH_FORMAT_VALUES = ['none', ...MATCH_FORMATS.map((f) => f.value)]
const RULE_VALUES = RULES.map((r) => r.value)
const shortId = (full) => (full ? full.substring(full.indexOf('-') + 1) : null)

function insertBracketMatches(tid, rounds) {
  const tour = db
    .prepare(
      'SELECT format, match_format, rule, late_match_format, group_count, group_match_format, group_rule, ko_match_format, ko_rule, format_segments FROM tournaments WHERE id = ?'
    )
    .get(tid)
  // 新模型：可组合对阵制（分段）；旧赛事无 format_segments 时回退到赛事级命名格式
  const segs = tour.format_segments ? JSON.parse(tour.format_segments) : []
  const roundsCount = rounds.length
  const styleOf = (m) => {
    const seg = resolveSegment(segs, { stage: m.stage, round: m.round, totalRounds: roundsCount })
    if (seg) return seg
    // 旧数据回退：无分段时整场用赛事级 match_format / rule
    return { rule: tour.rule, bo: null, ban: 0, decks: 0, isTeam: tour.match_format === 'team_kof' }
  }
  const insertMatch = db.prepare(
    `INSERT INTO matches(id, mid, tournament_id, round, match_index, slot_a, slot_b, status, winner_id, score_a, score_b, next_match_id, next_slot, loser_next_match_id, loser_next_slot, round_name, group_name, deck_phase, bp_revealed, match_format, rule, stage, bo, ban_count, deck_count)
     VALUES(@id,@mid,@tid,@round,@index,@slotA,@slotB,@status,@winnerId,@scoreA,@scoreB,@nextMatchId,@nextSlot,@loserNextMatchId,@loserNextSlot,@roundName,@group,@deckPhase,@bpRevealed,@matchFormat,@rule,@stage,@bo,@banCount,@deckCount)`
  )
  const tx = db.transaction(() => {
    rounds.flat().forEach((m) => {
      const slotA = m.slots[0] ? JSON.stringify(m.slots[0]) : null
      const slotB = m.slots[1] ? JSON.stringify(m.slots[1]) : null
      let status = 'pending'
      let winnerId = null
      if (m.isBye && m.byeWinner) {
        status = 'bye'
        winnerId = String(m.byeWinner.id)
      }
      const seg = styleOf(m)
      const { matchFormat, rule } = segToStyle(seg)
      const isTeam = !!seg.isTeam
      const bo = seg.bo
      const ban = seg.ban
      const decks = seg.decks
      // 无BP：ban=0（无 Ban/Pick，选手直接提交赛果）；战队赛走三阶段 BP；ban>0 走两阶段 BP（填卡组→禁用）
      const needsBP = !isTeam && ban > 0
      const initialDeckPhase = isTeam ? 'team_ban1' : needsBP ? null : 'playing'
      const bpRevealed = isTeam ? 0 : needsBP ? 0 : 1
      insertMatch.run({
        id: `${tid}-${m.id}`,
        mid: m.id,
        tid,
        round: m.round,
        index: m.index,
        slotA,
        slotB,
        status,
        winnerId,
        scoreA: null,
        scoreB: null,
        nextMatchId: m.nextMatchId ? `${tid}-${m.nextMatchId}` : null,
        nextSlot: m.nextSlot,
        loserNextMatchId: m.loserNextMatchId ? `${tid}-${m.loserNextMatchId}` : null,
        loserNextSlot: m.loserNextSlot,
        roundName: m.roundName,
        group: m.group,
        deckPhase: initialDeckPhase,
        bpRevealed,
        matchFormat,
        rule,
        stage: m.stage || null,
        bo: bo ?? null,
        banCount: ban ?? null,
        deckCount: decks ?? null,
      })
    })
    // 轮空者直接晋级，预填进下一轮对应槽位
    rounds.flat().forEach((m) => {
      if (m.isBye && m.byeWinner && m.nextMatchId) {
        const col = m.nextSlot === 'B' ? 'slot_b' : 'slot_a'
        db.prepare(`UPDATE matches SET ${col} = @v WHERE id = @id`).run({
          v: JSON.stringify(m.byeWinner),
          id: `${tid}-${m.nextMatchId}`,
        })
      }
    })
  })
  tx()
}

function planFrom(bracket) {
  // 仅保存“计划”信息（参与人/赛制/总轮数等），对阵详情以 matches 表为准
  const plan = {
    format: bracket.format,
    participants: bracket.participants,
    roundsCount: bracket.roundsCount,
    size: bracket.size,
    byes: bracket.byes,
    swissRoundsTotal: bracket.swissRoundsTotal || null,
  }
  // 小组循环 + 出线淘汰赛：额外保存分组结构与出线名额
  if (bracket.groups) {
    plan.groupCount = bracket.groupCount
    plan.groupRounds = bracket.groupRounds
    plan.koStartRound = bracket.koStartRound
    plan.koSize = bracket.koSize
    plan.koByes = bracket.koByes
    plan.qualifiedCount = bracket.qualifiedCount
    plan.groups = bracket.groups.map((g) => ({
      key: g.key,
      name: g.name,
      size: g.size,
      advance: g.advance,
      memberIds: g.memberIds,
      participants: bracket.participants.filter((p) => g.memberIds.includes(String(p.id))),
    }))
  }
  return plan
}

// 单场 -> 积分榜输入行
function standingRow(r) {
  return {
    status: r.status,
    slotA: r.slot_a ? JSON.parse(r.slot_a) : null,
    slotB: r.slot_b ? JSON.parse(r.slot_b) : null,
    scoreA: r.score_a,
    scoreB: r.score_b,
    byeWinnerId:
      r.status === 'bye'
        ? r.slot_a
          ? JSON.parse(r.slot_a).id
          : r.slot_b
            ? JSON.parse(r.slot_b).id
            : null
        : null,
  }
}

// 从 matches 表重建对阵树 + 积分榜（按查看者角色控制可见性）
function decorate(t, userId) {
  const o = { ...t }
  o.registeredCount = db
    .prepare('SELECT COUNT(*) c FROM registrations WHERE tournament_id = ?')
    .get(t.id).c
  const mine = db
    .prepare('SELECT status FROM registrations WHERE tournament_id = ? AND user_id = ?')
    .get(t.id, userId)
  o.myRegistration = mine ? mine.status : null
  const isAdmin = userId && isUserAdmin(userId)

  if ((t.status === 'ongoing' || t.status === 'finished') && t.bracket_json) {
    const plan = JSON.parse(t.bracket_json)
    const rows = db
      .prepare('SELECT * FROM matches WHERE tournament_id = ? ORDER BY round, match_index')
      .all(t.id)
    const rounds = []
    rows.forEach((r) => {
      const m = buildMatchView(r, t, userId, isAdmin)
      rounds[r.round - 1] = rounds[r.round - 1] || []
      rounds[r.round - 1].push(m)
    })
    const bracket = { ...plan, rounds }
    if (plan.groups && plan.groups.length) {
      // 小组循环 + 出线淘汰赛：小组赛按组展示（含组内积分榜），rounds 只放淘汰赛
      const groupRows = rows.filter((r) => r.stage === 'group')
      const koRows = rows.filter((r) => r.stage === 'ko')
      const koRounds = []
      koRows.forEach((r) => {
        const m = buildMatchView(r, t, userId, isAdmin)
        koRounds[r.round - 1] = koRounds[r.round - 1] || []
        koRounds[r.round - 1].push(m)
      })
      bracket.groups = plan.groups.map((g) => {
        const gRows = groupRows.filter((r) => r.group_name === g.name)
        const gRounds = []
        gRows.forEach((r) => {
          const m = buildMatchView(r, t, userId, isAdmin)
          gRounds[r.round - 1] = gRounds[r.round - 1] || []
          gRounds[r.round - 1].push(m)
        })
        const st = computeStandings(g.participants || [], gRows.map(standingRow))
        return {
          key: g.key,
          name: g.name,
          size: g.size,
          advance: g.advance,
          rounds: gRounds.filter(Boolean),
          standings: st,
          qualifiedIds: st.slice(0, g.advance).map((x) => String(x.id)),
        }
      })
      bracket.rounds = koRounds.filter(Boolean)
      bracket.standings = [] // 分组展示，不用总榜
      if (t.status === 'finished') bracket.champion = bracket.champion || null
      o.champion = bracket.champion || null
      o.bracket = bracket
      return o
    }
    if (t.format === 'round_robin' || t.format === 'swiss') {
      const stRows = rows.map(standingRow)
      const st = computeStandings(plan.participants, stRows)
      bracket.standings = st
      if (t.status === 'finished') bracket.champion = st[0] || null
      o.champion = bracket.champion || null
    } else {
      const b = JSON.parse(t.bracket_json)
      bracket.champion = b.champion || null
      o.champion = b.champion || null
    }
    o.bracket = bracket
  }
  return o
}

// 构造单场对阵的“视图”（含 BP/赛果的可见性控制）
function buildMatchView(r, t, userId, isAdmin) {
  const slotA = r.slot_a ? JSON.parse(r.slot_a) : null
  const slotB = r.slot_b ? JSON.parse(r.slot_b) : null
  const m = {
    id: r.mid,
    round: r.round,
    index: r.match_index,
    slots: [slotA, slotB],
    status: r.status,
    winnerId: r.winner_id,
    score_a: r.score_a,
    score_b: r.score_b,
    nextMatchId: shortId(r.next_match_id),
    nextSlot: r.next_slot,
    loserNextMatchId: shortId(r.loser_next_match_id),
    loserNextSlot: r.loser_next_slot,
    group: r.group_name,
    roundName: r.round_name,
    isBye: r.status === 'bye',
    byeWinner: r.status === 'bye' ? slotA || slotB : null,
    games: r.games ? JSON.parse(r.games) : [], // 仅“确认后”的权威赛果
  }

  // 每场对阵制/规则：优先用该场自带（小组循环的小组赛/淘汰赛可各用一套），否则回退赛事级
  const style = r.match_format || t.match_format || 'none'
  const rule = r.rule || t.rule
  const isTeam = style === 'team_kof'
  const hasDeck = style && style !== 'none'
  if (!hasDeck) return m
  // 新数据：bo / ban_count / deck_count 已落库；旧命名格式赛事回退到 matchFormatMeta 解析
  const deckCount = r.deck_count != null ? r.deck_count : matchFormatMeta(style)?.totalDecks || 0
  const ban = r.ban_count != null ? r.ban_count : matchFormatMeta(style)?.ban || 0
  const bo = r.bo != null ? r.bo : matchFormatMeta(style)?.bo || (isTeam ? 11 : 0)
  const noBP = !isTeam && ban === 0 // ban=0 → 无 Ban/Pick，选手直接提交赛果
  const meta = { totalDecks: deckCount, ban, bo, isTeam, noBP }

  // 选手所在方
  let mySide = null
  if (slotA && String(slotA.id) === String(userId)) mySide = 'A'
  else if (slotB && String(slotB.id) === String(userId)) mySide = 'B'

  const decksRevealed = noBP ? true : !!r.bp_decks_revealed
  const fullRevealed = noBP ? true : !!r.bp_revealed
  const visA = isAdmin || mySide === 'A'
  const visB = isAdmin || mySide === 'B'

  let phase
  if (r.status === 'bye') phase = 'confirmed'
  else if (isTeam) phase = fullRevealed ? r.deck_phase || 'playing' : r.deck_phase || 'team_ban1'
  else if (noBP) phase = r.deck_phase || 'playing'
  else phase = r.deck_phase || 'bp_decks'

  // 卡组：战队赛固定为 11 职业（双方都带全部职业）；无BP征服赛用通用卡组标签（不预提交）；其余为选手提交
  const genericDecks = Array.from({ length: meta.totalDecks }, (_, i) => `卡组${i + 1}`)
  const aDecks = isTeam
    ? HS_CLASSES.map((c) => c.name)
    : noBP
    ? genericDecks
    : r.bp_a_decks
    ? JSON.parse(r.bp_a_decks)
    : null
  const bDecks = isTeam
    ? HS_CLASSES.map((c) => c.name)
    : noBP
    ? genericDecks
    : r.bp_b_decks
    ? JSON.parse(r.bp_b_decks)
    : null

  // ban 集合（用于赛果可用卡组判断）
  const aBannedRaw = []
  const bBannedRaw = []
  if (r.bp_b_ban != null) aBannedRaw.push(r.bp_b_ban)
  if (r.bp_a_ban != null) bBannedRaw.push(r.bp_a_ban)
  if (isTeam) {
    if (r.bp_b_ban2) JSON.parse(r.bp_b_ban2).forEach((x) => aBannedRaw.push(x))
    if (r.bp_a_ban2) JSON.parse(r.bp_a_ban2).forEach((x) => bBannedRaw.push(x))
  }
  const aBanned = visA || fullRevealed ? aBannedRaw : []
  const bBanned = visB || fullRevealed ? bBannedRaw : []

  const ra = r.result_a ? JSON.parse(r.result_a) : null
  const rb = r.result_b ? JSON.parse(r.result_b) : null

  m.bp = {
    aDecks: isTeam ? aDecks || [] : visA || decksRevealed ? aDecks || [] : [],
    aBan: visA || fullRevealed ? r.bp_a_ban : null,
    bDecks: isTeam ? bDecks || [] : visB || decksRevealed ? bDecks || [] : [],
    bBan: visB || fullRevealed ? r.bp_b_ban : null,
    decksRevealed: isTeam ? false : decksRevealed,
    revealed: fullRevealed,
    aBanned,
    bBanned,
    // 战队赛 BP 各阶段（仅本人/管理员可见己方，公布后双方可见）
    aProtect: visA || fullRevealed ? r.bp_a_protect : null,
    aBan1: visA || fullRevealed ? r.bp_a_ban : null,
    aPick1: visA || fullRevealed ? r.bp_a_pick1 : null,
    aBan2: visA ? (r.bp_a_ban2 ? JSON.parse(r.bp_a_ban2) : []) : null,
    bProtect: visB || fullRevealed ? r.bp_b_protect : null,
    bBan1: visB || fullRevealed ? r.bp_b_ban : null,
    bPick1: visB || fullRevealed ? r.bp_b_pick1 : null,
    bBan2: visB ? (r.bp_b_ban2 ? JSON.parse(r.bp_b_ban2) : []) : null,
  }
  m.isTeam = isTeam
  m.noBP = noBP
  m.matchFormat = style
  m.rule = rule
  m.mySide = mySide
  m.deckPhase = phase

  // 本方各 BP 阶段提交状态（战队赛用）
  const sideDone = (c, step) => {
    if (step === 'protect') return r['bp_' + c + '_protect'] != null
    if (step === 'ban1') return r['bp_' + c + '_ban'] != null
    if (step === 'ban2') {
      const raw = r['bp_' + c + '_ban2']
      return raw ? JSON.parse(raw).length === 2 : false
    }
    return false
  }
  const col = mySide === 'A' ? 'a' : mySide === 'B' ? 'b' : 'a'
  m.myBp = mySide
    ? {
        decks: mySide === 'A' ? aDecks : bDecks,
        ban: mySide === 'A' ? r.bp_a_ban : r.bp_b_ban,
        decksSubmitted: mySide === 'A' ? !!aDecks : !!bDecks,
        banSubmitted: mySide === 'A' ? r.bp_a_ban != null : r.bp_b_ban != null,
        protect: sideDone(col, 'protect'),
        ban1: sideDone(col, 'ban1'),
        ban2: sideDone(col, 'ban2'),
      }
    : null
  m.myTeam = mySide
    ? {
        protect: sideDone(col, 'protect'),
        ban1: sideDone(col, 'ban1'),
        ban2: sideDone(col, 'ban2'),
      }
    : null
  // 赛果可见性：仅本人可见自己提交的；管理员可见双方；公布前他人不可见内容
  m.myResult = mySide ? (mySide === 'A' ? ra : rb) : null
  m.myResultSubmitted = mySide === 'A' ? !!r.result_submitted_a : mySide === 'B' ? !!r.result_submitted_b : false
  m.opponentResultSubmitted =
    mySide === 'A' ? !!r.result_submitted_b : mySide === 'B' ? !!r.result_submitted_a : false
  m.bothResultsSubmitted = !!r.result_submitted_a && !!r.result_submitted_b
  m.adminReview = isAdmin
    ? {
        a: { games: ra ? ra.games : [], note: ra ? ra.note : '', submitted: !!r.result_submitted_a },
        b: { games: rb ? rb.games : [], note: rb ? rb.note : '', submitted: !!r.result_submitted_b },
        note: r.admin_note || '',
      }
    : null
  return m
}

function isUserAdmin(userId) {
  const u = db.prepare('SELECT role FROM users WHERE id = ?').get(userId)
  return u && u.role === 'admin'
}

// 列表：选手看已开放的；管理员看全部
router.get('/', (req, res) => {
  const rows =
    req.user.role === 'admin'
      ? db.prepare('SELECT * FROM tournaments ORDER BY created_at DESC').all()
      : db
          .prepare(
            "SELECT * FROM tournaments WHERE status IN ('open','ongoing','finished') ORDER BY created_at DESC"
          )
          .all()
  res.json({ tournaments: rows.map((t) => decorate(t, req.user.id)) })
})

// 详情
router.get('/:id', (req, res) => {
  const t = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(req.params.id)
  if (!t) return res.status(404).json({ error: '赛事不存在' })
  res.json({ tournament: decorate(t, req.user.id) })
})

// 创建（管理员）
// matchKind: 'none'（无对阵制，直接录比分）| 'custom'（可组合对阵制，formatSegments 分段）
//           | 'team'（战队赛，固定不拆 5 框）
router.post('/', requireAdmin, (req, res) => {
  const { name, description, format, maxParticipants, rounds, matchKind, formatSegments, groupCount } =
    req.body || {}
  if (!name) return res.status(400).json({ error: '赛事名称必填' })
  if (!SUPPORTED.includes(format)) return res.status(400).json({ error: '不支持的赛制' })
  const mp = parseInt(maxParticipants, 10)
  if (!mp || mp < 2) return res.status(400).json({ error: '参赛人数至少 2 人' })

  // 小组循环：分组数量（与对阵制类型无关，始终需要）
  let groupCountVal = null
  if (format === 'round_robin') {
    const gc = parseInt(groupCount, 10)
    if (!gc || gc < 2) return res.status(400).json({ error: '小组循环需设置分组数量（至少 2 组）' })
    const maxG = Math.max(1, Math.floor(mp / 2))
    if (gc > maxG) {
      return res.status(400).json({ error: `分组数量过多：${mp} 人每组至少 2 人，最多 ${maxG} 组` })
    }
    groupCountVal = gc
  }

  const kind = matchKind || 'none'
  let segs = []
  let matchFormat = 'none'
  let ruleVal = null

  if (kind === 'team') {
    // 战队赛：固定 11 套 / ban3 / BO11 / KOF，功能不变
    segs = [{ appliesTo: 'all', rule: 'kof', bo: 11, ban: 3, decks: 11, isTeam: true }]
    matchFormat = 'team_kof'
    ruleVal = 'kof'
  } else if (kind === 'custom') {
    const raw = Array.isArray(formatSegments) ? formatSegments : []
    if (!raw.length) return res.status(400).json({ error: '请配置对阵制（BO / 规则 / ban / 卡组数）' })
    for (const s of raw) {
      const v = validateFormat(s)
      if (!v.ok) return res.status(400).json({ error: `对阵制不一致：${v.error}` })
    }
    segs = normalizeSegments(raw, format)
    if (format === 'round_robin') {
      if (!segs.some((s) => s.appliesTo === 'group')) {
        return res.status(400).json({ error: '小组循环需设置小组赛对阵制' })
      }
      if (!segs.some((s) => s.appliesTo === 'ko')) {
        return res.status(400).json({ error: '小组循环需设置淘汰赛对阵制' })
      }
    }
    const base = segToStyle(segs[0])
    matchFormat = base.matchFormat
    ruleVal = base.rule
  } else {
    // 无对阵制：直接录比分
    segs = []
    matchFormat = 'none'
    ruleVal = null
  }

  let roundsVal = null
  if (format === 'swiss') {
    const r = parseInt(rounds, 10)
    if (r && r >= 1) roundsVal = Math.min(r, mp - 1)
  }
  const info = db
    .prepare(
      `INSERT INTO tournaments(name, description, format, match_format, rule, late_match_format, max_participants, rounds, status, created_by, created_at,
        group_count, group_match_format, group_rule, ko_match_format, ko_rule, format_segments)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      name,
      description || '',
      format,
      matchFormat,
      ruleVal,
      null, // late_match_format 已由分段（format_segments）模型取代
      mp,
      roundsVal,
      'draft',
      req.user.id,
      new Date().toISOString(),
      groupCountVal,
      null,
      null,
      null,
      null,
      segs.length ? JSON.stringify(segs) : null
    )
  res.json({
    tournament: db.prepare('SELECT * FROM tournaments WHERE id = ?').get(info.lastInsertRowid),
  })
})

// 发布（管理员）：draft -> open
router.post('/:id/publish', requireAdmin, (req, res) => {
  const t = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(req.params.id)
  if (!t) return res.status(404).json({ error: '赛事不存在' })
  if (t.status !== 'draft') return res.status(400).json({ error: '仅草稿赛事可发布' })
  db.prepare("UPDATE tournaments SET status = 'open' WHERE id = ?").run(t.id)
  res.json({ ok: true })
})

// 抽签核心逻辑（自动满员 or 管理员手动触发均复用）
function doDraw(tournamentId, res, opts = {}) {
  const t = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(tournamentId)
  if (!t) return res.status(404).json({ error: '赛事不存在' })
  const regs = db
    .prepare(
      'SELECT u.id, u.full_name FROM registrations r JOIN users u ON u.id = r.user_id WHERE r.tournament_id = ? ORDER BY r.registered_at ASC'
    )
    .all(t.id)
  if (regs.length < 2) return res.status(400).json({ error: '报名人数不足，无法抽签' })

  // 随机抽签：先按报名记录取出选手，再用 Fisher-Yates 彻底打乱顺序，
  // 避免“按报名时间顺序固定落位”导致对阵可预测。打乱后重排 seed，
  // 使瑞士轮首轮配对（按 seed 1v2、3v4…）同样随机。
  const participants = regs.map((u) => ({ id: String(u.id), name: u.full_name }))
  for (let i = participants.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = participants[i]
    participants[i] = participants[j]
    participants[j] = tmp
  }
  participants.forEach((p, i) => (p.seed = i + 1))

  const bracket = generateBracket(t.format, participants, {
    rounds: t.rounds ? t.rounds : undefined,
    // 小组循环：按管理员设置的分组数量分配，出线后再随机抽签打淘汰赛
    groupCount: t.format === 'round_robin' && t.group_count ? t.group_count : undefined,
  })
  const tid = t.id

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM matches WHERE tournament_id = ?').run(tid)
    insertBracketMatches(tid, bracket.rounds)
  })
  tx()

  db.prepare("UPDATE tournaments SET status = 'ongoing', bracket_json = ? WHERE id = ?").run(
    JSON.stringify(planFrom(bracket)),
    tid
  )
  res.json({ ok: true, registeredCount: regs.length, auto: !!opts.auto })
}

// 报名（选手）
router.post('/:id/register', (req, res) => {
  if (req.user.role !== 'player') return res.status(403).json({ error: '仅选手可报名' })
  const t = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(req.params.id)
  if (!t) return res.status(404).json({ error: '赛事不存在' })
  if (t.status !== 'open') return res.status(400).json({ error: '赛事未开放报名' })
  if (
    db.prepare('SELECT COUNT(*) c FROM registrations WHERE tournament_id = ?').get(t.id).c >=
    t.max_participants
  ) {
    return res.status(400).json({ error: '参赛名额已满' })
  }
  if (db.prepare('SELECT id FROM registrations WHERE tournament_id = ? AND user_id = ?').get(t.id, req.user.id)) {
    return res.status(400).json({ error: '你已报名该赛事' })
  }
  db.prepare(
    'INSERT INTO registrations(tournament_id, user_id, status, registered_at) VALUES(?,?,?,?)'
  ).run(t.id, req.user.id, 'confirmed', new Date().toISOString())

  const newCount = db.prepare('SELECT COUNT(*) c FROM registrations WHERE tournament_id = ?').get(t.id).c
  if (newCount >= t.max_participants) {
    return doDraw(t.id, res, { auto: true }) // 满员自动抽签
  }
  res.json({ ok: true, registeredCount: newCount })
})

// 手动抽签（管理员；满员时也可点）
router.post('/:id/draw', requireAdmin, (req, res) => {
  const t = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(req.params.id)
  if (!t) return res.status(404).json({ error: '赛事不存在' })
  if (t.status !== 'open') return res.status(400).json({ error: '仅开放中的赛事可抽签' })
  return doDraw(t.id, res, {})
})

// 删除已完赛（结束）的赛事及其全部比赛、报名记录（仅管理员）
router.delete('/:id', requireAdmin, (req, res) => {
  const t = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(req.params.id)
  if (!t) return res.status(404).json({ error: '赛事不存在' })
  // 管理员可删除任意状态的赛事（含进行中）：级联清除其全部比赛与报名记录
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM matches WHERE tournament_id = ?').run(t.id)
    db.prepare('DELETE FROM registrations WHERE tournament_id = ?').run(t.id)
    db.prepare('DELETE FROM tournaments WHERE id = ?').run(t.id)
  })
  tx()
  res.json({ ok: true })
})

export default router
