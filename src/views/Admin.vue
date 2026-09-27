<template>
  <div class="page">
    <div class="page-head">
      <h2>管理后台</h2>
    </div>

    <el-tabs v-model="activeTab" @tab-change="onTabChange">
      <!-- 赛事管理 -->
      <el-tab-pane label="赛事管理" name="tournaments">
        <div class="pane-head">
          <el-button type="primary" @click="showCreate = true">+ 创建赛事</el-button>
        </div>
        <el-table :data="tournaments" stripe>
          <el-table-column prop="name" label="赛事" min-width="140" />
          <el-table-column label="赛制" width="120">
            <template #default="{ row }">{{ formatLabel(row.format) }}</template>
          </el-table-column>
          <el-table-column label="人数" width="100">
            <template #default="{ row }">{{ row.registeredCount }}/{{ row.max_participants }}</template>
          </el-table-column>
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <el-tag :type="statusType(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" min-width="220">
            <template #default="{ row }">
              <el-button size="small" @click="goDetail(row)">查看/录分</el-button>
              <el-button v-if="row.status === 'draft'" size="small" type="success" @click="publish(row)">发布</el-button>
              <el-button
                v-if="row.status === 'open' && row.registeredCount >= row.max_participants"
                size="small"
                type="warning"
                @click="draw(row)"
                >抽签</el-button
              >
              <el-button
                v-if="row.status === 'draft' || row.status === 'open' || row.status === 'ongoing' || row.status === 'finished'"
                size="small"
                type="danger"
                @click="remove(row)"
                >删除</el-button
              >
            </template>
          </el-table-column>
        </el-table>

        <el-dialog v-model="showCreate" title="创建赛事" width="560px">
          <el-form :model="form" label-width="92px">
            <el-form-item label="名称" required>
              <el-input v-model="form.name" />
            </el-form-item>
            <el-form-item label="简介">
              <el-input v-model="form.description" type="textarea" :rows="2" />
            </el-form-item>
            <el-form-item label="赛制">
              <el-select v-model="form.format">
                <el-option v-for="f in formats" :key="f.value" :value="f.value" :label="`${f.label}（${f.desc}）`" />
              </el-select>
            </el-form-item>

            <!-- 小组循环：分组数量 -->
            <el-form-item v-if="isGroupFormat" label="分组数量" required>
              <el-input-number v-model="form.groupCount" :min="2" :max="maxGroups" />
              <div class="hint">
                总人数尽量平均分组（每组至少 2 人）；组内单循环随机排位、每对只打一次。
                出线：4 人及以下出 1 人，5 人及以上出 2 人。
              </div>
            </el-form-item>

            <!-- 对阵制类型 -->
            <el-form-item label="对阵制">
              <el-radio-group v-model="matchKind">
                <el-radio value="none">无（直接录比分）</el-radio>
                <el-radio value="custom">自定义</el-radio>
                <el-radio value="team">战队赛</el-radio>
              </el-radio-group>
            </el-form-item>

            <!-- 战队赛：固定不拆 5 框 -->
            <el-alert
              v-if="matchKind === 'team'"
              type="info"
              :closable="false"
              title="战队赛固定为 KOF 擂台：11 套卡组，保护1 + 禁用1 + 再禁用2（共 ban 3 套、剩 8 套可用），BO11。"
            />

            <!-- 自定义：可组合分段（每段 5 框） -->
            <template v-if="matchKind === 'custom'">
              <div class="seg-tip">
                每段由 5 个参数组成：<b>BO（几局几胜）</b> · <b>规则（征服/KOF）</b> · <b>ban 数量</b> · <b>携带卡组数</b> · <b>适用赛程范围</b>。
                一致性规则：携带 N 套、ban X 套 → 可用 pick = N−X 套 → 应对应 BO = 2×pick−1（如 带4禁1 → BO5）。
              </div>
              <div v-for="(seg, si) in segments" :key="si" class="seg-card">
                <div class="seg-head">
                  <span class="seg-idx">分段 {{ si + 1 }}</span>
                  <el-button
                    v-if="segments.length > 1"
                    size="small"
                    text
                    type="danger"
                    @click="removeSeg(si)"
                    >删除此段</el-button
                  >
                </div>
                <el-form-item label="适用范围" required>
                  <el-select v-model="seg.appliesTo" @change="onStageChange" style="width: 160px">
                    <el-option v-for="o in stageOptions" :key="o.value" :value="o.value" :label="o.label" />
                  </el-select>
                  <span class="hint">{{ stageHint(seg.appliesTo) }}</span>
                </el-form-item>
                <div class="seg-row">
                  <el-form-item label="BO" required>
                    <el-select v-model="seg.bo" style="width: 110px">
                      <el-option v-for="b in boOptions" :key="b" :value="b" :label="`BO${b}`" />
                    </el-select>
                  </el-form-item>
                  <el-form-item label="规则" required>
                    <el-select v-model="seg.rule" style="width: 140px">
                      <el-option v-for="r in rules" :key="r.value" :value="r.value" :label="`${r.label}`" />
                    </el-select>
                  </el-form-item>
                </div>
                <div class="seg-row">
                  <el-form-item label="ban 数量" required>
                    <el-input-number v-model="seg.ban" :min="0" :max="Math.max(0, (seg.decks || 2) - 1)" />
                    <span class="hint">0 = 无 ban，直接选可用卡组</span>
                  </el-form-item>
                  <el-form-item label="携带卡组" required>
                    <el-input-number v-model="seg.decks" :min="2" :max="11" />
                    <span class="hint">一个职业一套，2–11</span>
                  </el-form-item>
                </div>
                <div class="seg-valid" :class="validateFormat(seg).ok ? 'ok' : 'bad'">
                  <template v-if="validateFormat(seg).ok">
                    ✓ 一致：{{ segmentSummary(seg) }}
                  </template>
                  <template v-else>✗ {{ validateFormat(seg).error }}</template>
                </div>
              </div>

              <el-button
                v-if="canAddLateSeg"
                size="small"
                @click="addLateSeg"
                >＋ 增加后期赛程分段（如限定四强后改用不同对阵制）</el-button
              >
            </template>

            <el-form-item label="参赛人数" required>
              <el-input-number v-model="form.maxParticipants" :min="2" :max="128" />
            </el-form-item>
            <el-form-item label="瑞士轮轮数" v-if="form.format === 'swiss'">
              <el-input-number v-model="form.rounds" :min="1" :max="31" />
              <span class="hint">留空按 log2(人数) 自动估算</span>
            </el-form-item>
          </el-form>
          <template #footer>
            <el-button @click="showCreate = false">取消</el-button>
            <el-button type="primary" :disabled="!allValid" @click="create">创建</el-button>
          </template>
        </el-dialog>
      </el-tab-pane>

      <!-- 用户管理 -->
      <el-tab-pane label="用户管理" name="users">
        <div class="pane-head">
          <el-input
            v-model="userQuery"
            placeholder="搜索用户名 / 昵称"
            clearable
            style="width: 240px"
            @input="loadUsers"
            @clear="loadUsers"
          />
          <el-button type="primary" @click="showAddUser = true">+ 新增账号</el-button>
        </div>
        <el-table :data="users" stripe>
          <el-table-column prop="username" label="用户名" min-width="120" />
          <el-table-column prop="full_name" label="昵称" min-width="120" />
          <el-table-column label="角色" width="100">
            <template #default="{ row }">
              <el-tag :type="row.role === 'admin' ? 'danger' : 'info'" size="small">
                {{ row.role === 'admin' ? '管理员' : '选手' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="报名" width="140">
            <template #default="{ row }">
              <el-tag v-if="row.reg_count > 0" type="warning" size="small">已报名 {{ row.reg_count }} 场</el-tag>
              <el-tag v-else type="success" size="small">无</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="created_at" label="创建时间" min-width="180" />
          <el-table-column label="操作" min-width="180">
            <template #default="{ row }">
              <el-button size="small" @click="openReset(row)">重置密码</el-button>
              <el-tooltip
                v-if="row.reg_count > 0"
                content="该账号有赛事报名记录，无法删除"
                placement="top"
              >
                <el-button size="small" type="danger" disabled>删除</el-button>
              </el-tooltip>
              <el-button
                v-else
                size="small"
                type="danger"
                :disabled="row.id === me?.id"
                @click="removeUser(row)"
                >删除</el-button
              >
            </template>
          </el-table-column>
        </el-table>

        <!-- 新增账号 -->
        <el-dialog v-model="showAddUser" title="新增账号" width="420px">
          <el-form :model="userForm" label-width="80px">
            <el-form-item label="用户名" required>
              <el-input v-model="userForm.username" placeholder="3-30 位，含汉字/字母/数字/#/丨" />
            </el-form-item>
            <el-form-item label="密码" required>
              <el-input v-model="userForm.password" placeholder="至少 6 位" />
            </el-form-item>
            <el-form-item label="昵称">
              <el-input v-model="userForm.fullName" placeholder="选填，可含汉字/字母/数字/#/丨，默认同用户名" />
            </el-form-item>
            <el-form-item label="角色">
              <el-select v-model="userForm.role">
                <el-option value="player" label="选手" />
                <el-option value="admin" label="管理员" />
              </el-select>
            </el-form-item>
          </el-form>
          <template #footer>
            <el-button @click="showAddUser = false">取消</el-button>
            <el-button type="primary" @click="addUser">创建</el-button>
          </template>
        </el-dialog>

        <!-- 重置密码 -->
        <el-dialog v-model="showReset" title="重置密码" width="420px">
          <p>为账号 <b>{{ resetTarget?.username }}</b> 设置新密码：</p>
          <el-form :model="resetForm" label-width="80px">
            <el-form-item label="新密码" required>
              <el-input v-model="resetForm.password" placeholder="至少 6 位" />
            </el-form-item>
          </el-form>
          <template #footer>
            <el-button @click="showReset = false">取消</el-button>
            <el-button type="primary" @click="resetPassword">确认重置</el-button>
          </template>
        </el-dialog>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import api from '../lib/api.js'
import { ElMessage, ElMessageBox } from 'element-plus'
import { SUPPORTED_FORMATS } from '../lib/bracket.js'
import { RULES, defaultSegment, validateFormat, normalizeSegments, stageOptionsFor, segmentSummary } from '../lib/matchFormats.js'

const router = useRouter()
const activeTab = ref('tournaments')
const me = ref(null)

// ---------- 赛事 ----------
const tournaments = ref([])
const showCreate = ref(false)
const formats = SUPPORTED_FORMATS
const rules = RULES
const form = ref({
  name: '',
  description: '',
  format: 'single_elimination',
  maxParticipants: 8,
  rounds: null,
  groupCount: 4,
})
// 对阵制类型：none / custom / team
const matchKind = ref('none')
const segments = ref(defaultSegment('single_elimination'))
const boOptions = [1, 3, 5, 7, 9, 11]

const isGroupFormat = computed(() => form.value.format === 'round_robin')
const maxGroups = computed(() => Math.max(2, Math.floor((form.value.maxParticipants || 2) / 2)))
const stageOptions = computed(() => stageOptionsFor(form.value.format))

// 赛制变化时，若处于自定义模式则重置分段为默认
watch(
  () => form.value.format,
  () => {
    if (matchKind.value === 'custom') segments.value = defaultSegment(form.value.format)
  }
)
// 切到自定义时确保有分段
watch(matchKind, (k) => {
  if (k === 'custom' && (!segments.value.length)) segments.value = defaultSegment(form.value.format)
})

function stageHint(appliesTo) {
  if (appliesTo === 'all') return '覆盖整届赛事'
  if (appliesTo === 'group') return '仅小组赛阶段'
  if (appliesTo === 'ko') return '仅出线淘汰赛阶段'
  if (appliesTo === 'quarter') return '八强（1/4 决赛）及之后'
  if (appliesTo === 'semi') return '四强（半决赛）及之后'
  if (appliesTo === 'final') return '仅决赛'
  return ''
}

// 适用范围变更：若限定到后期赛程，则自动补一段「全程」覆盖前期（即新生成的选择框）
function onStageChange() {
  segments.value = normalizeSegments(segments.value, form.value.format)
}
// 仅淘汰赛允许手动增加「后期赛程分段」（当前还没有 late 段时显示按钮）
const canAddLateSeg = computed(
  () =>
    (form.value.format === 'single_elimination' || form.value.format === 'double_elimination') &&
    !segments.value.some((s) => ['quarter', 'semi', 'final'].includes(s.appliesTo))
)
function addLateSeg() {
  segments.value.push({ appliesTo: 'semi', rule: 'conquest', bo: 5, ban: 1, decks: 4 })
  segments.value = normalizeSegments(segments.value, form.value.format)
}
function removeSeg(i) {
  segments.value.splice(i, 1)
  if (!segments.value.length) segments.value = defaultSegment(form.value.format)
}

// 整体有效性：自定义时所有分段须一致
const allValid = computed(() => {
  if (matchKind.value === 'none' || matchKind.value === 'team') return true
  return segments.value.length > 0 && segments.value.every((s) => validateFormat(s).ok)
})

async function load() {
  const { data } = await api.get('/tournaments')
  tournaments.value = data.tournaments
}

// ---------- 用户 ----------
const users = ref([])
const userQuery = ref('')
const showAddUser = ref(false)
const userForm = ref({ username: '', password: '', fullName: '', role: 'player' })
const showReset = ref(false)
const resetTarget = ref(null)
const resetForm = ref({ password: '' })

async function loadUsers() {
  const { data } = await api.get('/users', { params: { q: userQuery.value } })
  users.value = data.users
}

async function addUser() {
  if (!userForm.value.username || !userForm.value.password) {
    ElMessage.warning('请填写用户名和密码')
    return
  }
  try {
    await api.post('/users', {
      username: userForm.value.username,
      password: userForm.value.password,
      fullName: userForm.value.fullName,
      role: userForm.value.role,
    })
    ElMessage.success('已创建账号')
    showAddUser.value = false
    userForm.value = { username: '', password: '', fullName: '', role: 'player' }
    loadUsers()
  } catch (e) {
    ElMessage.error(e.response?.data?.error || '创建失败')
  }
}

function openReset(row) {
  resetTarget.value = row
  resetForm.value.password = ''
  showReset.value = true
}

async function resetPassword() {
  if (!resetForm.value.password || resetForm.value.password.length < 6) {
    ElMessage.warning('新密码至少 6 位')
    return
  }
  try {
    await api.post(`/users/${resetTarget.value.id}/reset-password`, { password: resetForm.value.password })
    ElMessage.success(`已重置 ${resetTarget.value.username} 的密码`)
    showReset.value = false
  } catch (e) {
    ElMessage.error(e.response?.data?.error || '重置失败')
  }
}

async function removeUser(row) {
  try {
    await ElMessageBox.confirm(
      `确定删除账号「${row.username}」吗？删除后不可恢复。`,
      '删除用户',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  try {
    await api.delete(`/users/${row.id}`)
    ElMessage.success('已删除账号')
    loadUsers()
  } catch (e) {
    ElMessage.error(e.response?.data?.error || '删除失败')
  }
}

// ---------- 赛事操作 ----------
async function create() {
  if (!form.value.name) {
    ElMessage.warning('请填写赛事名称')
    return
  }
  if (!allValid.value) {
    ElMessage.warning('对阵制存在前后不一致，请先修正（携带卡组数 / ban / BO 需匹配）')
    return
  }
  try {
    const payload = {
      name: form.value.name,
      description: form.value.description,
      format: form.value.format,
      maxParticipants: form.value.maxParticipants,
      rounds: form.value.rounds || undefined,
      matchKind: matchKind.value,
    }
    if (isGroupFormat.value) payload.groupCount = form.value.groupCount
    if (matchKind.value === 'custom') {
      payload.formatSegments = segments.value.map((s) => ({
        appliesTo: s.appliesTo,
        rule: s.rule,
        bo: Number(s.bo),
        ban: Number(s.ban),
        decks: Number(s.decks),
      }))
    }
    await api.post('/tournaments', payload)
    ElMessage.success('已创建（草稿）')
    showCreate.value = false
    form.value = {
      name: '',
      description: '',
      format: 'single_elimination',
      maxParticipants: 8,
      rounds: null,
      groupCount: 4,
    }
    matchKind.value = 'none'
    segments.value = defaultSegment('single_elimination')
    load()
  } catch (e) {
    ElMessage.error(e.response?.data?.error || '创建失败')
  }
}
async function publish(row) {
  try {
    await api.post(`/tournaments/${row.id}/publish`)
    ElMessage.success('已发布，选手可报名')
    load()
  } catch (e) {
    ElMessage.error(e.response?.data?.error || '发布失败')
  }
}
async function draw(row) {
  try {
    await api.post(`/tournaments/${row.id}/draw`)
    ElMessage.success('抽签完成')
    load()
  } catch (e) {
    ElMessage.error(e.response?.data?.error || '抽签失败')
  }
}
async function remove(row) {
  const isOngoing = row.status === 'ongoing' || row.status === 'open'
  const warning = isOngoing
    ? `\n⚠️ 该赛事${row.status === 'ongoing' ? '正在进行中' : '已发布报名'}：删除将一并清除已产生的对阵、选手已提交的赛果等全部数据，且不可恢复！`
    : ''
  try {
    await ElMessageBox.confirm(
      `确定删除赛事「${row.name}」（${statusLabel(row.status)}）吗？\n将一并删除其全部比赛与报名记录，且不可恢复。${warning}\n此操作无法撤销，请确认无误后再删除。`,
      '删除赛事',
      { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消', distinguishCancelAndClose: true }
    )
  } catch {
    return
  }
  try {
    await api.delete(`/tournaments/${row.id}`)
    ElMessage.success('已删除赛事记录')
    load()
  } catch (e) {
    ElMessage.error(e.response?.data?.error || '删除失败')
  }
}
function goDetail(row) {
  router.push(`/tournaments/${row.id}`)
}
function statusType(s) {
  return { draft: 'info', open: 'success', ongoing: 'warning', finished: 'primary' }[s] || 'info'
}
function statusLabel(s) {
  return { draft: '草稿', open: '报名中', ongoing: '进行中', finished: '已结束' }[s] || s
}
function formatLabel(f) {
  return (formats.find((x) => x.value === f) || {}).label || f
}

// 切换标签时按需加载用户列表
function onTabChange(name) {
  if (name === 'users') loadUsers()
}

onMounted(async () => {
  await load()
  try {
    const { data } = await api.get('/me')
    me.value = data.user
  } catch {
    /* 忽略 */
  }
})
</script>

<style scoped>
.page {
  padding: 16px;
}
.page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.pane-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.hint {
  color: var(--hs-text-mute);
  font-size: 12px;
  margin-left: 8px;
}
.pane-head h3,
.pane-head h4 {
  font-weight: 700;
  letter-spacing: 0.5px;
  color: #0f172a;
  margin: 0;
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
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.seg-idx {
  font-weight: 700;
  color: var(--hs-accent-strong);
  letter-spacing: 0.5px;
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
</style>
