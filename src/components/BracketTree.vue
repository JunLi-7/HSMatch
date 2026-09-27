<template>
  <div class="bracket-wrap">
    <template v-for="(sec, si) in sections" :key="si">
    <!-- 分组标题（小组循环） -->
    <div v-if="sec.title" class="sec-head">
      <h4>
        {{ sec.title }}
        <span v-if="sec.note" class="sec-note">{{ sec.note }}</span>
      </h4>
    </div>
    <!-- 积分榜（小组 / 瑞士轮） -->
    <div v-if="sec.standings && sec.standings.length" class="standings">
      <h4 v-if="!sec.title">积分榜</h4>
      <el-table :data="sec.standings" size="small" border>
        <el-table-column type="index" label="名次" width="56" />
        <el-table-column prop="name" label="选手" min-width="120" />
        <el-table-column prop="points" label="积分" width="70" />
        <el-table-column prop="wins" label="胜" width="56" />
        <el-table-column prop="draws" label="平" width="56" />
        <el-table-column prop="losses" label="负" width="56" />
        <el-table-column label="净胜" width="70">
          <template #default="{ row }">{{ row.scoreFor - row.scoreAgainst }}</template>
        </el-table-column>
        <el-table-column v-if="sec.qualifiedIds && sec.qualifiedIds.length" label="出线" width="70">
          <template #default="{ row }">
            <el-tag v-if="sec.qualifiedIds.includes(String(row.id))" type="success" size="small">出线</el-tag>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 对阵树 -->
    <div class="bracket">
      <div v-for="(round, ri) in sec.rounds" :key="ri" class="round">
        <div class="round-name">{{ roundName(round, ri) }}</div>

        <div
          v-for="m in round"
          :key="m.id"
          class="match"
          :class="{
            done: m.status === 'done',
            bye: m.status === 'bye',
            draw: m.status === 'done' && !m.winnerId,
            mine: m.mySide,
          }"
        >
          <!-- 无对阵制：简单录分（仅管理员） -->
          <template v-if="!mHasDeck(m)">
            <div class="slot" :class="{ win: m.status === 'done' && m.winnerId && m.winnerId === slotId(m.slots[0]) }">
              <span class="name">{{ slotName(m.slots[0], m.status) }}</span>
              <span class="score" v-if="m.score_a != null">{{ m.score_a }}</span>
            </div>
            <div class="slot" :class="{ win: m.status === 'done' && m.winnerId && m.winnerId === slotId(m.slots[1]) }">
              <span class="name">{{ slotName(m.slots[1], m.status) }}</span>
              <span class="score" v-if="m.score_b != null">{{ m.score_b }}</span>
            </div>
            <el-button
              v-if="isAdmin && m.status !== 'done' && m.status !== 'bye' && m.slots[0] && m.slots[1]"
              size="small"
              class="rec"
              @click="openRecord(m)"
              >录分</el-button
            >
            <span v-else-if="m.status === 'bye'" class="bye-tag">轮空</span>
            <span v-else-if="m.status === 'done' && !m.winnerId" class="bye-tag">平局</span>
          </template>

          <!-- 有对阵制（炉石）：选手端 BP + 赛果提交 + 管理员确认 -->
          <template v-else>
            <div class="slot"><span class="name">{{ m.slots[0]?.name }}</span></div>
            <div class="slot"><span class="name">{{ m.slots[1]?.name }}</span></div>

            <!-- BP 阶段标识 -->
            <div class="bp-line">
              <span v-if="m.noBP" class="badge ok">无BP · 直接提交赛果</span>
              <template v-else>
                <span v-if="!m.bp.decksRevealed" class="badge warn">BP：卡组待公布</span>
                <span v-else-if="!m.bp.revealed" class="badge warn">BP：禁用待公布</span>
                <span v-else class="badge ok">BP 已公布</span>
              </template>
              <span class="badge phase">{{ phaseLabel(m) }}</span>
            </div>

            <!-- 公布后的 BP 卡组（无BP征服赛无卡组列表） -->
            <template v-if="m.bp.revealed && !m.noBP">
              <div class="bp-decks">
                <div class="side" :class="{ win: m.status === 'done' && winnerSide(m) === 'A' }">
                  <div class="side-title">{{ m.slots[0]?.name }}</div>
                  <div v-for="(d, i) in m.bp.aDecks" :key="i" class="deck" :class="deckClass(m, 'A', i)">
                    {{ i + 1 }}.{{ d }}<em v-if="deckEm(m, 'A', i)">·{{ deckEm(m, 'A', i) }}</em>
                  </div>
                </div>
                <div class="side" :class="{ win: m.status === 'done' && winnerSide(m) === 'B' }">
                  <div class="side-title">{{ m.slots[1]?.name }}</div>
                  <div v-for="(d, i) in m.bp.bDecks" :key="i" class="deck" :class="deckClass(m, 'B', i)">
                    {{ i + 1 }}.{{ d }}<em v-if="deckEm(m, 'B', i)">·{{ deckEm(m, 'B', i) }}</em>
                  </div>
                </div>
              </div>
            </template>

            <!-- 确认后的逐局赛果 -->
            <div class="games" v-if="m.games.length">
              <div v-for="g in m.games" :key="g.no" class="game">
                第{{ g.no }}局：{{ g.winnerSide === 'A' ? m.slots[0]?.name : m.slots[1]?.name }} 用「{{
                  deckName(m, g.winnerSide, g.winnerDeck)
                }}」胜
              </div>
            </div>

            <!-- 选手/管理员操作区 -->
            <div class="actions">
              <!-- 阶段1：填卡组 -->
              <el-button
                v-if="canDo(m, 'decks')"
                size="small"
                @click="openDecks(m)"
                >{{ m.myBp?.decksSubmitted ? '修改卡组' : '填写卡组' }}</el-button
              >
              <span v-else-if="waitingOther(m, 'decks')" class="bye-tag">已提交卡组，等待对方</span>

              <!-- 阶段2：禁卡组 -->
              <el-button
                v-if="canDo(m, 'ban')"
                size="small"
                @click="openBan(m)"
                >{{ m.myBp?.banSubmitted ? '修改禁用' : '禁用对手卡组' }}</el-button
              >
              <span v-else-if="waitingOther(m, 'ban')" class="bye-tag">已禁用，等待对方</span>

              <!-- 战队赛：四阶段 BP（保护→禁用1→选择首发→再禁用2） -->
              <el-button
                v-if="canTeam(m)"
                size="small"
                type="warning"
                @click="openTeam(m)"
                >{{ teamBtnLabel(m) }}</el-button
              >
              <span v-else-if="isTeam(m) && waitingTeam(m)" class="bye-tag">已提交，等待对方</span>

              <!-- 阶段3：提交赛果 -->
              <el-button
                v-if="canDo(m, 'result')"
                size="small"
                type="primary"
                @click="openResult(m)"
                >{{ m.myResultSubmitted ? '修改赛果' : '提交赛果' }}</el-button
              >
              <span v-else-if="m.deckPhase === 'submitted' && (isAdmin || m.mySide)" class="bye-tag">
                {{ m.myResultSubmitted ? '已提交，等待管理员确认' : '等待对方提交赛果' }}
              </span>

              <!-- 管理员：审核确认 -->
              <el-button
                v-if="isAdmin && m.deckPhase === 'submitted'"
                size="small"
                type="warning"
                @click="openReview(m)"
                >审核并确认</el-button
              >
              <span v-if="m.status === 'done'" class="bye-tag">胜者：{{ winnerName(m) }}</span>
            </div>
          </template>
        </div>
      </div>
    </div>
    </template>

    <!-- 简单录分弹窗 -->
    <el-dialog v-model="dialog" title="录入赛果" width="360px">
      <template v-if="cur">
        <div class="rec-row">
          <b>{{ cur.slots[0]?.name }}</b>
          <el-input-number v-model="form.scoreA" :min="0" />
        </div>
        <div class="rec-row">
          <b>{{ cur.slots[1]?.name }}</b>
          <el-input-number v-model="form.scoreB" :min="0" />
        </div>
        <p class="muted">{{ hint }}</p>
      </template>
      <template #footer>
        <el-button @click="dialog = false">取消</el-button>
        <el-button type="primary" @click="submit">保存</el-button>
      </template>
    </el-dialog>

    <!-- 选手填写卡组弹窗（内置 11 职业） -->
    <el-dialog v-model="decksDialog" title="填写卡组（一个职业一套）" width="440px">
      <div v-if="cur" class="bp-edit">
        <p class="muted">需选择 {{ mMeta(cur).totalDecks }} 套卡组，职业不可重复。</p>
        <div class="ban-row" v-for="i in mMeta(cur).totalDecks" :key="i">
          第 {{ i }} 套：
          <el-select v-model="deckForm[i - 1]" style="width: 200px" placeholder="选择职业">
            <el-option v-for="c in HS_CLASSES" :key="c.key" :value="c.name" :label="c.name" :disabled="usedClasses.includes(c.name) && deckForm[i-1] !== c.name" />
          </el-select>
        </div>
        <el-radio-group v-if="isAdmin" v-model="decksSide" class="side-pick">
          <el-radio value="A">{{ cur.slots[0]?.name }}</el-radio>
          <el-radio value="B">{{ cur.slots[1]?.name }}</el-radio>
        </el-radio-group>
      </div>
      <template #footer>
        <el-button @click="decksDialog = false">取消</el-button>
        <el-button type="primary" @click="submitDecks">提交卡组</el-button>
      </template>
    </el-dialog>

    <!-- 禁用对手卡组弹窗 -->
    <el-dialog v-model="banDialog" title="禁用对手卡组" width="420px">
      <div v-if="cur" class="bp-edit">
        <p class="muted">选择要禁用掉的对手卡组（公布后双方可见）。</p>
        <div class="ban-row">
          禁用对手第
          <el-select v-model="banForm" style="width: 200px">
            <el-option v-for="(d, i) in oppDecks(cur)" :key="i" :value="i" :label="`${i + 1}.${d}`" />
          </el-select>
          套卡组
        </div>
        <el-radio-group v-if="isAdmin" v-model="banSide" class="side-pick">
          <el-radio value="A">{{ cur.slots[0]?.name }}</el-radio>
          <el-radio value="B">{{ cur.slots[1]?.name }}</el-radio>
        </el-radio-group>
      </div>
      <template #footer>
        <el-button @click="banDialog = false">取消</el-button>
        <el-button type="primary" @click="submitBan">确认禁用</el-button>
      </template>
    </el-dialog>

    <!-- 战队赛 BP 弹窗（保护/禁用1/选择首发/再禁用2，按当前阶段动态） -->
    <el-dialog v-model="teamDialog" :title="teamDialogTitle" width="460px">
      <div v-if="cur" class="bp-edit">
        <p class="muted">{{ teamStepHint }}</p>
        <div class="ban-row" v-if="teamStep === 'protect'">
          保护己方第
          <el-select v-model="teamForm.protect" style="width: 220px">
            <el-option v-for="(d, i) in teamMyDecks(cur)" :key="i" :value="i" :label="`${i + 1}.${d}`" />
          </el-select>
          套（不可被 ban，仍可出战）
        </div>
        <div class="ban-row" v-else-if="teamStep === 'ban1'">
          禁用对方第
          <el-select v-model="teamForm.ban1" style="width: 220px">
            <el-option
              v-for="(d, i) in teamOppDecks(cur)"
              :key="i"
              :value="i"
              :label="`${i + 1}.${d}${i === teamOppProtect(cur) ? '（对方已保护）' : ''}`"
              :disabled="i === teamOppProtect(cur)"
            />
          </el-select>
          套
        </div>
        <div class="ban-row" v-else-if="teamStep === 'ban2'">
          再禁用对方
          <el-select v-model="teamForm.ban2" multiple :multiple-limit="2" style="width: 260px" placeholder="选 2 套">
            <el-option
              v-for="(d, i) in teamOppDecks(cur)"
              :key="i"
              :value="i"
              :label="`${i + 1}.${d}${i === teamOppProtect(cur) ? '（对方已保护）' : ''}`"
              :disabled="i === teamOppProtect(cur)"
            />
          </el-select>
          套
        </div>
        <el-radio-group v-if="isAdmin" v-model="teamSide" class="side-pick">
          <el-radio value="A">{{ cur.slots[0]?.name }}</el-radio>
          <el-radio value="B">{{ cur.slots[1]?.name }}</el-radio>
        </el-radio-group>
      </div>
      <template #footer>
        <el-button @click="teamDialog = false">取消</el-button>
        <el-button type="primary" @click="submitTeam">提交</el-button>
      </template>
    </el-dialog>

    <!-- 选手提交赛果弹窗 -->
    <el-dialog v-model="resultDialog" title="提交赛果（逐局）" width="560px">
      <div v-if="cur" class="bp-edit">
        <p class="muted">{{ mMeta(cur).bo }} 局制 · {{ mRuleLabel(cur) }}。请如实逐局填写，双方提交后由管理员确认；不一致也不影响提交。</p>
        <div v-for="(g, gi) in resultForm" :key="gi" class="game-row">
          <span>第{{ gi + 1 }}局</span>
          <el-select v-model="g.winner" style="width: 130px">
            <el-option value="self" :label="`${myName(cur)} 胜`" />
            <el-option value="opp" :label="`${oppName(cur)} 胜`" />
          </el-select>
          <el-select v-model="g.winnerDeck" style="width: 150px" :placeholder="g.winner === 'self' ? '我方卡组' : '对方卡组'">
            <el-option v-for="o in winnerOpts(cur, g)" :key="o.idx" :value="o.idx" :label="`${o.idx + 1}.${o.name}`" />
          </el-select>
          <el-select v-model="g.loserDeck" style="width: 150px" :placeholder="g.winner === 'self' ? '对方卡组' : '我方卡组'">
            <el-option v-for="o in loserOpts(cur, g)" :key="o.idx" :value="o.idx" :label="`${o.idx + 1}.${o.name}`" />
          </el-select>
          <el-button text type="danger" @click="resultForm.splice(gi, 1)">删</el-button>
        </div>
        <el-button size="small" @click="addGame" :disabled="resultForm.length >= mMeta(cur).bo">+ 添加一局</el-button>
        <el-input v-model="resultNote" type="textarea" :rows="2" placeholder="备注（可选）" class="note" />
      </div>
      <template #footer>
        <el-button @click="resultDialog = false">取消</el-button>
        <el-button type="primary" @click="submitResult">提交赛果</el-button>
      </template>
    </el-dialog>

    <!-- 管理员审核并确认弹窗 -->
    <el-dialog v-model="reviewDialog" title="审核双方赛果" width="640px">
      <div v-if="cur && cur.adminReview" class="review">
        <p class="muted">
          公布前仅管理员可见双方提交。系统不做任何判定，请你核对后确认或驳回。
          <span :class="consistent(cur.adminReview) ? 'ok' : 'bad'">
            {{ consistent(cur.adminReview) ? '双方提交一致' : '双方提交不一致' }}
          </span>
        </p>
        <div class="review-cols">
          <div class="rv">
            <h5>{{ cur.slots[0]?.name }}（A）</h5>
            <div v-for="g in cur.adminReview.a.games" :key="g.no" class="game">
              第{{ g.no }}局：{{ g.winnerSide === 'A' ? cur.slots[0]?.name : cur.slots[1]?.name }} 胜
              <em>（{{ deckName(cur, g.winnerSide, g.winnerDeck) }}）</em>
            </div>
            <span v-if="!cur.adminReview.a.games.length" class="bye-tag">未提交</span>
            <div class="note" v-if="cur.adminReview.a.note">备注：{{ cur.adminReview.a.note }}</div>
          </div>
          <div class="rv">
            <h5>{{ cur.slots[1]?.name }}（B）</h5>
            <div v-for="g in cur.adminReview.b.games" :key="g.no" class="game">
              第{{ g.no }}局：{{ g.winnerSide === 'A' ? cur.slots[0]?.name : cur.slots[1]?.name }} 胜
              <em>（{{ deckName(cur, g.winnerSide, g.winnerDeck) }}）</em>
            </div>
            <span v-if="!cur.adminReview.b.games.length" class="bye-tag">未提交</span>
            <div class="note" v-if="cur.adminReview.b.note">备注：{{ cur.adminReview.b.note }}</div>
          </div>
        </div>
        <div class="ban-row" v-if="!consistent(cur.adminReview)">
          不一致时请指定胜方：
          <el-select v-model="reviewWinner" style="width: 160px">
            <el-option value="A" :label="`${cur.slots[0]?.name} 胜`" />
            <el-option value="B" :label="`${cur.slots[1]?.name} 胜`" />
          </el-select>
        </div>
        <el-input v-model="reviewNote" type="textarea" :rows="2" placeholder="管理员备注（可选）" class="note" />
      </div>
      <template #footer>
        <el-button @click="reviewDialog = false">取消</el-button>
        <el-button @click="rejectResult">驳回重交</el-button>
        <el-button type="primary" @click="confirmResult">确认并晋级</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import api from '../lib/api.js'
