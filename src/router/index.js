import { createRouter, createWebHistory } from 'vue-router'
import { useAuth } from '../composables/auth.js'
import Tournaments from '../views/Tournaments.vue'
import Login from '../views/Login.vue'
import Register from '../views/Register.vue'
import TournamentDetail from '../views/TournamentDetail.vue'
import Admin from '../views/Admin.vue'
import FormatDebug from '../views/FormatDebug.vue'

const routes = [
  { path: '/', name: 'home', component: Tournaments, meta: { requiresAuth: true } },
  { path: '/login', name: 'login', component: Login },
  { path: '/register', name: 'register', component: Register },
  {
    path: '/tournaments/:id',
    name: 'tournament-detail',
    component: TournamentDetail,
    meta: { requiresAuth: true },
  },
  { path: '/admin', name: 'admin', component: Admin, meta: { requiresAuth: true, adminOnly: true } },
  { path: '/format-debug', name: 'format-debug', component: FormatDebug },
]

const router = createRouter({ history: createWebHistory(), routes })

router.beforeEach((to) => {
  const { state } = useAuth()
  if (to.meta.requiresAuth && !state.token) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  if (to.meta.adminOnly && !(state.user && state.user.role === 'admin')) {
    return { name: 'home' }
  }
  return true
})

export default router
