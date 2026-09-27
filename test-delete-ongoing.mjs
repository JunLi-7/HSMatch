// 端到端验证：创建→发布→两名选手报名(满员自动抽签)→进行中→管理员删除
// 在本进程内启动真实服务，避免沙箱回收后台进程
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const NODE = 'C:/Users/29829/.workbuddy/binaries/node/versions/22.22.2-3/node.exe'
const ROOT = __dirname
const PORT = 3011 // 用不同端口避免与用户正在跑的 3001 冲突

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function startServer() {
  const env = { ...process.env, PORT: String(PORT) }
  const child = spawn(NODE, ['--experimental-sqlite', 'server/index.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', () => {})
  child.stderr.on('data', (d) => process.stderr.write('[srv] ' + d))
  return child
}

async function waitHealth() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://localhost:${PORT}/api/health`)
      if (r.ok) return true
    } catch {}
    await sleep(300)
  }
  return false
}

async function j(method, url, body, token) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const r = await fetch(`http://localhost:${PORT}${url}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  let data = null
  try { data = await r.json() } catch {}
  return { status: r.status, data }
}

const ts = Date.now()
const run = async () => {
  const srv = startServer()
  try {
    if (!(await waitHealth())) {
      console.log('RESULT: 服务未启动')
      return
    }
    console.log('health: ok')

    // 管理员登录
    const admin = await j('POST', '/api/auth/login', { username: 'admin', password: 'admin123456' })
    if (admin.status !== 200) { console.log('RESULT: 管理员登录失败', admin); return }
    const at = admin.data.token

    // 创建赛事
    const t = await j('POST', '/api/tournaments', {
      name: `deltest_${ts}`,
      format: 'single_elimination',
      maxParticipants: 2,
      matchFormat: 'none',
      rule: null,
    }, at)
    if (t.status !== 200) { console.log('RESULT: 创建赛事失败', t); return }
    const tid = t.data.tournament.id
    console.log('创建赛事 id=', tid)

    // 发布
    await j('POST', `/api/tournaments/${tid}/publish`, {}, at)

    // 注册两名选手
    const p1 = `delp1_${ts}`
    const p2 = `delp2_${ts}`
    await j('POST', '/api/auth/register', { username: p1, password: 'test123', fullName: p1 })
    await j('POST', '/api/auth/register', { username: p2, password: 'test123', fullName: p2 })
    const l1 = await j('POST', '/api/auth/login', { username: p1, password: 'test123' })
    const l2 = await j('POST', '/api/auth/login', { username: p2, password: 'test123' })

    // 报名（第2人报名后满员自动抽签）
    const reg1 = await j('POST', `/api/tournaments/${tid}/register`, {}, l1.data.token)
    const reg2 = await j('POST', `/api/tournaments/${tid}/register`, {}, l2.data.token)
    console.log('报名1:', reg1.status, '报名2:', reg2.status)

    // 查状态
    const detail = await j('GET', `/api/tournaments/${tid}`, null, at)
    console.log('抽签后赛事状态:', detail.data.tournament?.status, '对阵数:', detail.data.matches?.length)

    // 管理员删除（关键步骤）
    const del = await j('DELETE', `/api/tournaments/${tid}`, null, at)
    console.log('DELETE 状态:', del.status, '响应:', JSON.stringify(del.data))

    // 确认已删
    const after = await j('GET', `/api/tournaments/${tid}`, null, at)
    console.log('删除后查询状态:', after.status)

    console.log('RESULT:', del.status === 200 && after.status === 404 ? 'PASS 进行中赛事可删除' : 'FAIL')
  } finally {
    srv.kill('SIGKILL')
  }
}
run()
