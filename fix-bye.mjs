// 修复历史脏数据：轮空场（席位为 _bye 占位）未标记 status='bye'，导致对阵永久卡在 pending
// 条件极其保守：仅当某一方是 _bye 占位对象、且恰好一个真实选手时才处理，
// 绝不会误伤「一方已晋级、另一方待定」的正常场次（那些 slot 是 null，不含 _bye 标记）
import { DatabaseSync } from 'node:sqlite'

const db = new DatabaseSync('./data/match.db')
db.transaction = (fn) => (...args) => {
  db.exec('BEGIN')
  try { const v = fn(...args); db.exec('COMMIT'); return v } catch (e) { try { db.exec('ROLLBACK') } catch {}; throw e }
}
const rows = db.prepare("SELECT * FROM matches WHERE status = 'pending'").all()

let fixed = 0
const tx = db.transaction(() => {
  for (const r of rows) {
    const a = r.slot_a ? JSON.parse(r.slot_a) : null
    const b = r.slot_b ? JSON.parse(r.slot_b) : null
    const hasByePlaceholder = !!(a && a._bye) || !!(b && b._bye)
    if (!hasByePlaceholder) continue
    const real = [a, b].filter((s) => s && !s._bye)
    if (real.length !== 1) continue

    const winner = real[0]
    console.log(`  修复 ${r.mid}（T${r.tournament_id}）：${winner.name} 轮空晋级`)
    db.prepare("UPDATE matches SET status = 'bye', winner_id = ?, deck_phase = 'confirmed' WHERE id = ?").run(
      String(winner.id),
      r.id
    )
    // 回填下一轮槽位
    if (r.next_match_id && r.next_slot) {
      const col = r.next_slot === 'B' ? 'slot_b' : 'slot_a'
      db.prepare(`UPDATE matches SET ${col} = ? WHERE id = ?`).run(
        JSON.stringify(winner),
        r.next_match_id
      )
    }
    fixed++
  }
})
tx()

console.log(`\n共修复 ${fixed} 场轮空对阵`)
process.exit(0)
