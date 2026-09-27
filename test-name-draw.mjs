// 验证：用户名/昵称字符集 + 随机抽签
import { USERNAME_RE, NAME_RE } from './server/auth.js'
import { generateBracket } from './src/lib/bracket.js'

let pass = 0
let fail = 0
function ok(cond, msg) {
  if (cond) { pass++; console.log('  ✓', msg) }
  else { fail++; console.log('  ✗', msg) }
}

console.log('== 用户名/昵称字符集 ==')
// 允许：汉字 + 数字 + 英文 + # + 丨
ok(USERNAME_RE.test('name#1234'), '用户名 name#1234 通过')
ok(USERNAME_RE.test('英雄丨12345'), '用户名 英雄丨12345 通过')
ok(USERNAME_RE.test('王者荣耀123'), '用户名 王者荣耀123 通过')
ok(USERNAME_RE.test('abc_123'), '用户名 abc_123（含下划线，兼容老账号）通过')
ok(USERNAME_RE.test('丨丨丨'), '用户名 丨丨丨 通过')
// 拒绝
ok(!USERNAME_RE.test('a b'), '含空格 拒绝')
ok(!USERNAME_RE.test('ab'), '2 位 拒绝')
ok(!USERNAME_RE.test('x'.repeat(31)), '31 位 拒绝')
ok(!USERNAME_RE.test('na me!'), '含 ! 拒绝')
// 昵称
ok(NAME_RE.test('丨'), '昵称单字 丨 通过')
ok(!NAME_RE.test('a b'), '昵称含空格 拒绝')

console.log('== 随机抽签（Fisher-Yates 打乱后落位）==')
// 复刻 doDraw 的打乱逻辑
function shuffled(participants) {
  const arr = participants.map((u) => ({ id: String(u.id), name: u.name }))
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t
  }
  arr.forEach((p, i) => (p.seed = i + 1))
  return arr
}

const names = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P']
const base = names.map((n, i) => ({ id: 'P' + i, name: n }))

// 1) 多次抽签，首轮第一场的对阵组合应出现多种不同情况（随机性）
const firstPairs = new Set()
for (let k = 0; k < 200; k++) {
  const b = generateBracket('single_elimination', shuffled(base))
  const m0 = b.rounds[0][0]
  firstPairs.add(`${m0.slots[0]?.name} vs ${m0.slots[1]?.name}`)
}
ok(firstPairs.size > 5, `200 次抽签首场组合有 ${firstPairs.size} 种（>>1 说明不是固定对阵）`)

// 2) 打乱后不应再按原报名顺序（A vs P 不应每次都出现）
const sameOrderCount = (() => {
  let c = 0
  for (let k = 0; k < 200; k++) {
    const b = generateBracket('single_elimination', shuffled(base))
    const m0 = b.rounds[0][0]
    if (m0.slots[0]?.name === 'A' && m0.slots[1]?.name === 'P') c++
  }
  return c
})()
ok(sameOrderCount < 50, `首场为 A vs P 的次数=${sameOrderCount}/200（应接近随机比例，非固定 100%）`)

// 3) 瑞士轮首轮也随机（按 seed 配对 1v2,3v4… 因 seed 已被打乱）
let swissFirstSame = 0
for (let k = 0; k < 200; k++) {
  const b = generateBracket('swiss', shuffled(base), { rounds: 5 })
  const m0 = b.rounds[0][0]
  if (m0.slots[0]?.name === 'A' && m0.slots[1]?.name === 'B') swissFirstSame++
}
ok(swissFirstSame < 50, `瑞士轮首场 A vs B 次数=${swissFirstSame}/200（随机）`)

console.log(`\n结果：通过 ${pass} 项，失败 ${fail} 项`)
process.exit(fail ? 1 : 0)