import { ElMessage } from 'element-plus'
import { matchFormatMeta, HS_CLASSES } from '../lib/matchFormats.js'
import { evaluateSeries } from '../lib/series.js'

const props = defineProps({
  bracket: Object,
  isAdmin: Boolean,
  tournamentId: { type: [String, Number], required: true },
  format: { type: String, default: 'single_elimination' },
  matchFormat: { type: String, default: 'none' },
  rule: { type: String, default: null },
})
const emit = defineEmits(['recorded'])

const hasDeck = computed(() => props.matchFormat && props.matchFormat !== 'none')
const meta = computed(() => matchFormatMeta(props.matchFormat) || { totalDecks: 0, bo: 0 })

// 每场可能用不同对阵制（小组循环：小组赛 / 淘汰赛各一套）
function mHasDeck(m) {
  const mf = (m && m.matchFormat) || props.matchFormat
  return !!mf && mf !== 'none'
}

// 展示分区：小组循环 + 淘汰赛按「各组 + 淘汰赛」分段；其余赛制单段
const sections = computed(() => {
  const b = props.bracket
  if (!b) return []
  if (b.groups && b.groups.length) {
    const list = b.groups.map((g) => ({
      title: `${g.name}（${g.size} 人）`,
      note: `出线 ${g.advance} 人`,
      standings: g.standings || [],
      qualifiedIds: g.qualifiedIds || [],
      rounds: g.rounds || [],
    }))
    if (b.rounds && b.rounds.length) {
      const seeded = (b.rounds[0] || []).some((m) => m.slots && m.slots[0])
      list.push({
        title: '淘汰赛',
        note: seeded
          ? `${b.qualifiedCount || ''} 人随机抽签`.trim()
          : '待小组赛结束后自动抽签',
        standings: [],
        qualifiedIds: [],
        rounds: b.rounds,
      })
    }
    return list
  }
  return [
    { title: '', note: '', standings: b.standings || [], qualifiedIds: [], rounds: b.rounds || [] },
  ]
})
const ruleLabel = computed(() => (props.rule === 'conquest' ? '征服' : props.rule === 'kof' ? '擂台' : ''))

