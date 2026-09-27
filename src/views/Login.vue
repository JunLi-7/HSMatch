<template>
  <div class="auth-wrap">
    <el-card class="auth-card">
      <h2>登录赛事系统</h2>
      <el-alert v-if="error" :title="error" type="error" show-icon closable @close="error = ''" />
      <el-form :model="form" label-width="64px" @submit.prevent>
        <el-form-item label="用户名">
          <el-input v-model="form.username" placeholder="登录用户名" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="form.password" type="password" show-password placeholder="密码" />
        </el-form-item>
        <el-button type="primary" :loading="loading" @click="submit">登录</el-button>
        <router-link to="/register"><el-button text>没有账号？去注册</el-button></router-link>
      </el-form>
      <p class="hint">选手可自助注册；管理员账号由系统手动开通。</p>
    </el-card>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { useAuth } from '../composables/auth.js'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'

const { login } = useAuth()
const route = useRoute()
const router = useRouter()
const form = reactive({ username: '', password: '' })
const loading = ref(false)
const error = ref('')

async function submit() {
  error.value = ''
  loading.value = true
  try {
    const u = await login(form.username, form.password)
    ElMessage.success('登录成功')
    router.push(route.query.redirect || (u.role === 'admin' ? '/admin' : '/'))
  } catch (e) {
    error.value = e.response?.data?.error || '登录失败'
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.auth-wrap {
  display: flex;
  justify-content: center;
  padding-top: 56px;
}
/* 登录面板：浅色控制台 */
.auth-card {
  width: 380px;
  position: relative;
  border-radius: 4px;
  border: 1px solid rgba(15, 23, 42, 0.1);
  background-color: #ffffff;
  box-shadow: 0 16px 40px rgba(15, 23, 42, 0.12);
}
.auth-card::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 2px;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(8, 145, 178, 0.7) 30%,
    rgba(8, 145, 178, 0.7) 70%,
    transparent
  );
}
.auth-card :deep(.el-button--primary) {
  width: 100%;
  margin-top: 4px;
  letter-spacing: 2px;
}
.hint {
  color: var(--hs-text-mute);
  font-size: 12px;
  margin-top: 12px;
}
@media (max-width: 640px) {
  .auth-wrap {
    padding-top: 24px;
  }
  .auth-card {
    width: 92vw;
  }
}
</style>
