// SQLite 存储层（Node 22 内置 node:sqlite，同步 API，单进程内并发安全，零原生编译）
import { DatabaseSync } from 'node:sqlite'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.join(__dirname, '..', 'data')
fs.mkdirSync(dataDir, { recursive: true })
const dbPath = path.join(dataDir, 'match.db')
export const DB_PATH = dbPath

const db = new DatabaseSync(dbPath)
// node:sqlite 通过 exec 设置连接级 PRAGMA
db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA foreign_keys = ON')

// better-sqlite3 风格的 db.transaction(fn) 垫片（node:sqlite 无原生事务包装）
// 用 SAVEPOINT 兼容嵌套事务（better-sqlite3 原生支持嵌套，node:sqlite 裸 BEGIN 不支持）
let __txDepth = 0
let __txSeq = 0
db.transaction = (fn) => (...args) => {
  __txSeq++
  const sp = `sp_${__txSeq}`
  if (__txDepth === 0) db.exec('BEGIN')
  else db.exec(`SAVEPOINT ${sp}`)
  __txDepth++
  try {
    const v = fn(...args)
    __txDepth--
    if (__txDepth === 0) db.exec('COMMIT')
    else db.exec(`RELEASE SAVEPOINT ${sp}`)
    return v
  } catch (e) {
    __txDepth--
    if (__txDepth === 0) db.exec('ROLLBACK')
    else db.exec(`ROLLBACK TO SAVEPOINT ${sp}`)
    throw e
  }
}

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'player',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tournaments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  format TEXT NOT NULL DEFAULT 'single_elimination',
  match_format TEXT NOT NULL DEFAULT 'none',
  rule TEXT,
  max_participants INTEGER NOT NULL,
  rounds INTEGER,
  status TEXT NOT NULL DEFAULT 'draft',
  bracket_json TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL,
  FOREIGN KEY(created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed',
  registered_at TEXT NOT NULL,
  UNIQUE(tournament_id, user_id),
  FOREIGN KEY(tournament_id) REFERENCES tournaments(id),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  mid TEXT NOT NULL,
  tournament_id INTEGER NOT NULL,
  round INTEGER NOT NULL,
  match_index INTEGER NOT NULL,
  slot_a TEXT,
  slot_b TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  winner_id TEXT,
  score_a INTEGER,
  score_b INTEGER,
  next_match_id TEXT,
  next_slot TEXT,
  loser_next_match_id TEXT,
  loser_next_slot TEXT,
  round_name TEXT,
  group_name TEXT,
  bp_a_decks TEXT,
  bp_a_ban INTEGER,
  bp_b_decks TEXT,
  bp_b_ban INTEGER,
  bp_revealed INTEGER NOT NULL DEFAULT 0,
  games TEXT,
  FOREIGN KEY(tournament_id) REFERENCES tournaments(id)
);

CREATE INDEX IF NOT EXISTS idx_reg_tournament ON registrations(tournament_id);
CREATE INDEX IF NOT EXISTS idx_match_tournament ON matches(tournament_id);
`)

// 登录会话（不依赖 JWT 密钥，多实例/多版本部署下也能互相识别）
db.exec(`
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_session_user ON sessions(user_id);
`)
db.exec(`
CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`)

export function getConfig(k) {
  const r = db.prepare('SELECT value FROM app_config WHERE key = ?').get(k)
  return r ? r.value : null
}

/** 取值，不存在则用 gen() 生成并落库；并发下首个写入者胜出，保证多实例拿到同一值 */
export function getOrCreateConfig(k, gen) {
  const cur = getConfig(k)
  if (cur) return cur
  const v = gen()
  db.prepare('INSERT OR IGNORE INTO app_config(key, value) VALUES(?, ?)').run(k, v)
  return getConfig(k) || v
}

// ---------- 迁移：旧库兼容 ----------
function cols(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name)
}
function addColumn(table, col, def) {
  if (!cols(table).includes(col)) db.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`).run()
}
function renameColumn(table, from, to) {
  const c = cols(table)
  if (c.includes(from) && !c.includes(to)) db.prepare(`ALTER TABLE ${table} RENAME COLUMN ${from} TO ${to}`).run()
}

