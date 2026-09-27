// 瑞士轮配对：给定当前积分榜(已排序)与历史已交手集合，尽量按“相邻积分、避免重赛”配对。
// standings: [{id,name,...}] 已按排名排序（同分时相邻）
// playedPairs: Set，元素为 "小id|大id"，表示两队已交手
// 返回 [[a,b], ...]，未配对者（奇数人）会被放入一个单元素数组，由调用方处理为轮空。

export function pairSwiss(standings, playedPairs) {
  const used = new Set()
  const pairs = []
  const key = (a, b) => (String(a.id) < String(b.id) ? `${a.id}|${b.id}` : `${b.id}|${a.id}`)
  const players = standings.slice()

  for (let i = 0; i < players.length; i++) {
    if (used.has(players[i].id)) continue
    let paired = false
    // 先找未交手且分差最小的对手
    for (let j = i + 1; j < players.length; j++) {
      if (used.has(players[j].id)) continue
      if (!playedPairs.has(key(players[i], players[j]))) {
        pairs.push([players[i], players[j]])
        used.add(players[i].id)
        used.add(players[j].id)
        paired = true
        break
      }
    }
    // 实在避免不了重赛，退而求其次
    if (!paired) {
      for (let j = i + 1; j < players.length; j++) {
        if (used.has(players[j].id)) continue
        pairs.push([players[i], players[j]])
        used.add(players[i].id)
        used.add(players[j].id)
        break
      }
    }
  }
  return pairs
}
