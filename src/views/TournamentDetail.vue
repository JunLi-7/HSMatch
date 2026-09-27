<template>
  <div class="page" v-if="tournament">
    <el-page-header @back="$router.push('/')" content="赛事详情" />
    <div class="detail-head">
      <h2>{{ tournament.name }}</h2>
      <el-tag :type="statusType(tournament.status)">{{ statusLabel(tournament.status) }}</el-tag>
    </div>
    <p class="muted">{{ tournament.description || '暂无简介' }}</p>
    <el-descriptions :column="3" border size="small">
      <el-descriptions-item label="赛制">{{ formatLabel(tournament.format) }}</el-descriptions-item>
      <el-descriptions-item v-if="tournament.group_count" label="分组">{{ tournament.group_count }} 组</el-descriptions-item>
      <el-descriptions-item label="对阵制">
        <template v-if="segs.length">
          <div v-for="(s, i) in segs" :key="i" class="seg-line">
            <el-tag size="small" type="info">{{ stageLabel(s.appliesTo) }}</el-tag>
            {{ segmentSummary(s) }}
          </div>
        </template>
        <template v-else>无（直接录比分）</template>
      </el-descriptions-item>
      <el-descriptions-item label="参赛人数">{{ tournament.registeredCount }}/{{ tournament.max_participants }}</el-descriptions-item>
      <el-descriptions-item label="我的状态">{{ tournament.myRegistration ? '已报名' : '未报名' }}</el-descriptions-item>
    </el-descriptions>

    <div class="actions" v-if="isPlayer">
      <el-button v-if="canRegister" type="primary" @click="doRegister">一键报名</el-button>
      <el-tag v-else-if="tournament.myRegistration" type="success">你已报名</el-tag>
    </div>

    <el-alert
      v-if="tournament.status === 'finished' && tournament.champion"
      type="success"
      :title="`冠军：${tournament.champion.name}`"
      show-icon
      :closable="false"
      style="margin: 12px 0"
    />

    <div v-if="tournament.bracket" class="bracket-wrap">
      <h3>对阵表</h3>
      <BracketTree
        :bracket="tournament.bracket"
        :is-admin="isAdmin"
        :tournament-id="tournament.id"
        :format="tournament.format"
        :match-format="tournament.match_format"
        :rule="tournament.rule"
        @recorded="load"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import api from '../lib/api.js'
import { ElMessage } from 'element-plus'
import { useAuth } from '../composables/auth.js'
import { SUPPORTED_FORMATS } from '../lib/bracket.js'
import { segmentSummary, STAGE_LABEL } from '../lib/matchFormats.js'
import BracketTree from '../components/BracketTree.vue'

const route = useRoute()
const { isAdmin } = useAuth()
const tournament = ref(null)
const id = route.params.id
let timer = null

const fmtMap = Object.fromEntries(SUPPORTED_FORMATS.map((f) => [f.value, f.label]))

// 可组合对阵制分段（format_segments）
const segs = computed(() => {
  const t = tournament.value
  if (!t || !t.format_segments) return []
  try {
    return JSON.parse(t.format_segments)
  } catch {
    return []
  }
})
function stageLabel(a) {
  return STAGE_LABEL[a] || a || '全程'
}
const isPlayer = computed(() => {
  const u = JSON.parse(localStorage.getItem('user') || 'null')
  return u && u.role === 'player'
})
const canRegister = computed(
  () =>
    tournament.value &&
    tournament.value.status === 'open' &&
    !tournament.value.myRegistration &&
    tournament.value.registeredCount < tournament.value.max_participants
)

async function load() {
  const { data } = await api.get(`/tournaments/${id}`)
  tournament.value = data.tournament
}
async function doRegister() {
  try {
    await api.post(`/tournaments/${id}/register`)
    ElMessage.success('报名成功')
    load()
  } catch (e) {
    ElMessage.error(e.response?.data?.error || '报名失败')
  }
}

onMounted(() => {
  load()
  timer = setInterval(load, 5000) // 轮询，多设备实时刷新对阵
})
onUnmounted(() => timer && clearInterval(timer))

function statusType(s) {
  return { draft: 'info', open: 'success', ongoing: 'warning', finished: 'primary' }[s] || 'info'
}
function statusLabel(s) {
  return { draft: '草稿', open: '报名中', ongoing: '进行中', finished: '已结束' }[s] || s
}
function formatLabel(f) {
  return fmtMap[f] || f
}
function matchFormatLabel(f) {
  return f && f !== 'none' ? mfMap[f] || f : '无（直接录比分）'
}
function ruleLabel(r) {
  return r ? ruleMap[r] || r : '—'
}
</script>

<style scoped>
.page {
  padding: 16px;
}
.detail-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 8px 0;
}
.actions {
  margin: 12px 0;
}
.muted {
  color: var(--hs-text-mute);
}
/* 对阵表小节标题：HUD 竖条 */
.bracket-wrap h3 {
  font-weight: 700;
  letter-spacing: 0.5px;
  color: #0f172a;
  border-left: 3px solid var(--hs-accent);
  padding-left: 10px;
  margin: 18px 0 8px;
}
</style>