// users: email -> username（旧库兼容）
renameColumn('users', 'email', 'username')
// matches: 新增对阵图重建所需字段
addColumn('matches', 'mid', 'TEXT')
addColumn('matches', 'group_name', 'TEXT')
addColumn('matches', 'loser_next_match_id', 'TEXT')
addColumn('matches', 'loser_next_slot', 'TEXT')
// tournaments: 瑞士轮总轮数
addColumn('tournaments', 'rounds', 'INTEGER')
// tournaments: 对阵制 + 规则
addColumn('tournaments', 'match_format', "TEXT NOT NULL DEFAULT 'none'")
addColumn('tournaments', 'rule', 'TEXT')
// matches: BP（ban/pick）与单局录分
addColumn('matches', 'bp_a_decks', 'TEXT')
addColumn('matches', 'bp_a_ban', 'INTEGER')
addColumn('matches', 'bp_b_decks', 'TEXT')
addColumn('matches', 'bp_b_ban', 'INTEGER')
addColumn('matches', 'bp_revealed', 'INTEGER NOT NULL DEFAULT 0')
addColumn('matches', 'games', 'TEXT')
// matches: 选手端 BP 两阶段 + 赛果手动提交 + 管理员确认公布
addColumn('matches', 'bp_decks_revealed', 'INTEGER NOT NULL DEFAULT 0')
addColumn('matches', 'result_a', 'TEXT')
addColumn('matches', 'result_b', 'TEXT')
addColumn('matches', 'result_submitted_a', 'INTEGER NOT NULL DEFAULT 0')
addColumn('matches', 'result_submitted_b', 'INTEGER NOT NULL DEFAULT 0')
addColumn('matches', 'deck_phase', 'TEXT')
addColumn('matches', 'admin_note', 'TEXT')
// matches: 战队赛（team_kof）BP 四阶段字段
addColumn('matches', 'bp_a_protect', 'INTEGER')
addColumn('matches', 'bp_a_pick1', 'INTEGER')
addColumn('matches', 'bp_a_ban2', 'TEXT')
addColumn('matches', 'bp_b_protect', 'INTEGER')
addColumn('matches', 'bp_b_pick1', 'INTEGER')
addColumn('matches', 'bp_b_ban2', 'TEXT')
// matches: 每场对阵制 + 规则（支持四强后切换不同对阵制，如 无BP征服赛 前期BO3/2套 → 四强后BO5/3套）
addColumn('matches', 'match_format', 'TEXT')
addColumn('matches', 'rule', 'TEXT')
// tournaments: 四强后切换的对阵制（无BP征服赛使用）
addColumn('tournaments', 'late_match_format', 'TEXT')
// tournaments: 可组合对阵制（分段 JSON：每段含 appliesTo/bo/rule/ban/decks）
addColumn('tournaments', 'format_segments', 'TEXT')
// matches: 每场对阵制的解析结果（抽签时落定，便于前端/判定直接使用，旧命名格式回退到 match_format meta）
addColumn('matches', 'bo', 'INTEGER')
addColumn('matches', 'ban_count', 'INTEGER')
addColumn('matches', 'deck_count', 'INTEGER')
// matches: 阶段（'group' 小组赛 / 'ko' 出线淘汰赛 / 其余为常规）
addColumn('matches', 'stage', 'TEXT')
// tournaments: 小组循环 + 出线淘汰赛（分组数量、小组赛/淘汰赛各自的对阵制与规则）
addColumn('tournaments', 'group_count', 'INTEGER')
addColumn('tournaments', 'group_match_format', 'TEXT')
addColumn('tournaments', 'group_rule', 'TEXT')
addColumn('tournaments', 'ko_match_format', 'TEXT')
addColumn('tournaments', 'ko_rule', 'TEXT')

export default db
