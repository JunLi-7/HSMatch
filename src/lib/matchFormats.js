// 炉石传说「对阵制」与「规则」定义（纯逻辑，前后端共用）
//
// 旧模型：固定命名对阵制（bo3_ban1_pick2 / team_kof / conquest_nobp_2d …）
// 新模型：可组合对阵制 = 一组「分段(segment)」，每段 5 个自由参数
//   - appliesTo : 适用赛程范围（全程 / 八强起 / 四强起 / 决赛 / 小组赛 / 淘汰赛）
//   - bo        : 几局几胜（1/3/5/7/9/11，奇数）
//   - rule      : 征服(conquest) 或 擂台(kof)
//   - ban       : 禁用对手卡组数量（0 = 无 ban，直接选可用卡组）
//   - decks     : 选手携带卡组数量（= ban + pick）
//   - isTeam    : 战队赛专用标记（固定 11 套 / ban3 / BO11 / KOF）
//
// 一致性规则：pick = decks - ban；bo 应等于 2*pick - 1（如 4 套 + ban1 → pick3 → BO5）

// ===================== 旧命名对阵制（兼容旧赛事数据回退） =====================
export const MATCH_FORMATS = [
  {
    value: 'bo3_ban1_pick2',
    label: 'BO3 · 禁1选2',
    desc: 'ban 1 套卡组，各选 2 套，三局两胜',
    totalDecks: 3,
    ban: 1,
    pick: 2,
    bo: 3,
  },
  {
    value: 'bo5_ban1_pick3',
    label: 'BO5 · 禁1选3',
    desc: 'ban 1 套卡组，各选 3 套，五局三胜',
    totalDecks: 4,
    ban: 1,
    pick: 3,
    bo: 5,
  },
  {
    value: 'team_kof',
    label: '战队赛 · BO11 (KOF)',
    desc: '11 套卡组，ban1 + 保护1 + ban2，共 ban 3 套、剩 8 套可用，BO11 擂台',
    totalDecks: 11,
    ban: 3,
    pick: 0,
    bo: 11,
    team: true,
    fixedRule: 'kof',
  },
  {
    value: 'conquest_nobp_2d',
    label: '征服·BO3·2套(无BP)',
    desc: '无 Ban/Pick，双方各 2 套卡组，三局两胜征服',
    totalDecks: 2,
    ban: 0,
    pick: 0,
    bo: 3,
    noBP: true,
    fixedRule: 'conquest',
  },
  {
    value: 'conquest_nobp_3d',
    label: '征服·BO5·3套(无BP)',
    desc: '无 Ban/Pick，双方各 3 套卡组，五局三胜征服',
    totalDecks: 3,
    ban: 0,
    pick: 0,
    bo: 5,
    noBP: true,
    fixedRule: 'conquest',
  },
]

// 无BP征服赛：基础对阵制 → 四强后切换（兼容旧逻辑；新模型用分段实现）
export const NOBP_LATE_MAP = {
  conquest_nobp_2d: 'conquest_nobp_3d',
}
export function lateMatchFormat(base) {
  return NOBP_LATE_MAP[base] || base
}

export function matchFormatMeta(value) {
  return MATCH_FORMATS.find((f) => f.value === value) || null
}

// ===================== 规则 =====================
export const RULES = [
  {
    value: 'conquest',
    label: '征服 (Conquest)',
    desc: '赢遍自己全部可用卡组即获胜；已赢的卡组不可再用，输过的卡组可重试',
  },
  {
    value: 'kof',
    label: '擂台 (KOF)',
    desc: '耗尽对方全部可用卡组即获胜；胜者保留卡组，败者必须换未用过的卡组',
  },
]
export function ruleMeta(value) {
  return RULES.find((r) => r.value === value) || null
}

// 炉石传说 11 个职业（一个职业 = 一套卡组）
export const HS_CLASSES = [
  { key: 'death_knight', name: '死亡骑士' },
  { key: 'demon_hunter', name: '恶魔猎手' },
  { key: 'druid', name: '德鲁伊' },
  { key: 'hunter', name: '猎人' },
  { key: 'mage', name: '法师' },
  { key: 'paladin', name: '圣骑士' },
  { key: 'priest', name: '牧师' },
  { key: 'rogue', name: '潜行者' },
  { key: 'shaman', name: '萨满' },
  { key: 'warlock', name: '术士' },
  { key: 'warrior', name: '战士' },
]

// ===================== 新：可组合对阵制 =====================

// 适用赛程范围的中文标签
export const STAGE_LABEL = {
  all: '全程',
  group: '小组赛',
  ko: '淘汰赛',
  quarter: '八强起',
  semi: '四强起',
  final: '决赛',
}

// 阶段层级（用于「取覆盖当前轮次的最高层级分段」）
const STAGE_LEVEL = { all: 0, group: 0, ko: 0, quarter: 2, semi: 3, final: 4 }

// 根据赛制返回可用的「适用赛程范围」选项
export function stageOptionsFor(format) {
  if (format === 'round_robin') {
    return [
      { value: 'group', label: '小组赛' },
      { value: 'ko', label: '淘汰赛' },
    ]
  }
  if (format === 'single_elimination' || format === 'double_elimination') {
    return [
      { value: 'all', label: '全程' },
      { value: 'quarter', label: '八强起' },
      { value: 'semi', label: '四强起' },
      { value: 'final', label: '决赛' },
    ]
  }
  // 瑞士轮 / 其他：单一全程
  return [{ value: 'all', label: '全程' }]
}