// 每场对阵制元信息（优先用该场自带 bo/deck_count，旧命名格式回退到 meta）
function mMeta(m) {
  const style = (m && (m.matchFormat || props.matchFormat)) || 'none'
  const deckCount = m?.deck_count != null ? m.deck_count : matchFormatMeta(style)?.totalDecks || 0
  const bo = m?.bo != null ? m.bo : matchFormatMeta(style)?.bo || (style === 'team_kof' ? 11 : 0)
  const ban = m?.ban_count != null ? m.ban_count : matchFormatMeta(style)?.ban || 0
  const isTeam = style === 'team_kof'
  const noBP = !isTeam && ban === 0
  return { totalDecks: deckCount, bo, ban, isTeam, noBP }
}
function mRule(m) {
  return (m && (m.rule || props.rule)) || null
}
function mRuleLabel(m) {
  const r = mRule(m)
  return r === 'conquest' ? '征服' : r === 'kof' ? '擂台' : ''
}

const allowDraw = computed(() => props.format === 'round_robin' || props.format === 'swiss')
const hint = computed(() =>
  allowDraw.value ? '循环/瑞士轮：可平局（胜3 平1 负0），比分相等即平局。' : '淘汰赛：比分高者晋级（不可平局）。'
)

// ---------- 简单录分 ----------
const dialog = ref(false)
const cur = ref(null)
const form = ref({ scoreA: 0, scoreB: 0 })
function slotId(s) {
  return s ? String(s.id) : null
}
function slotName(s, status) {
  if (s) return s.name
  return status === 'bye' ? '轮空' : '待定'
}
function roundName(round, ri) {
  if (round[0] && round[0].roundName) return round[0].roundName
  return `第 ${ri + 1} 轮`
}
function openRecord(m) {
  cur.value = m
  form.value = { scoreA: 0, scoreB: 0 }
  dialog.value = true
}
async function submit() {
  try {
    await api.post(`/matches/${props.tournamentId}-${cur.value.id}/result`, {
      scoreA: form.value.scoreA,
      scoreB: form.value.scoreB,
    })
    ElMessage.success('赛果已记录')
    dialog.value = false
    emit('recorded')
  } catch (e) {
    ElMessage.error(e.response?.data?.error || '录入失败')
  }
}

