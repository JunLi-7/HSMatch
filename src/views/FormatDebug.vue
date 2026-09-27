<template>
  <div class="debug">
    <el-card class="panel" shadow="never">
      <template #header><b>赛制调试 · 管理员</b></template>
      <el-form :model="form" label-width="100px" inline>
        <el-form-item label="参赛人数">
          <el-input-number v-model="form.count" :min="1" :max="128" />
        </el-form-item>
        <el-form-item label="赛制">
          <el-select v-model="form.format" style="width: 200px">
            <el-option
              v-for="f in formats"
              :key="f.value"
              :label="f.label"
              :value="f.value"
              :disabled="f.disabled"
            />
          </el-select>
        </el-form-item>
        <el-form-item v-if="isGroupFormat" label="分组数量">
          <el-input-number v-model="form.groupCount" :min="2" :max="Math.max(2, Math.floor((form.count||2)/2))" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="generate">生成对阵</el-button>
        </el-form-item>
      </el-form>

      <!-- 对阵制（与创建赛事一致的可组合机制） -->
      <el-divider content-position="left">对阵制（可组合，与创建赛事同源）</el-divider>
      <el-form :model="form" label-width="100px">
        <el-form-item label="对阵制类型">
          <el-radio-group v-model="form.matchKind">
            <el-radio value="none">无（直接录比分）</el-radio>
            <el-radio value="custom">自定义</el-radio>
            <el-radio value="team">战队赛</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-alert
          v-if="form.matchKind === 'team'"
          type="info"
          :closable="false"
          title="战队赛固定：11 套卡组、保护1 + 禁用1 + 再禁用2（ban3）、BO11、KOF 擂台。"
        />
        <template v-if="form.matchKind === 'custom'">
          <div class="seg-tip">
            每段 5 参数：BO（几局几胜）· 规则（征服/KOF）· ban 数量（0=无ban）· 携带卡组数 · 适用赛程范围。
            一致性：携带 N、ban X → pick=N−X → BO=2×pick−1（带4禁1 → BO5）。把范围限定到后期（如四强起）会自动补一段「全程」覆盖前期。
          </div>
          <div v-for="(seg, si) in form.segments" :key="si" class="seg-card">
            <div class="seg-head">
              <span class="seg-idx">分段 {{ si + 1 }}</span>
            </div>
            <div class="seg-row">
              <el-form-item label="适用范围">
                <el-select v-model="seg.appliesTo" @change="onStageChange" style="width: 150px">
                  <el-option v-for="o in stageOptions" :key="o.value" :value="o.value" :label="o.label" />
                </el-select>
              </el-form-item>
              <el-form-item label="BO">
                <el-select v-model="seg.bo" style="width: 100px">
                  <el-option v-for="b in boOptions" :key="b" :value="b" :label="`BO${b}`" />
                </el-select>
              </el-form-item>
              <el-form-item label="规则">
                <el-select v-model="seg.rule" style="width: 130px">
                  <el-option v-for="r in rules" :key="r.value" :value="r.value" :label="r.label" />
                </el-select>
              </el-form-item>
            </div>
            <div class="seg-row">
              <el-form-item label="ban 数量">
                <el-input-number v-model="seg.ban" :min="0" :max="Math.max(0,(seg.decks||2)-1)" />
              </el-form-item>
              <el-form-item label="携带卡组">
                <el-input-number v-model="seg.decks" :min="2" :max="11" />
              </el-form-item>
            </div>
            <div class="seg-valid" :class="validateFormat(seg).ok ? 'ok' : 'bad'">
              <template v-if="validateFormat(seg).ok">✓ 一致：{{ segmentSummary(seg) }}</template>
              <template v-else>✗ {{ validateFormat(seg).error }}</template>
            </div>
          </div>
          <el-button
            v-if="canAddLateSeg"
            size="small"
            @click="addLateSeg"
            >＋ 增加后期赛程分段</el-button
          >
        </template>
      </el-form>

      <el-checkbox v-model="form.virtualFill" style="margin-top: 8px">
        空位自动生成虚拟选手（填满轮空，便于查看完整对阵树）
      </el-checkbox>

      <el-alert v-if="error" type="error" :closable="false" :title="error" />

      <el-descriptions v-if="bracket" border class="summary" :column="3">
        <el-descriptions-item label="赛制">{{ formatLabel(form.format) }}</el-descriptions-item>
        <el-descriptions-item label="参赛人数">{{ realCount }}</el-descriptions-item>
        <el-descriptions-item label="总槽位/人数">{{ bracket.size }}</el-descriptions-item>
        <el-descriptions-item label="轮空数">{{ bracket.byes }}</el-descriptions-item>
        <el-descriptions-item label="轮次数">{{ bracket.roundsCount || '—' }}</el-descriptions-item>
        <el-descriptions-item label="总场次">{{ totalMatches }}</el-descriptions-item>
      </el-descriptions>

      <!-- 分段解析预览：淘汰赛每轮应用哪段对阵制 -->
      <el-table v-if="stagePreview.length" :data="stagePreview" size="small" border class="summary">
        <el-table-column prop="round" label="轮次" width="70" />
        <el-table-column prop="label" label="阶段" width="140" />
        <el-table-column prop="appliesTo" label="适用范围" width="120">
          <template #default="{ row }">{{ stageLabel(row.appliesTo) }}</template>
        </el-table-column>
        <el-table-column prop="seg" label="应用对阵制" />
      </el-table>
    </el-card>

    <!-- 对阵树可视化：按轮次分列展示 -->
    <div v-if="bracket && bracket.rounds.length" class="bracket">
      <div v-for="(round, ri) in bracket.rounds" :key="ri" class="round-col">
        <div class="round-title">{{ round[0] && round[0].roundName ? round[0].roundName : roundName(ri) }}</div>
        <div class="matches">
          <div v-for="m in round" :key="m.id" class="match">
            <div class="slot" :class="{ bye: m.isBye && !m.slots[0] }">
              <span class="seed" v-if="m.slots[0]">[{{ m.slots[0].seed }}]</span>
              {{ m.slots[0] ? m.slots[0].name : m.isBye ? '轮空' : '待定' }}
            </div>
            <div class="slot" :class="{ bye: m.isBye && !m.slots[1] }">
              <span class="seed" v-if="m.slots[1]">[{{ m.slots[1].seed }}]</span>
              {{ m.slots[1] ? m.slots[1].name : m.isBye ? '轮空' : '待定' }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <el-empty v-if="bracket && !bracket.rounds.length" description="单人参赛，无需对阵" />
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { generateBracket, SUPPORTED_FORMATS } from '../lib/bracket.js'
import {
  RULES,
  defaultSegment,
  validateFormat,
  normalizeSegments,
  resolveSegment,
  roundStageLevel,
  stageOptionsFor,
  segmentSummary,
  STAGE_LABEL,
} from '../lib/matchFormats.js'

const formats = SUPPORTED_FORMATS
const rules = RULES
const boOptions = [1, 3, 5, 7, 9, 11]
const form = ref({
  count: 8,
  format: 'single_elimination',
  groupCount: 4,
  matchKind: 'none',
  segments: defaultSegment('single_elimination'),
  virtualFill: false,
})
const bracket = ref(null)
const error = ref('')

const isGroupFormat = computed(() => form.value.format === 'round_robin')
const stageOptions = computed(() => stageOptionsFor(form.value.format))
const realCount = computed(() => form.value.count)

function nextPow2(n) {
  let p = 1
  while (p < n) p *= 2
  return p
}

// 适用范围变更 → 自动补齐覆盖前期的「全程」分段
function onStageChange() {
  form.value.segments = normalizeSegments(form.value.segments, form.value.format)
}
const canAddLateSeg = computed(
  () =>
    (form.value.format === 'single_elimination' || form.value.format === 'double_elimination') &&
    !form.value.segments.some((s) => ['quarter', 'semi', 'final'].includes(s.appliesTo))
)
function addLateSeg() {
  form.value.segments.push({ appliesTo: 'semi', rule: 'conquest', bo: 5, ban: 1, decks: 4 })
  form.value.segments = normalizeSegments(form.value.segments, form.value.format)
}

const fmtMap = Object.fromEntries(SUPPORTED_FORMATS.map((f) => [f.value, f.label]))
function formatLabel(f) {
  return fmtMap[f] || f
}
function stageLabel(a) {
  return STAGE_LABEL[a] || a || '全程'
}

const totalMatches = computed(() =>
  bracket.value ? bracket.value.rounds.reduce((s, r) => s + r.length, 0) : 0
)

function roundName(ri) {
  const b = bracket.value
  if (!b || !b.roundsCount) return ''
  const round = ri + 1
  if (round === b.roundsCount) return '决赛'
  if (round === b.roundsCount - 1) return '半决赛'
  if (round === b.roundsCount - 2) return '四分之一决赛'
  return `第 ${round} 轮`
}

// 淘汰赛：每轮解析应用哪段对阵制（验证「适用赛程范围」是否符合预期）
const stagePreview = computed(() => {
  if (form.value.matchKind !== 'custom' || !bracket.value) return []
  if (!(form.value.format === 'single_elimination' || form.value.format === 'double_elimination')) return []
  const segs = normalizeSegments(form.value.segments, form.value.format)
  const rc = bracket.value.roundsCount || bracket.value.rounds.length
  const rows = []
  for (let r = 1; r <= rc; r++) {
    const seg = resolveSegment(segs, { stage: null, round: r, totalRounds: rc })
    const lvl = roundStageLevel(r, rc)
    const label = lvl === 4 ? '决赛' : lvl === 3 ? '半决赛（四强）' : lvl === 2 ? '八强' : `第 ${r} 轮`
    rows.push({ round: r, label, appliesTo: seg.appliesTo, seg: segmentSummary(seg) })
  }
  return rows
})

function generate() {
  error.value = ''
  try {
    const count = Number(form.value.count) || 1
    let participants
    if (form.value.virtualFill) {
      // 用虚拟选手填满空位：淘汰赛补到 2 的幂；小组循环保证每组至少 2 人
      let size
      if (isGroupFormat.value) {
        const gc = Math.max(2, Math.floor(count / 2))
        size = Math.max(count, gc * 2)
      } else {
        size = nextPow2(count)
      }
      participants = []
      for (let i = 1; i <= size; i++) {
        if (i <= count) participants.push({ id: 'p' + i, name: '选手' + i })
        else participants.push({ id: 'v' + i, name: '虚拟' + i })
      }
    } else {
      participants = count
    }
    const opts = isGroupFormat.value ? { groupCount: form.value.groupCount } : undefined
    bracket.value = generateBracket(form.value.format, participants, opts)
  } catch (e) {
    error.value = e.message
    ElMessage.error(e.message)
  }
}

generate() // 初始渲染
</script>

<style scoped>
.debug {
  padding: 8px;
}
.panel {
  margin-bottom: 16px;
}
.summary {
  margin-top: 12px;
}
.seg-tip {
  background: #f1f5f9;
  border: 1px solid var(--hs-line-soft);
  border-radius: 4px;
  padding: 8px 10px;
  font-size: 12px;
  color: var(--hs-text-dim);
  margin-bottom: 12px;
  line-height: 1.6;
}
.seg-card {
  border: 1px solid var(--hs-line-soft);
  border-radius: 6px;
  padding: 10px 12px;
  margin-bottom: 12px;
  background: #fcfdfe;
}
.seg-head {
  margin-bottom: 6px;
}
.seg-idx {
  font-weight: 700;
  color: var(--hs-accent-strong);
}
.seg-row {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}
.seg-row :deep(.el-form-item) {
  margin-bottom: 10px;
}
.seg-valid {
  font-size: 12px;
  padding: 4px 8px;
  border-radius: 3px;
  margin-top: 4px;
}
.seg-valid.ok {
  background: #ecfdf5;
  color: #047857;
}
.seg-valid.bad {
  background: #fef2f2;
  color: #b91c1c;
}
.bracket {
  display: flex;
  gap: 40px;
  overflow-x: auto;
  padding: 8px 0 24px;
  align-items: center;
}
.round-col {
  display: flex;
  flex-direction: column;
}
.round-title {
  font-weight: 700;
  text-align: center;
  margin-bottom: 12px;
  letter-spacing: 1px;
  color: var(--hs-accent-strong);
}
.matches {
  display: flex;
  flex-direction: column;
  justify-content: space-around;
  gap: 16px;
  flex: 1;
}
.match {
  width: 180px;
  border: 1px solid var(--hs-line-soft);
  border-radius: 4px;
  overflow: hidden;
  background-color: #ffffff;
  box-shadow: 0 2px 10px rgba(15, 23, 42, 0.08);
  color: var(--hs-text-dim);
}
.slot {
  padding: 8px 10px;
  font-size: 13px;
}
.slot + .slot {
  border-top: 1px solid var(--hs-line-soft);
}
.slot.bye {
  color: var(--hs-text-mute);
  background: #f1f5f9;
}
.seed {
  color: var(--hs-accent);
  margin-right: 4px;
  font-weight: 700;
}
</style>
