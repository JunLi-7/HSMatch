// 零依赖加载项目根目录 .env（避免引入额外依赖）
// 必须在其它 import 之前执行，使 process.env.* 在路由模块加载前就绪
import fs from 'fs'
import path from 'path'

const envFile = path.join(process.cwd(), '.env')
if (fs.existsSync(envFile)) {
  for (const raw of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = raw.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/)
    if (m && !(m[1] in process.env)) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  }
}

export {}
