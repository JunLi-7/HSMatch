<template>
  <div class="page">
    <div class="page-head">
      <h2>赛事大厅</h2>
      <p class="muted">已发布、进行中与已结束的赛事都在这里。点击赛事查看对阵与报名。</p>
    </div>
    <el-row :gutter="16">
      <el-col v-for="t in tournaments" :key="t.id" :xs="24" :sm="12" :md="8">
        <el-card class="t-card" shadow="hover" @click="open(t)">
          <div class="t-title">{{ t.name }}</div>
          <div class="muted t-desc">{{ t.description || '暂无简介' }}</div>
          <el-tag size="small" :type="statusType(t.status)">{{ statusLabel(t.status) }}</el-tag>
          <div class="t-meta">赛制：{{ formatLabel(t.format) }} ｜ 人数：{{ t.registeredCount }}/{{ t.max_participants }}</div>
          <div class="t-actions">
            <el-button v-if="canRegister(t)" type="primary" size="small" @click.stop="register(t)">一键报名</el-button>
            <el-tag v-else-if="t.myRegistration" type="success" size="small">已报名</el-tag>
            <el-tag v-else-if="t.status === 'open'" type="info" size="small">名额已满</el-tag>
            <el-button size="small" text @click.stop="open(t)">查看对阵</el-button>
          </div>
        </el-card>
      </el-col>
    </el-row>
    <el-empty v-if="!tournaments.length" description="暂无可参加的赛事" />
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import api from '../lib/api.js'
import { ElMessage } from 'element-plus'
import { SUPPORTED_FORMATS } from '../lib/bracket.js'

const router = useRouter()
const tournaments = ref([])
const fmtMap = Object.fromEntries(SUPPORTED_FORMATS.map((f) => [f.value, f.label]))

async function load() {
  const { data } = await api.get('/tournaments')
  tournaments.value = data.tournaments
}
onMounted(load)

function open(t) {
  router.push(`/tournaments/${t.id}`)
}
function canRegister(t) {
  return t.status === 'open' && !t.myRegistration && t.registeredCount < t.max_participants
}
async function register(t) {
  try {
    await api.post(`/tournaments/${t.id}/register`)
    ElMessage.success(
      t.registeredCount + 1 >= t.max_participants ? '报名成功，人数已满，已自动抽签！' : '报名成功'
    )
    load()
  } catch (e) {
    ElMessage.error(e.response?.data?.error || '报名失败')
  }
}
function statusType(s) {
  return { draft: 'info', open: 'success', ongoing: 'warning', finished: 'primary' }[s] || 'info'
}
function statusLabel(s) {
  return { draft: '草稿', open: '报名中', ongoing: '进行中', finished: '已结束' }[s] || s
}
function formatLabel(f) {
  return fmtMap[f] || f
}
</script>

<style scoped>
.page {
  padding: 16px;
}
.page-head {
  margin-bottom: 16px;
}
/* 赛事卡片：浅色 HUD 面板（左侧青色指示条 + 悬停轻微上浮） */
.t-card {
  position: relative;
  margin-bottom: 16px;
  cursor: pointer;
  border-radius: 4px;
  overflow: hidden;
  background-color: #ffffff;
  transition: transform 0.16s ease, box-shadow 0.16s ease, border-color 0.16s ease;
}
.t-card::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: var(--hs-accent);
  opacity: 0.65;
  transition: opacity 0.16s ease;
}
.t-card:hover {
  transform: translateY(-2px);
  border-color: var(--hs-line);
  box-shadow: 0 10px 22px rgba(15, 23, 42, 0.12);
}
.t-card:hover::before {
  opacity: 1;
}
.t-title {
  font-size: 17px;
  font-weight: 700;
  letter-spacing: 0.4px;
  margin-bottom: 6px;
  color: #0f172a;
}
.t-desc {
  font-size: 13px;
  min-height: 20px;
  margin-bottom: 8px;
}
.t-meta {
  font-size: 13px;
  color: var(--hs-text-dim);
  margin: 8px 0;
}
.t-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.muted {
  color: var(--hs-text-mute);
}
</style>