// ---------- 对阵制辅助 ----------
function ev(m) {
  const meta = mMeta(m)
  return evaluateSeries({ bo: meta.bo, decks: meta.totalDecks, rule: mRule(m), bp: m.bp, games: m.games }) || {}
}
function winnerSide(m) {
  return ev(m).winnerSide || null
}
function winnerName(m) {
  if (m.status !== 'done' || !m.winnerId) return ''
  return m.slots[0] && String(m.slots[0].id) === String(m.winnerId) ? m.slots[0].name : m.slots[1]?.name
}
function deckName(m, side, idx) {
  const arr = side === 'A' ? m.bp.aDecks : m.bp.bDecks
  return arr[idx] || `#${idx + 1}`
}
function deckClass(m, side, i) {
  const s = ev(m)
  const banned = side === 'A' ? m.bp.aBanned || [] : m.bp.bBanned || []
  if (banned.includes(i)) return 'banned'
  const r = mRule(m)
  if (r === 'conquest') {
    if (side === 'A' && s.aConquered?.includes(i)) return 'conquered'
    if (side === 'B' && s.bConquered?.includes(i)) return 'conquered'
  }
  if (r === 'kof') {
    if (side === 'A' && !s.aAlive?.includes(i)) return 'dead'
    if (side === 'B' && !s.bAlive?.includes(i)) return 'dead'
  }
  return 'usable'
}
function deckEm(m, side, i) {
  const banned = side === 'A' ? m.bp.aBanned || [] : m.bp.bBanned || []
  if (banned.includes(i)) return '被禁'
  if (side === 'A') {
    if (i === m.bp.aProtect) return '保护'
    if (i === m.bp.aPick1) return '首发'
  } else {
    if (i === m.bp.bProtect) return '保护'
    if (i === m.bp.bPick1) return '首发'
  }
  const r = mRule(m)
  if (r === 'conquest') {
    const s = ev(m)
    if (side === 'A' && s.aConquered?.includes(i)) return '已征服'
    if (side === 'B' && s.bConquered?.includes(i)) return '已征服'
  }
  if (r === 'kof') {
    const s = ev(m)
    if (side === 'A' && !s.aAlive?.includes(i)) return '已淘汰'
    if (side === 'B' && !s.bAlive?.includes(i)) return '已淘汰'
  }
  return null
}
// 提交赛果时仅可选「未被 ban」的卡组（修复：被 ban 卡组不应出现在选择栏）
function bannedSetOf(m, side) {
  return side === 'A' ? m.bp.aBanned || [] : m.bp.bBanned || []
}
function usableOptions(m, side) {
  const decks = side === 'A' ? m.bp.aDecks : m.bp.bDecks
  const banned = bannedSetOf(m, side)
  return (decks || []).map((d, i) => ({ idx: i, name: d })).filter((x) => !banned.includes(x.idx))
}
function selfSideOf(m) {
  return m.mySide || 'A'
}
function winnerSideOf(m, g) {
  return g.winner === 'self' ? selfSideOf(m) : selfSideOf(m) === 'A' ? 'B' : 'A'
}
function loserSideOf(m, g) {
  const w = winnerSideOf(m, g)
  return w === 'A' ? 'B' : 'A'
}
function winnerOpts(m, g) {
  return usableOptions(m, winnerSideOf(m, g))
}
function loserOpts(m, g) {
  return usableOptions(m, loserSideOf(m, g))
}
function isTeam(m) {
  return !!m.isTeam
}
function teamStepOf(phase) {
  return phase && phase.startsWith('team_') ? phase.slice(5) : null
}
function teamStepName(step) {
  return { ban1: '禁用 1 套', protect: '保护', ban2: '再禁用 2 套' }[step] || step
}
function teamBtnLabel(m) {
  const step = teamStepOf(m.deckPhase)
  return '战队BP：' + (step ? teamStepName(step) : '进行中')
}
function teamCanAct(m) {
  const step = teamStepOf(m.deckPhase)
  if (!step) return false
  if (props.isAdmin) return true
  return !!(m.mySide && m.myTeam && !m.myTeam[step])
}
function canTeam(m) {
  return isTeam(m) && teamCanAct(m)
}
function waitingTeam(m) {
  const step = teamStepOf(m.deckPhase)
  if (!step || props.isAdmin || !m.mySide) return false
  return !!(m.myTeam && m.myTeam[step] && m.deckPhase === 'team_' + step)
}
function teamMyDecks(m) {
  const self = m.mySide || teamSide.value || 'A'
  return self === 'A' ? m.bp.aDecks : m.bp.bDecks
}
function teamOppDecks(m) {
  const self = m.mySide || teamSide.value || 'A'
  return self === 'A' ? m.bp.bDecks : m.bp.aDecks
}
function teamOppProtect(m) {
  const self = m.mySide || teamSide.value || 'A'
  return self === 'A' ? m.bp.bProtect : m.bp.aProtect
}
function phaseLabel(m) {
  return (
    {
      bp_decks: '填卡组',
      bp_bans: '禁用中',
      team_ban1: '禁用1套',
      team_protect: '保护中',
      team_ban2: '再禁用2套',
      playing: '比赛中',
      submitted: '待管理员确认',
      confirmed: '已确认',
    }[m.deckPhase] || ''
  )
}

