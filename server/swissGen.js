// 瑞士轮：每轮全部赛果录入后，按当前积分榜动态生成下一轮配对
import db from './db.js'
import { pairSwiss } from '../src/lib/swiss.js'
import { computeStandings } from '../src/lib/standings.js'

export function generateSwissNextRound(tournamentId) {
  const t = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(tournamentId)
  if (!t || t.format !== 'swiss' || !t.bracket_json) return false
  const plan = JSON.parse(t.bracket_json)
  const rows = db.prepare('SELECT * FROM matches WHERE tournament_id = ?').all(tournamentId)
  const currentRound = Math.max(...rows.map((r) => r.round))
  if (currentRound >= plan.swissRoundsTotal) return false

  const stRows = rows.map((r) => ({
    status: r.status,
    slotA: r.slot_a ? JSON.parse(r.slot_a) : null,
    slotB: r.slot_b ? JSON.parse(r.slot_b) : null,
    scoreA: r.score_a,
    scoreB: r.score_b,
    byeWinnerId: r.status === 'bye' ? (r.slot_a ? JSON.parse(r.slot_a).id : r.slot_b ? JSON.parse(r.slot_b).id : null) : null,
  }))
  const standings = computeStandings(plan.participants, stRows)

  const played = new Set()
  rows.forEach((r) => {
    if (r.slot_a && r.slot_b) {
      const a = JSON.parse(r.slot_a).id
      const b = JSON.parse(r.slot_b).id
      played.add(a < b ? `${a}|${b}` : `${b}|${a}`)
    }
  })

  const pairs = pairSwiss(standings, played)
  const usedIds = new Set(pairs.flat().map((p) => String(p.id)))
  const leftover = standings.filter((p) => !usedIds.has(String(p.id)))
  const allPairs = pairs.concat(leftover.map((p) => [p]))

  const nextRound = currentRound + 1
  const insertMatch = db.prepare(
    `INSERT INTO matches(id, mid, tournament_id, round, match_index, slot_a, slot_b, status, winner_id, score_a, score_b, next_match_id, next_slot, loser_next_match_id, loser_next_slot, round_name, group_name)
     VALUES(@id,@mid,@tid,@round,@index,@slotA,@slotB,@status,@winnerId,@scoreA,@scoreB,@nextMatchId,@nextSlot,@loserNextMatchId,@loserNextSlot,@roundName,@group)`
  )
  const tx = db.transaction(() => {
    allPairs.forEach((pair, i2) => {
      if (pair.length === 2) {
        const [a, b] = pair
        insertMatch.run({
          id: `${tournamentId}-SW-R${nextRound}-M${i2 + 1}`,
          mid: `SW-R${nextRound}-M${i2 + 1}`,
          tid: tournamentId,
          round: nextRound,
          index: i2 + 1,
          slotA: JSON.stringify(a),
          slotB: JSON.stringify(b),
          status: 'pending',
          winnerId: null,
          scoreA: null,
          scoreB: null,
          nextMatchId: null,
          nextSlot: null,
          loserNextMatchId: null,
          loserNextSlot: null,
          roundName: `第 ${nextRound} 轮`,
          group: 'SW',
        })
      } else {
        const p = pair[0]
        insertMatch.run({
          id: `${tournamentId}-SW-R${nextRound}-M${i2 + 1}`,
          mid: `SW-R${nextRound}-M${i2 + 1}`,
          tid: tournamentId,
          round: nextRound,
          index: i2 + 1,
          slotA: JSON.stringify(p),
          slotB: null,
          status: 'bye',
          winnerId: String(p.id),
          scoreA: null,
          scoreB: null,
          nextMatchId: null,
          nextSlot: null,
          loserNextMatchId: null,
          loserNextSlot: null,
          roundName: `第 ${nextRound} 轮`,
          group: 'SW',
        })
      }
    })
  })
  tx()
  return true
}
