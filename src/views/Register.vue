<template>
  <div class="auth-wrap">
    <el-card class="auth-card">
      <h2>注册选手账号</h2>
      <el-alert v-if="error" :title="error" type="error" show-icon closable @close="error = ''" />
      <el-form :model="form" label-width="64px" @submit.prevent>
        <el-form-item label="用户名">
          <el-input v-model="form.username" placeholder="登录用户名（3-30 位，可含汉字/字母/数字/#/丨，唯一）" />
        </el-form-item>
        <el-form-item label="昵称">
          <el-input v-model="form.fullName" placeholder="展示昵称（可含汉字/字母/数字/#/丨，留空同用户名）" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="form.password" type="password" show-password placeholder="至少 6 位" />
        </el-form-item>
        <el-button type="primary" :loading="loading" @click="submit">注册并登录</el-button>
        <router-link to="/login"><el-button text>已有账号？去登录</el-button></router-link>
      </el-form>
    </el-card>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { useAuth } from '../composables/auth.js'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'

const { register } = useAuth()
const router = useRouter()
const form = reactive({ fullName: '', username: '', password: '' })
const loading = ref(false)
const error = ref('')

async function submit() {
  error.value = ''
  loading.value = true
  try {
    await register(form.username, form.password, form.fullName)
    ElMessage.success('注册成功')
    router.push('/')
  } catch (e) {
    error.value = e.response?.data?.error || '注册失败'
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
/* 注册面板：与登录一致的浅色控制台 */
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
@media (max-width: 640px) {
  .auth-wrap {
    padding-top: 24px;
  }
  .auth-card {
    width: 92vw;
  }
}
</style>