// 操作权限：选手仅本人对阵、且处于对应阶段；管理员可代任一方
function canDo(m, step) {
  if (m.status === 'done' || m.status === 'bye') return false
  // 无BP对阵制：无 Ban/Pick，只开放「提交赛果」，隐藏填卡组/禁用按钮
  if (m.noBP) {
    if (step === 'result') {
      return m.deckPhase !== 'submitted' && (props.isAdmin || (m.mySide && !m.myResultSubmitted))
    }
    return false
  }
  // 战队赛：仅「赛果」与「战队BP」两入口，禁用旧的填卡组/禁用按钮
  if (isTeam(m)) {
    if (step === 'result') {
      return m.bp.revealed && m.deckPhase !== 'submitted' && (props.isAdmin || (m.mySide && !m.myResultSubmitted))
    }
    return false
  }
  if (step === 'decks') {
    if (m.bp.decksRevealed) return false
    if (props.isAdmin) return true
    return m.mySide && !m.myBp?.decksSubmitted
  }
  if (step === 'ban') {
    if (!m.bp.decksRevealed || m.bp.revealed) return false
    if (props.isAdmin) return true
    return m.mySide && !m.myBp?.banSubmitted
  }
  if (step === 'result') {
    if (!m.bp.revealed || m.deckPhase === 'submitted') return false
    if (props.isAdmin) return true
    return m.mySide && !m.myResultSubmitted
  }
  return false
}
function waitingOther(m, step) {
  if (!m.mySide || props.isAdmin || isTeam(m)) return false
  if (step === 'decks') return m.myBp?.decksSubmitted && !m.bp.decksRevealed
  if (step === 'ban') return m.myBp?.banSubmitted && !m.bp.revealed
  return false
}

