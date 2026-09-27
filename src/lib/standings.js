// 积分榜计算（小组循环 / 瑞士轮共用）
// participants: [{id,name,seed,...}]
// rows: [{status, slotA:{id,name}|null, slotB:{id,name}|null, scoreA:Number, scoreB:Number}]
// 计分默认 胜3 / 平1 / 负0，可通过 cfg 覆盖。

export function computeStandings(participants, rows, cfg = {}) {
  const win = cfg.win ?? 3
  const draw = cfg.draw ?? 1
  const loss = cfg.loss ?? 0

  const map = {}
  participants.forEach((p) => {
    map[String(p.id)] = {
      id: String(p.id),
      name: p.name,
      seed: p.seed,
      points: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      scoreFor: 0,
      scoreAgainst: 0,
    }
  })

  rows.forEach((r) => {
    if (!r.slotA || !r.slotB || r.status !== 'done') return
    const a = map[String(r.slotA.id)]
    const b = map[String(r.slotB.id)]
    if (!a || !b) return
    const sa = Number(r.scoreA) || 0
    const sb = Number(r.scoreB) || 0
    a.scoreFor += sa
    a.scoreAgainst += sb
    b.scoreFor += sb
    b.scoreAgainst += sa
    if (sa > sb) {
      a.points += win
      a.wins++
      b.points += loss
      b.losses++
    } else if (sa < sb) {
      b.points += win
      b.wins++
      a.points += loss
      a.losses++
    } else {
      a.points += draw
      a.draws++
      b.points += draw
      b.draws++
    }
  })

  return Object.values(map).sort(
    (x, y) =>
      y.points - x.points ||
      y.scoreFor - y.scoreAgainst - (x.scoreFor - x.scoreAgainst) ||
      y.wins - x.wins ||
      String(x.name).localeCompare(String(y.name))
  )
}
