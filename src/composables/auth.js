// 全局登录态（单例，localStorage 持久化）
import { reactive, computed } from 'vue'
import api from '../lib/api.js'

const state = reactive({
  user: JSON.parse(localStorage.getItem('user') || 'null'),
  token: localStorage.getItem('token'),
})

function setSession(data) {
  state.token = data.token
  state.user = data.user
  localStorage.setItem('token', data.token)
  localStorage.setItem('user', JSON.stringify(data.user))
}

export function useAuth() {
  const user = computed(() => state.user)
  const isLoggedIn = computed(() => !!state.token)
  const isAdmin = computed(() => !!(state.user && state.user.role === 'admin'))

  async function login(username, password) {
    const { data } = await api.post('/auth/login', { username, password })
    setSession(data)
    return data.user
  }
  async function register(username, password, fullName) {
    const { data } = await api.post('/auth/register', { username, password, fullName })
    setSession(data)
    return data.user
  }
  function logout() {
    state.token = null
    state.user = null
    localStorage.removeItem('token')
    localStorage.removeItem('user')
  }

  return { state, user, isLoggedIn, isAdmin, login, register, logout }
}
