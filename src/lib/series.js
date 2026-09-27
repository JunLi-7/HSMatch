// 系列赛（单场对阵）胜负判定（纯逻辑，前后端共用）
// 输入：对阵制描述符（bo / decks / rule）+ BP 结果 + 已录单局
// 输出：双方可用卡组、征服进度 / 擂台存活、系列是否已分胜负、胜方
//
// 新模型不再依赖命名对阵制，bo / decks 直接由调用方（每场 match 的 bo / deck_count）传入。
// bp = {
//   aDecks:[], bDecks:[],
//   aBan:int|null, bBan:int|null,          // 旧版单 ban（bo3/bo5 用）
//   aBanned:[int], bBanned:[int],          // ban 集合（战队赛用，兼容旧版：未提供时由 aBan/bBan 推导）
//   revealed:bool
// }
// games = [{ no, winnerSide:'A'|'B', winnerDeck:int, loserDeck:int }]

export function evaluateSeries({ bo, decks, rule, bp, games = [] }) {
  const total = Number(decks) || 0
  if (!total) return null

  // 可用卡组下标：取 ban 集合；未提供 aBanned/bBanned 时由单 ban 字段推导（兼容 bo3/bo5）
  const aBanned = Array.isArray(bp.aBanned)
    ? bp.aBanned
    : bp.bBan != null
    ? [bp.bBan]
    : []
  const bBanned = Array.isArray(bp.bBanned)
    ? bp.bBanned
    : bp.aBan != null
    ? [bp.aBan]
    : []
  const aUsable = Array.from({ length: total }, (_, i) => i).filter((i) => !aBanned.includes(i))
  const bUsable = Array.from({ length: total }, (_, i) => i).filter((i) => !bBanned.includes(i))

  const aWins = games.filter((g) => g.winnerSide === 'A').length
  const bWins = games.filter((g) => g.winnerSide === 'B').length

  let aConquered = []
  let bConquered = []
  let aAlive = [...aUsable]
  let bAlive = [...bUsable]
  let winnerSide = null

  // BO11 等：先赢 ceil(bo/2) 局即胜（战队赛 8 套卡组时，耗尽对手卡组往往晚于局数判定）
  const firstTo = Math.ceil((Number(bo) || 1) / 2)

  if (rule === 'conquest') {
    aConquered = Array.from(new Set(games.filter((g) => g.winnerSide === 'A').map((g) => g.winnerDeck)))
    bConquered = Array.from(new Set(games.filter((g) => g.winnerSide === 'B').map((g) => g.winnerDeck)))
    if (aConquered.length >= aUsable.length) winnerSide = 'A'
    else if (bConquered.length >= bUsable.length) winnerSide = 'B'
  } else if (rule === 'kof') {
    games.forEach((g) => {
      if (g.winnerSide === 'A') bAlive = bAlive.filter((i) => i !== g.loserDeck)
      else aAlive = aAlive.filter((i) => i !== g.loserDeck)
    })
    if (aAlive.length === 0) winnerSide = 'B'
    else if (bAlive.length === 0) winnerSide = 'A'
    if (!winnerSide) {
      if (aWins >= firstTo) winnerSide = 'A'
      else if (bWins >= firstTo) winnerSide = 'B'
    }
  }

  return {
    total,
    aUsable,
    bUsable,
    aWins,
    bWins,
    aConquered,
    bConquered,
    aAlive,
    bAlive,
    winnerSide,
    decided: winnerSide !== null,
  }
}
