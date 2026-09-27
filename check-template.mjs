// 静态检查：模板中引用了但 <script setup> 未定义的标识符
// 这类问题 build 不报错，只在运行时抛 "xxx is not a function"，表现为“按钮点了没用”
import fs from 'fs'
import path from 'path'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith('.vue')) out.push(p)
  }
  return out
}

const files = walk('src')
let total = 0

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8')
  const { descriptor } = parse(src, { filename: file })
  if (!descriptor.template || !descriptor.scriptSetup) continue

  const script = compileScript(descriptor, { id: file })
  const bindings = script.bindings || {}

  const { code } = compileTemplate({
    source: descriptor.template.content,
    filename: file,
    id: file,
    compilerOptions: { bindingMetadata: bindings, prefixIdentifiers: true },
  })

  // 模板编译后，未绑定的标识符会保留为 _ctx.xxx
  const missing = new Set()
  for (const m of code.matchAll(/_ctx\.([A-Za-z_$][\w$]*)/g)) {
    const name = m[1]
    // $ 开头的是 Vue 全局属性（$route/$router/$slots 等），由 app.use 注入，属合法
    if (name.startsWith('$')) continue
    missing.add(name)
  }

  if (missing.size) {
    total += missing.size
    console.log(`\n[未定义] ${file}`)
    for (const n of missing) console.log(`   - ${n}`)
  }
}

console.log(total === 0 ? '\n检查完成：所有模板引用的标识符均已定义' : `\n检查完成：发现 ${total} 处未定义引用`)
process.exit(total === 0 ? 0 : 1)
