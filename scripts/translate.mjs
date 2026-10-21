#!/usr/bin/env node
/**
 * 为 data/stars.json 中的项目生成中文摘要（增量，带缓存，断点可续）
 *
 * 用法：node --env-file=.env scripts/translate.mjs
 *
 * 环境变量：
 *   GITHUB_TOKEN   可选，用于拉取 README（无则仅凭 description 翻译）
 *   LLM_BASE_URL   OpenAI 兼容接口地址（如 https://open.bigmodel.cn/api/paas/v4）
 *   LLM_API_KEY    未配置时优雅跳过（exit 0，不影响 CI）
 *   LLM_MODEL      默认 glm-5.3-flash
 *
 * 产物：data/zh.json（每完成 10 条或队列耗尽即写盘）
 */
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CATEGORIES } from './lib/taxonomy.mjs'

const DATA = fileURLToPath(new URL('../data', import.meta.url))
const readJson = (f, fallback) => {
  try {
    return JSON.parse(readFileSync(join(DATA, f), 'utf8'))
  } catch {
    return fallback
  }
}

const stars = readJson('stars.json', [])
if (!stars.length) {
  console.log('⏭ data/stars.json 为空，请先运行 npm run fetch')
  process.exit(0)
}
let zh = readJson('zh.json', {})
if (typeof zh !== 'object' || zh === null || Array.isArray(zh)) zh = {}

const sha = (s) => createHash('sha256').update(s).digest('hex')
const srcHash = (r) => sha(`${r.fullName}|${r.pushedAt ?? ''}|${r.description ?? ''}`)

const todo = stars.filter((r) => {
  const z = zh[r.fullName]
  return !z || z.sourceHash !== srcHash(r)
})
console.log(`共 ${stars.length} 个项目，待翻译 ${todo.length} 个`)
if (!todo.length) {
  console.log('✔ 全部为最新，无需翻译')
  process.exit(0)
}

const BASE = (process.env.LLM_BASE_URL ?? '').replace(/\/+$/, '')
const KEY = process.env.LLM_API_KEY
const MODEL = process.env.LLM_MODEL || 'glm-5.3-flash'
if (!KEY || !BASE) {
  console.log(`⏭ 未配置 LLM_API_KEY / LLM_BASE_URL，跳过翻译（${todo.length} 条待翻译）`)
  process.exit(0)
}
const GH = process.env.GITHUB_TOKEN

function saveZh() {
  const tmp = join(DATA, `.zh.${process.pid}.tmp`)
  writeFileSync(tmp, JSON.stringify(zh, null, 2) + '\n')
  renameSync(tmp, join(DATA, 'zh.json'))
}

async function fetchReadme(fullName) {
  if (!GH) return ''
  try {
    const res = await fetch(`https://api.github.com/repos/${fullName}/readme`, {
      headers: {
        Authorization: `Bearer ${GH}`,
        Accept: 'application/vnd.github.raw+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
    if (!res.ok) return ''
    return (await res.text()).slice(0, 4000)
  } catch {
    return ''
  }
}

const SYSTEM = `你是开源项目中文技术编辑，为"开源项目雷达"网站编写项目介绍。根据给定信息输出简体中文 JSON：
- positioning：一句话定位，不超过 30 字，说清"是什么、核心价值"
- summary：2-3 句简介，概括功能与亮点，避免堆砌形容词
- scenarios：3-5 条适用场景，每条 6-20 字
- quickStart：快速上手命令，必须从 README 安装/快速开始段落原文摘录（docker/brew/npm/pip/cargo/go install 等真实命令，多条用换行分隔）；README 没有就写"见 README"，严禁编造
- categories：1-2 个分类，只能从以下列表选：${CATEGORIES.join('、')}
- tags：3-6 个简体中文标签
只输出 JSON 对象本身，不要输出其他内容。`

async function translateOne(r) {
  const readme = await fetchReadme(r.fullName)
  const user = `项目：${r.fullName}
描述：${r.description ?? '（无）'}
主要语言：${r.primaryLanguage ?? '未知'}
主题：${(r.topics ?? []).join(', ') || '（无）'}
主页：${r.homepageUrl || '（无）'}
README 摘录：
${readme || '（无）'}`
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: user },
      ],
    }),
  })
  if (!res.ok) throw new Error(`LLM ${res.status}：${(await res.text()).slice(0, 200)}`)
  const data = await res.json()
  let content = data.choices?.[0]?.message?.content ?? ''
  content = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  const p = JSON.parse(content)
  const cats = (Array.isArray(p.categories) ? p.categories : [p.categories]).filter(
    (c) => typeof c === 'string' && CATEGORIES.includes(c),
  )
  return {
    positioning: String(p.positioning ?? '').slice(0, 60),
    summary: String(p.summary ?? ''),
    scenarios: (Array.isArray(p.scenarios) ? p.scenarios : []).map(String).filter(Boolean).slice(0, 5),
    quickStart: String(p.quickStart || '见 README'),
    categories: cats.length ? cats.slice(0, 2) : ['其他'],
    tags: (Array.isArray(p.tags) ? p.tags : []).map(String).filter(Boolean).slice(0, 6),
    sourceHash: srcHash(r),
    translatedAt: new Date().toISOString(),
  }
}

const queue = [...todo]
let done = 0
let failed = 0

async function worker() {
  while (queue.length) {
    const r = queue.shift()
    let ok = false
    for (let i = 0; i < 3 && !ok; i++) {
      try {
        zh[r.fullName] = await translateOne(r)
        ok = true
      } catch (e) {
        if (i === 2) {
          failed += 1
          console.error(`  ✖ ${r.fullName}：${e.message}`)
        } else {
          await new Promise((s) => setTimeout(s, 2000 * 2 ** i))
        }
      }
    }
    done += 1
    if (done % 10 === 0 || done === todo.length) {
      console.log(`  进度 ${done}/${todo.length}`)
      saveZh()
    }
  }
}

mkdirSync(DATA, { recursive: true })
await Promise.all(Array.from({ length: Math.min(3, todo.length) }, worker))
saveZh()
console.log(`✔ 翻译完成：成功 ${done - failed}，失败 ${failed}`)