// 名称解析
function myName(m) {
  return m.mySide === 'A' ? m.slots[0]?.name : m.slots[1]?.name
}
function oppName(m) {
  return m.mySide === 'A' ? m.slots[1]?.name : m.slots[0]?.name
}
function myDecks(m) {
  return m.mySide === 'A' ? m.bp.aDecks : m.bp.bDecks
}
function oppDecks(m) {
  return m.mySide === 'A' ? m.bp.bDecks : m.bp.aDecks
}

// ---------- 填写卡组 ----------
const decksDialog = ref(false)
const deckForm = ref([])
const decksSide = ref('A')
const usedClasses = computed(() => deckForm.value.filter(Boolean))
function openDecks(m) {
  cur.value = m
  const existing = m.myBp?.decks || (props.isAdmin ? [] : [])
  deckForm.value = Array.from({ length: mMeta(m).totalDecks }, (_, i) => existing[i] || '')
  decksSide.value = m.mySide || 'A'
  decksDialog.value = true
}
async function submitDecks() {
  const decks = deckForm.value.map((x) => (x || '').trim()).filter(Boolean)
  const need = mMeta(cur.value).totalDecks
  if (decks.length !== need || decks.some((d) => !d)) {
    ElMessage.error(`需选满 ${need} 套卡组`)
    return
  }
  if (new Set(decks).size !== decks.length) {
    ElMessage.error('职业不可重复')
    return
  }
  try {
    await api.post(`/matches/${props.tournamentId}-${cur.value.id}/bp-decks`, {
      side: props.isAdmin ? decksSide.value : undefined,
      decks,
    })
    ElMessage.success('卡组已提交')
    decksDialog.value = false
    emit('recorded')
  } catch (e) {
    ElMessage.error(e.response?.data?.error || '提交失败')
  }
}

// ---------- 禁用对手卡组 ----------
const banDialog = ref(false)
const banForm = ref(0)
const banSide = ref('A')
function openBan(m) {
  cur.value = m
  banForm.value = 0
  banSide.value = m.mySide || 'A'
  banDialog.value = true
}
async function submitBan() {
  try {
    await api.post(`/matches/${props.tournamentId}-${cur.value.id}/bp-ban`, {
      side: props.isAdmin ? banSide.value : undefined,
      ban: banForm.value,
    })
    ElMessage.success('禁用已提交并公布')
    banDialog.value = false
    emit('recorded')
  } catch (e) {
    ElMessage.error(e.response?.data?.error || '提交失败')
  }
}