// 某赛制下的默认分段
export function defaultSegment(format) {
  if (format === 'round_robin') {
    return [
      { appliesTo: 'group', rule: 'conquest', bo: 3, ban: 1, decks: 3 },
      { appliesTo: 'ko', rule: 'conquest', bo: 3, ban: 1, decks: 3 },
    ]
  }
  return [{ appliesTo: 'all', rule: 'conquest', bo: 3, ban: 1, decks: 3 }]
}

// 一致性校验：返回 { ok, error?, pick? }
export function validateFormat(seg) {
  if (seg.isTeam) return { ok: true, pick: 8 }
  const decks = Number(seg.decks)
  const ban = Number(seg.ban)
  const bo = Number(seg.bo)
  if (!seg.rule) return { ok: false, error: '请选择规则（征服/KOF）' }
  if (!decks || decks < 1) return { ok: false, error: '选手携带卡组数量至少 1 套' }
  if (decks > 11) return { ok: false, error: '选手携带卡组数量最多 11 套（职业数上限）' }
  if (ban == null || ban < 0) return { ok: false, error: 'ban 数量不能为负' }
  if (ban >= decks) return { ok: false, error: `ban 数量(${ban}) 必须小于携带卡组数量(${decks})` }
  const pick = decks - ban
  if (bo == null || bo < 1 || bo % 2 === 0) {
    return { ok: false, error: 'BO（几局几胜）必须为奇数：1 / 3 / 5 / 7 / 9 / 11' }
  }
  const expectedBo = 2 * pick - 1
  if (bo !== expectedBo) {
    return {
      ok: false,
      error: `前后不一致：携带 ${decks} 套、ban ${ban} 套 → 可用 pick ${pick} 套 → 应对应 BO${expectedBo}，当前 BO 为 ${bo}`,
      pick,
    }
  }
  return { ok: true, pick }
}

// 规范化分段列表：保证赛程范围被完整覆盖（用于创建前）
export function normalizeSegments(segs, format) {
  let arr = (segs || []).map((s) => ({ ...s }))
  if (format === 'round_robin') {
    if (!arr.some((s) => s.appliesTo === 'group'))
      arr.push({ appliesTo: 'group', rule: 'conquest', bo: 3, ban: 1, decks: 3 })
    if (!arr.some((s) => s.appliesTo === 'ko'))
      arr.push({ appliesTo: 'ko', rule: 'conquest', bo: 3, ban: 1, decks: 3 })
  } else if (format === 'single_elimination' || format === 'double_elimination') {
    if (
      arr.some((s) => ['quarter', 'semi', 'final'].includes(s.appliesTo)) &&
      !arr.some((s) => s.appliesTo === 'all')
    ) {
      // 用户把范围限制在后期阶段 → 自动补一段「全程」覆盖前期（即新生成的选择框）
      arr.push({ appliesTo: 'all', rule: 'conquest', bo: 3, ban: 1, decks: 3 })
    }
    arr = arr.filter((s) => ['all', 'quarter', 'semi', 'final'].includes(s.appliesTo))
    if (!arr.length) arr.push({ appliesTo: 'all', rule: 'conquest', bo: 3, ban: 1, decks: 3 })
  } else {
    // 瑞士轮 / 其他：统一一段「全程」
    arr = arr.length ? [{ ...arr[0], appliesTo: 'all' }] : [{ appliesTo: 'all', rule: 'conquest', bo: 3, ban: 1, decks: 3 }]
  }
  return arr
}

// 轮次 → 阶段层级（仅淘汰赛用来区分 决赛/四强/八强/前期）
export function roundStageLevel(round, totalRounds) {
  if (!totalRounds) return 0
  if (round === totalRounds) return 4 // 决赛
  if (round === totalRounds - 1) return 3 // 半决赛（四强）
  if (round === totalRounds - 2) return 2 // 八强（四分之一）
  return 0
}

// 解析某场比赛应用哪一段对阵制
export function resolveSegment(segs, { stage, round, totalRounds }) {
  if (!segs || !segs.length) return null
  if (stage === 'group') return segs.find((s) => s.appliesTo === 'group') || segs[0]
  if (stage === 'ko') return segs.find((s) => s.appliesTo === 'ko') || segs[0]
  const lvl = roundStageLevel(round, totalRounds)
  const cands = segs.filter((s) => ['all', 'quarter', 'semi', 'final'].includes(s.appliesTo))
  const pick = cands
    .filter((s) => STAGE_LEVEL[s.appliesTo] <= lvl)
    .sort((a, b) => STAGE_LEVEL[b.appliesTo] - STAGE_LEVEL[a.appliesTo])[0]
  return pick || segs.find((s) => s.appliesTo === 'all') || segs[0]
}

// 分段 → 赛事级展示用 style（match_format + rule）
export function segToStyle(seg) {
  if (!seg) return { matchFormat: 'none', rule: null }
  if (seg.isTeam) return { matchFormat: 'team_kof', rule: 'kof' }
  return { matchFormat: seg.rule || 'none', rule: seg.rule }
}

// 分段摘要（用于展示）
export function segmentSummary(seg) {
  if (!seg) return '无'
  if (seg.isTeam) return '战队赛 · BO11 · KOF · 11 套(禁 3)'
  const r = seg.rule === 'conquest' ? '征服' : seg.rule === 'kof' ? '擂台' : seg.rule || ''
  return `BO${seg.bo} · ${r} · 禁${seg.ban} · 带${seg.decks}套`
}

// 选手自带卡组数量（兼容旧命名格式）
export function deckCount(matchFormat) {
  const meta = matchFormatMeta(matchFormat)
  return meta ? meta.totalDecks : 0
}
