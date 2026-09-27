<template>
  <el-container class="app">
    <el-header class="app-header" height="60px">
      <div class="brand">赛事对战系统</div>
      <el-menu v-if="isLoggedIn" mode="horizontal" :router="true" :default-active="$route.path" class="nav">
        <el-menu-item index="/">赛事大厅</el-menu-item>
        <el-menu-item v-if="isAdmin" index="/admin">管理后台</el-menu-item>
        <el-menu-item index="/format-debug">赛制调试</el-menu-item>
      </el-menu>
      <div class="spacer" />
      <div v-if="isLoggedIn" class="user">
        <span class="uname">{{ state.user.full_name }}（{{ isAdmin ? '管理员' : '选手' }}）</span>
        <el-button text @click="doLogout">退出</el-button>
      </div>
      <div v-else class="user">
        <router-link to="/login"><el-button text>登录</el-button></router-link>
        <router-link to="/register"><el-button type="primary" size="small">注册</el-button></router-link>
      </div>
    </el-header>
    <el-main>
      <router-view />
    </el-main>
  </el-container>
</template>

<script setup>
import { useAuth } from './composables/auth.js'
import { useRouter } from 'vue-router'

const { state, isLoggedIn, isAdmin, logout } = useAuth()
const router = useRouter()
function doLogout() {
  logout()
  router.push('/login')
}
</script>

<style scoped>
.app {
  min-height: 100%;
  background: transparent;
}
/* 顶栏：浅色玻璃条 + 底部电光青细线 */
.app-header {
  display: flex;
  align-items: center;
  padding: 0 16px;
  position: relative;
  background-color: rgba(255, 255, 255, 0.88);
  backdrop-filter: blur(6px);
  border-bottom: 1px solid rgba(15, 23, 42, 0.1);
  box-shadow: 0 2px 10px rgba(15, 23, 42, 0.06);
}
/* 底部一道青色细线 */
.app-header::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 2px;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(8, 145, 178, 0.45) 20%,
    rgba(8, 145, 178, 0.75) 50%,
    rgba(8, 145, 178, 0.45) 80%,
    transparent
  );
}
.brand {
  font-weight: 700;
  font-size: 17px;
  letter-spacing: 1.5px;
  margin-right: 24px;
  white-space: nowrap;
  color: #0f172a;
}
.brand::before {
  content: '';
  display: inline-block;
  width: 5px;
  height: 15px;
  margin-right: 9px;
  vertical-align: -2px;
  background: var(--hs-accent);
}
.nav {
  flex: 1;
  border-bottom: none;
  background: transparent;
}
.spacer {
  flex: 1;
}
.user {
  display: flex;
  align-items: center;
  gap: 8px;
}
.uname {
  font-size: 13px;
  color: var(--hs-text-dim);
  letter-spacing: 0.3px;
}
/* 移动端：品牌与导航紧凑排布 */
@media (max-width: 640px) {
  .app-header {
    padding: 0 8px;
  }
  .brand {
    font-size: 15px;
    margin-right: 8px;
  }
  .uname {
    display: none;
  }
}
</style>