// ---------- 战队赛 BP（保护/禁用1/选择首发/再禁用2） ----------
const teamDialog = ref(false)
const teamSide = ref('A')
const teamForm = ref({ ban1: null, protect: null, ban2: [] })
const teamStep = computed(() => (cur.value ? teamStepOf(cur.value.deckPhase) : null))
const teamDialogTitle = computed(() => '战队赛 BP · ' + (teamStep.value ? teamStepName(teamStep.value) : ''))
const teamStepHint = computed(() => {
  const step = teamStep.value
  if (step === 'protect') return '选择 1 套己方职业进行保护：该职业不可被对方 ban，但仍可正常出战。'
  if (step === 'ban1') return '禁用 1 套对方卡组（不能禁用对方已保护的职业）。'
  if (step === 'ban2') return '再禁用 2 套对方卡组（不能禁用对方已保护的职业）。'
  return ''
})
function openTeam(m) {
  cur.value = m
  teamSide.value = m.mySide || 'A'
  teamForm.value = { ban1: null, protect: null, ban2: [] }
  teamDialog.value = true
}
async function submitTeam() {
  const step = teamStepOf(cur.value.deckPhase)
  const body = { step, side: props.isAdmin ? teamSide.value : undefined }
  if (step === 'protect') {
    if (teamForm.value.protect == null) return ElMessage.warning('请选择要保护的职业')
    body.protect = teamForm.value.protect
  } else if (step === 'ban1') {
    if (teamForm.value.ban1 == null) return ElMessage.warning('请选择要禁用的对方卡组')
    body.ban = teamForm.value.ban1
  } else if (step === 'ban2') {
    if (!teamForm.value.ban2 || teamForm.value.ban2.length !== 2) {
      return ElMessage.warning('请选择 2 套要禁用的对方卡组')
    }
    body.ban2 = teamForm.value.ban2
  }
  try {
    await api.post(`/matches/${props.tournamentId}-${cur.value.id}/bp-team`, body)
    ElMessage.success('已提交，等待对方')
    teamDialog.value = false
    emit('recorded')
  } catch (e) {
    ElMessage.error(e.response?.data?.error || '提交失败')
  }
}

// ---------- 提交赛果 ----------
const resultDialog = ref(false)
const resultForm = ref([])
const resultNote = ref('')
function addGame() {
  resultForm.value.push({ winner: 'self', winnerDeck: null, loserDeck: null })
}
function openResult(m) {
  cur.value = m
  const existing = m.myResult?.games || []
  resultForm.value = existing.length
    ? existing.map((g) => ({
        winner: g.winnerSide === (m.mySide || 'A') ? 'self' : 'opp',
        winnerDeck: g.winnerDeck,
        loserDeck: g.loserDeck,
      }))
    : [{ winner: 'self', winnerDeck: null, loserDeck: null }]
  resultNote.value = m.myResult?.note || ''
  resultDialog.value = true
}
async function submitResult() {
  if (resultForm.value.some((g) => g.winnerDeck == null || g.loserDeck == null)) {
    ElMessage.warning('请填全每局的胜方与双方卡组')
    return
  }
  const mySide = cur.value.mySide || 'A'
  const games = resultForm.value.map((g, i) => {
    const winnerSide = g.winner === 'self' ? mySide : mySide === 'A' ? 'B' : 'A'
    return { no: i + 1, winnerSide, winnerDeck: g.winnerDeck, loserDeck: g.loserDeck }
  })
  try {
    await api.post(`/matches/${props.tournamentId}-${cur.value.id}/result-submit`, {
      side: props.isAdmin ? mySide : undefined,
      games,
      note: resultNote.value,
    })
    ElMessage.success('赛果已提交，等待管理员确认')
    resultDialog.value = false
    emit('recorded')
  } catch (e) {
    ElMessage.error(e.response?.data?.error || '提交失败')
  }
}

// ---------- 管理员审核 ----------
const reviewDialog = ref(false)
const reviewWinner = ref(null)
const reviewNote = ref('')
function consistent(rv) {
  const a = rv.a.games
  const b = rv.b.games
  if (a.length !== b.length) return false
  return a.every(
    (g, i) => g.winnerSide === b[i].winnerSide && g.winnerDeck === b[i].winnerDeck && g.loserDeck === b[i].loserDeck
  )
}
function openReview(m) {
  cur.value = m
  reviewWinner.value = consistent(m.adminReview) ? null : null
  reviewNote.value = ''
  reviewDialog.value = true
}
async function confirmResult() {
  const rv = cur.value.adminReview
  if (!consistent(rv) && !reviewWinner.value) {
    ElMessage.warning('双方提交不一致，请先指定胜方')
    return
  }
  try {
    await api.post(`/matches/${props.tournamentId}-${cur.value.id}/admin-confirm`, {
      action: 'confirm',
      winnerSide: reviewWinner.value || undefined,
      note: reviewNote.value,
    })
    ElMessage.success('已确认并晋级')
    reviewDialog.value = false
    emit('recorded')
  } catch (e) {
    ElMessage.error(e.response?.data?.error || '确认失败')
  }
}
async function rejectResult() {
  try {
    await api.post(`/matches/${props.tournamentId}-${cur.value.id}/admin-confirm`, {
      action: 'reject',
      note: reviewNote.value,
    })
    ElMessage.success('已驳回，双方可重新提交')
    reviewDialog.value = false
    emit('recorded')
  } catch (e) {
    ElMessage.error(e.response?.data?.error || '驳回失败')
  }
}
</script>

