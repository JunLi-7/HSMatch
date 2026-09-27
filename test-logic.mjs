// 纯逻辑验证（不启动服务、不联网）：无BP征服对阵制 + 四强切换 + 征服判定
import { matchFormatMeta, lateMatchFormat } from './src/lib/matchFormats.js'
import { evaluateSeries } from './src/lib/series.js'
import { generateSingleElimination } from './src/lib/bracket.js'

let fail = 0
const ok = (c, m) => { console.log((c ? '✓' : '✗ FAIL:') + ' ' + m); if (!c) fail++ }

// 1) 对阵制定义
const m2 = matchFormatMeta('conquest_nobp_2d')
const m3 = matchFormatMeta('conquest_nobp_3d')
ok(m2 && m2.noBP === true, 'conquest_nobp_2d 标记 noBP=true')
ok(m2 && m2.totalDecks === 2 && m2.bo === 3, 'conquest_nobp_2d: 2套卡组 / BO3')
ok(m3 && m3.noBP === true && m3.totalDecks === 3 && m3.bo === 5, 'conquest_nobp_3d: 3套卡组 / BO5')
ok(lateMatchFormat('conquest_nobp_2d') === 'conquest_nobp_3d', '四强后映射 2d → 3d 正确')

// 2) 征服判定（前期 BO3/2套）：A 用两套卡组征服 B
const ev2 = evaluateSeries({ matchFormat: 'conquest_nobp_2d', rule: 'conquest', bp: { aBanned: [], bBanned: [] }, games: [
  { winnerSide: 'A', winnerDeck: 0, loserDeck: 1 },
  { winnerSide: 'A', winnerDeck: 1, loserDeck: 0 },
] })
ok(ev2.winnerSide === 'A', 'BO3/2套：A 赢遍两套卡组 → A 胜')

// 3) 征服判定（四强 BO5/3套）：A 赢 3 套 → 胜；只赢 2 套 → 未分
const ev3win = evaluateSeries({ matchFormat: 'conquest_nobp_3d', rule: 'conquest', bp: { aBanned: [], bBanned: [] }, games: [
  { winnerSide: 'A', winnerDeck: 0, loserDeck: 1 },
  { winnerSide: 'A', winnerDeck: 1, loserDeck: 2 },
  { winnerSide: 'A', winnerDeck: 2, loserDeck: 0 },
] })
ok(ev3win.winnerSide === 'A', 'BO5/3套：A 赢遍三套卡组 → A 胜')
const ev3tie = evaluateSeries({ matchFormat: 'conquest_nobp_3d', rule: 'conquest', bp: { aBanned: [], bBanned: [] }, games: [
  { winnerSide: 'A', winnerDeck: 0, loserDeck: 1 },
  { winnerSide: 'A', winnerDeck: 1, loserDeck: 0 },
] })
ok(ev3tie.winnerSide === null, 'BO5/3套：仅赢两套 → 未分胜负（需继续打）')

// 4) 四强轮识别（单败 8 人）：roundsCount=3，late=round>=2 → 第2、3轮
const b = generateSingleElimination(8)
ok(b.roundsCount === 3, '8人单败共 3 轮')
const roundsCount = b.rounds.length
const isLate = (round) => round >= roundsCount - 1
ok(isLate(1) === false && isLate(2) === true && isLate(3) === true, '四强识别：R1 前期 / R2、R3 四强后')

// 5) 32 人规模：roundsCount=5，四强=半决赛(R4)+决赛(R5)
const b32 = generateSingleElimination(32)
const isLate32 = (round) => round >= b32.roundsCount - 1
ok(b32.roundsCount === 5, '32人单败共 5 轮')
ok(isLate32(4) && isLate32(5) && !isLate32(3), '32人：R4(半决赛)/R5(决赛) 为四强后，R3(八强) 仍为前期')

console.log(fail === 0 ? '\n全部逻辑测试通过 ✓' : `\n有 ${fail} 项失败`)
process.exitCode = fail === 0 ? 0 : 1
