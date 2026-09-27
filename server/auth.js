// 鉴权工具：密码哈希 + JWT
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { getConfig, getOrCreateConfig } from './db.js'
import db from './db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// JWT 密钥取值优先级：
//   1) 环境变量 / .env
//   2) server/app-secret.json —— 随发布包分发，所有实例读同一份（线上多实例且不共享存储时的唯一可靠来源）
//   3) 数据库 app_config（跨实例若共享则次之）
//   4) data/secret.txt（本地兜底）
//   5) 随机（仅临时环境）
// 线上若各实例拿到不同密钥，A 签发的 token 到 B 校验必然失败，表现为"创建赛事提示登录过期"。
function loadJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET
  const bundled = path.join(__dirname, 'app-secret.json')
  try {
    const s = JSON.parse(fs.readFileSync(bundled, 'utf8')).jwtSecret
    if (s) return s
  } catch {}
  const file = path.join(__dirname, '..', 'data', 'secret.txt')
  try {
    const s = getOrCreateConfig('jwt_secret', () => crypto.randomBytes(32).toString('hex'))
    if (s) {
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, s)
      } catch {}
      return s
    }
  } catch {}
  try {
    const s = fs.readFileSync(file, 'utf8').trim()
    if (s) {
      try {
        getOrCreateConfig('jwt_secret', () => s)
      } catch {}
      return s
    }
  } catch {}
  return crypto.randomBytes(32).toString('hex')
}

const JWT_SECRET = loadJwtSecret()
const TOKEN_TTL = '7d'

/** 密钥指纹（不明文输出），用于排查多实例密钥是否一致 */
export function secretFingerprint() {
  return crypto.createHash('sha256').update(String(JWT_SECRET)).digest('hex').slice(0, 8)
}

// 用户名/昵称允许的字符集：字母、数字、下划线、中文，以及 Hearthstone 常用分隔符 # 和 丨
// 昵称可空（留空则等同用户名），故单独给一个最小 1 位的规则
export const USERNAME_RE = /^[A-Za-z0-9_一-龥#丨]{3,30}$/
export const NAME_RE = /^[A-Za-z0-9_一-龥#丨]{1,30}$/

// bcrypt 哈希格式：$2a$ / $2b$ / $2y$ + cost + 22位salt + 31位hash，共 60 字符
const BCRYPT_RE = /^\$2[aby]\$\d{2}\$.{53}$/

export function hashPassword(pw) {
  return bcrypt.hashSync(pw == null ? '' : String(pw), 10)
}

/** 判断库中存储的是否为 bcrypt 哈希（否则视为历史遗留的明文密码） */
export function isBcryptHash(v) {
  return typeof v === 'string' && BCRYPT_RE.test(v)
}

// 明文等值比较：先比长度再定时安全比较，规避时序侧信道
function plainEqual(a, b) {
  const ba = Buffer.from(String(a), 'utf8')
  const bb = Buffer.from(String(b), 'utf8')
  if (ba.length !== bb.length) return false
  return crypto.timingSafeEqual(ba, bb)
}

/**
 * 校验密码：同时支持 bcrypt 哈希与库中遗留的明文密码。
 * - 输入统一转字符串，避免 undefined/number 导致 bcrypt 抛异常（接口 500）
 * - 非 bcrypt 格式的存储值按明文等值比较
 * - 任何异常一律降级为 false，不向上抛出
 */
export function verifyPassword(pw, hash) {
  const input = pw == null ? '' : String(pw)
  const stored = hash == null ? '' : String(hash)
  if (!input || !stored) return false
  if (!isBcryptHash(stored)) return plainEqual(input, stored)
  try {
    return bcrypt.compareSync(input, stored)
  } catch {
    return false
  }
}

export function signToken(user) {
  return jwt.sign({ id: user.id, role: user.role, username: user.username }, JWT_SECRET, {
    expiresIn: TOKEN_TTL,
  })
}

export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET)
}

// ---------- 数据库会话：登录态的主方案 ----------
// JWT 依赖所有进程共用同一密钥；线上若存在多实例/多版本进程，密钥可能不一致，
// 表现为「登录成功但一操作就提示登录过期（invalid signature）」。
// 会话 token 存在数据库里（数据库已验证跨请求持久共享），与密钥无关，故作为主方案。
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex')
  const now = new Date()
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS)
  try {
    // 顺带清理本用户的过期会话
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now.toISOString())
    db.prepare('INSERT INTO sessions(token, user_id, created_at, expires_at) VALUES(?,?,?,?)').run(
      token,
      userId,
      now.toISOString(),
      expiresAt.toISOString()
    )
  } catch (e) {
    // 会话表不可用时降级为 JWT，保证仍可登录
    return null
  }
  return token
}

/** 由会话 token 解析用户；无效/过期返回 null */
export function resolveSession(token) {
  if (!token) return null
  try {
    const s = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token)
    if (!s) return null
    if (new Date(s.expires_at).getTime() < Date.now()) {
      db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
      return null
    }
    return db.prepare('SELECT id, username, full_name, role FROM users WHERE id = ?').get(s.user_id) || null
  } catch {
    return null
  }
}

export function destroySession(token) {
  try {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
  } catch {}
}