<style scoped>
.bracket-wrap {
  margin-top: 8px;
}
.standings {
  margin-bottom: 16px;
}
.sec-head h4 {
  margin: 14px 0 8px;
  font-weight: 700;
  color: #0f172a;
  letter-spacing: 0.5px;
  border-left: 3px solid var(--hs-accent);
  padding-left: 10px;
}
.sec-note {
  margin-left: 8px;
  font-size: 12px;
  font-weight: 500;
  color: var(--hs-text-mute);
}
.standings h4 {
  margin: 4px 0 8px;
  font-weight: 700;
  color: var(--hs-accent-strong);
  letter-spacing: 1px;
}
.bracket {
  display: flex;
  gap: 24px;
  overflow-x: auto;
  padding: 8px 0;
}
.round {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 230px;
  justify-content: space-around;
}
.round-name {
  font-weight: 700;
  text-align: center;
  margin-bottom: 4px;
  font-size: 13px;
  letter-spacing: 2px;
  text-transform: uppercase;
  color: var(--hs-accent-strong);
}
/* 对阵卡：白底 HUD 面板 + 细青边 */
.match {
  position: relative;
  border: 1px solid rgba(15, 23, 42, 0.12);
  border-radius: 4px;
  padding: 8px;
  background-color: #ffffff;
  display: flex;
  flex-direction: column;
  gap: 6px;
  box-shadow: 0 2px 10px rgba(15, 23, 42, 0.06);
  transition: border-color 0.16s ease, box-shadow 0.16s ease;
}
.match:hover {
  border-color: var(--hs-line);
}
.match.done {
  border-color: rgba(5, 150, 105, 0.45);
}
.match.draw {
  border-color: rgba(217, 119, 6, 0.5);
}
.match.mine {
  border-color: var(--hs-accent);
  box-shadow: 0 0 0 2px rgba(8, 145, 178, 0.16);
}
.slot {
  display: flex;
  justify-content: space-between;
  padding: 4px 8px;
  border-radius: 3px;
  background: #f1f5f9;
  border: 1px solid transparent;
  color: var(--hs-text-dim);
}
.slot.win {
  background: #ecfdf5;
  border-color: rgba(5, 150, 105, 0.35);
  color: #047857;
  font-weight: 700;
}
.bye-tag {
  color: var(--hs-text-mute);
  font-size: 12px;
  text-align: center;
}
.rec {
  align-self: center;
}
.rec-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 8px 0;
}
.muted {
  color: var(--hs-text-mute);
  font-size: 12px;
}
.bp-line {
  text-align: center;
  display: flex;
  gap: 6px;
  justify-content: center;
  flex-wrap: wrap;
}
.badge {
  font-size: 12px;
  padding: 1px 8px;
  border-radius: 2px;
  border: 1px solid transparent;
}
.badge.warn {
  background: #fffbeb;
  color: #b45309;
  border-color: rgba(217, 119, 6, 0.35);
}
.badge.ok {
  background: #ecfdf5;
  color: #047857;
  border-color: rgba(5, 150, 105, 0.35);
}
.badge.phase {
  background: #ecfeff;
  color: var(--hs-accent-strong);
  border-color: rgba(8, 145, 178, 0.35);
}
.bp-decks {
  display: flex;
  gap: 8px;
}
.bp-decks .side {
  flex: 1;
  border: 1px dashed rgba(8, 145, 178, 0.35);
  border-radius: 3px;
  padding: 6px;
  background: #f8fafc;
}
.bp-decks .side.win {
  border-color: rgba(5, 150, 105, 0.55);
  background: #ecfdf5;
}
.side-title {
  font-size: 12px;
  font-weight: 700;
  margin-bottom: 4px;
  color: var(--hs-accent-strong);
}
.deck {
  font-size: 12px;
  padding: 2px 5px;
  border-radius: 3px;
  background: rgba(148, 163, 184, 0.08);
  color: var(--hs-text-dim);
  margin-bottom: 2px;
}
.deck em {
  font-style: normal;
  margin-left: 4px;
  color: var(--hs-text-mute);
}
.deck.banned {
  text-decoration: line-through;
  color: #94a3b8;
}
.deck.conquered {
  background: #d1fae5;
  color: #047857;
}
.deck.dead {
  background: #fee2e2;
  color: #b91c1c;
  text-decoration: line-through;
}
.deck.usable {
  background: #cffafe;
  color: var(--hs-accent-strong);
}
.games {
  font-size: 12px;
  color: var(--hs-text-dim);
}
.game {
  padding: 1px 0;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: center;
}
.bp-edit .ban-row {
  margin: 12px 0;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.side-pick {
  margin-top: 12px;
}
.game-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 0;
  flex-wrap: wrap;
}
.note {
  margin-top: 10px;
}
.review-cols {
  display: flex;
  gap: 16px;
}
.review-cols .rv {
  flex: 1;
  border: 1px solid var(--hs-line-soft);
  border-radius: 3px;
  padding: 8px;
  background: #f8fafc;
}
.review-cols h5 {
  margin: 0 0 6px;
  color: var(--hs-accent-strong);
  font-size: 13px;
  font-weight: 700;
}
.ok {
  color: var(--hs-win);
}
.bad {
  color: var(--hs-lose);
}
</style>
