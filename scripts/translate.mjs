#!/usr/bin/env node
/**
 * 为 data/stars.json 中的项目生成中文摘要（增量，带缓存，断点可续）
 *
 * 用法：node --env-file=.env scripts/translate.mjs
 *
 * 环境变量：
 *   GITHUB_TOKEN   必需，用于安全检查 README
 *   LLM_BASE_URL   OpenAI 兼容接口地址
 *   LLM_API_KEY    未配置时优雅跳过（exit 0，不影响 CI）
 *   LLM_MODEL      默认 glm-5.3-flash
 *
 * README 全文输入，输出由 prompt 约束。
 * 产物：data/zh.json、data/readme-state.json（逐项落盘）
 */
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CATEGORIES } from './lib/taxonomy.mjs'

const BASE = (process.env.LLM_BASE_URL ?? '').replace(/\/+$/, '')
const KEY = process.env.LLM_API_KEY
const MODEL = process.env.LLM_MODEL || 'glm-5.3-flash'
const GH = process.env.GITHUB_TOKEN
if (!GH) {
  if (!KEY || !BASE) {
    console.log('⏭ 未配置 GITHUB_TOKEN 和完整 LLM 配置，跳过翻译')
    process.exit(0)
  }
  throw new Error('缺少 GITHUB_TOKEN，无法安全检查 README')
}

const DATA = process.env.TRANSLATE_DATA_DIR || fileURLToPath(new URL('../data', import.meta.url))
const readJson = (f, fallback) => {
  const path = join(DATA, f)
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback
}
const stars = readJson('stars.json', [])
if (!Array.isArray(stars)) throw new Error('无效的 stars.json')
const zh = readJson('zh.json', {})
if (!zh || typeof zh !== 'object' || Array.isArray(zh)) throw new Error('无效的 zh.json')
const statePath = join(DATA, 'readme-state.json')
let state = readJson('readme-state.json', null)
if (state !== null && (state.version !== 1 || !state.repos || typeof state.repos !== 'object' || Array.isArray(state.repos))) {
  throw new Error('无效的 README 指纹状态')
}

function saveJson(name, value) {
  mkdirSync(DATA, { recursive: true })
  const tmp = join(DATA, `.${name}.${process.pid}.tmp`)
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n')
  renameSync(tmp, join(DATA, name))
}
const saveState = () => saveJson('readme-state.json', state)
const saveZh = () => saveJson('zh.json', zh)

// 首次运行先持久化完整迁移名单；部分失败或中断后仍保留逐项基线资格。
if (!state) {
  state = { version: 1, repos: {} }
  for (const r of stars) state.repos[r.fullName] = {
    active: true, starredAt: r.starredAt ?? null, baselinePending: Boolean(zh[r.fullName]), newPending: !zh[r.fullName],
  }
  saveState()
}
const current = new Set(stars.map((r) => r.fullName))
for (const [name, entry] of Object.entries(state.repos)) {
  if (!current.has(name)) entry.active = false
}
for (const r of stars) {
  let entry = state.repos[r.fullName]
  if (!entry) entry = state.repos[r.fullName] = { active: true, starredAt: r.starredAt ?? null, newPending: true }
  else if (!entry.active || (entry.starredAt && r.starredAt && entry.starredAt !== r.starredAt)) {
    entry.active = true
    entry.starredAt = r.starredAt ?? null
    entry.newPending = true
    delete entry.baselinePending
  }
  // 修复旧版本留下的无指纹、无待处理标记条目。
  if (!entry.fingerprint && !entry.baselinePending && !entry.newPending) entry.newPending = true
}
saveState()
const sleep = (ms) => new Promise((s) => setTimeout(s, ms))

async function ghRequest(url, accept) {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: {
        Authorization: `Bearer ${GH}`, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28',
      } })
      if (res.status === 404 || res.ok) return res
      if (res.status < 500 || i === 2) throw new Error(`GitHub ${res.status}`)
    } catch (e) {
      if (i === 2 || /^GitHub /.test(e.message)) throw e
    }
    await sleep(1000 * 2 ** i)
  }
}

// 校验 blob SHA，确保翻译内容与记录的指纹一致（包括大文件的 raw 回退）。
async function fetchReadme(fullName) {
  const url = `https://api.github.com/repos/${fullName}/readme`
  const res = await ghRequest(url, 'application/vnd.github+json')
  if (res.status === 404) {
    const repo = await ghRequest(`https://api.github.com/repos/${fullName}`, 'application/vnd.github+json')
    if (!repo.ok) throw new Error(`仓库不可访问 ${repo.status}`)
    return { fingerprint: 'none', text: '' }
  }
  const data = await res.json()
  if (!data || data.type !== 'file' || !/^[a-f0-9]{40}$/.test(data.sha) || !Number.isSafeInteger(data.size) || data.size < 0) throw new Error('无效的 README 元数据')
  const valid = (bytes) => bytes.length === data.size &&
    createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') === data.sha
  let bytes
  if (data.encoding === 'base64' && typeof data.content === 'string' && /^[A-Za-z0-9+/=\s]*$/.test(data.content)) {
    bytes = Buffer.from(data.content.replace(/\s/g, ''), 'base64')
  }
  if (!bytes || !valid(bytes)) {
    const raw = await ghRequest(`https://api.github.com/repos/${fullName}/git/blobs/${data.sha}`, 'application/vnd.github.raw+json')
    if (!raw.ok) throw new Error(`README 正文获取失败 ${raw.status}`)
    bytes = Buffer.from(await raw.arrayBuffer())
    if (!valid(bytes)) throw new Error('README 内容与指纹不一致')
  }
  return { fingerprint: `blob:${data.sha}`, text: bytes.toString('utf8') }
}

const SYSTEM = `你是开源项目中文技术编辑，为"开源项目雷达"网站编写项目介绍。根据给定信息输出简体中文 JSON：
- positioning：一句话定位，不超过 30 字，说清"是什么、核心价值"
- summary：2-3 句简介，概括功能与亮点，避免堆砌形容词
- scenarios：3-5 条适用场景，每条 6-20 字
- quickStart：快速上手命令，必须从 README 安装/快速开始/Getting Started 段落原文摘录（docker/brew/npm/pip/cargo/go install 等真实命令，多条用换行分隔）；README 没有就写"见 README"，严禁编造
- categories：1-2 个分类，只能从以下列表选：${CATEGORIES.join('、')}
- tags：3-6 个简体中文标签
只输出 JSON 对象本身，不要输出其他内容。`

async function translateOne(r, readme) {
  const user = `项目：${r.fullName}
描述：${r.description ?? '（无）'}
主要语言：${r.primaryLanguage ?? '未知'}
主题：${(r.topics ?? []).join(', ') || '（无）'}
主页：${r.homepageUrl || '（无）'}
README 全文：
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
  if (!res.ok) throw new Error(`LLM ${res.status}`)
  const data = await res.json()
  let content = data.choices?.[0]?.message?.content ?? ''
  content = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  const p = JSON.parse(content)
  if (!p || typeof p !== 'object' || Array.isArray(p) || typeof p.summary !== 'string' || !p.summary.trim()) {
    throw new Error('无效的翻译结果')
  }
  const cats = (Array.isArray(p.categories) ? p.categories : [p.categories]).filter(
    (c) => typeof c === 'string' && CATEGORIES.includes(c),
  )
  return {
    positioning: String(p.positioning ?? ''),
    summary: String(p.summary ?? ''),
    scenarios: (Array.isArray(p.scenarios) ? p.scenarios : []).map(String).filter(Boolean),
    quickStart: String(p.quickStart || '见 README'),
    categories: cats.length ? cats : ['其他'],
    tags: (Array.isArray(p.tags) ? p.tags : []).map(String).filter(Boolean),
    translatedAt: new Date().toISOString(),
  }
}

const queue = [...stars]
let translated = 0
let failed = 0
async function worker() {
  while (queue.length) {
    const r = queue.shift()
    const entry = state.repos[r.fullName]
    let readme
    try {
      readme = await fetchReadme(r.fullName)
    } catch {
      failed++
      console.error(`✖ ${r.fullName}：README 获取失败，将重试`)
      continue
    }
    const reasons = []
    if (!zh[r.fullName]) reasons.push('缺少中文翻译')
    if (entry.newPending) reasons.push('新收藏或重新收藏')
    if (!entry.baselinePending && entry.fingerprint && entry.fingerprint !== readme.fingerprint) reasons.push('README 内容变化')
    if (!reasons.length) {
      if (entry.baselinePending) {
        entry.fingerprint = readme.fingerprint
        delete entry.baselinePending
        saveState()
      }
      continue
    }
    const reason = reasons.join('、')
    console.log(`待翻译 ${r.fullName}：${reason}`)
    if (!KEY || !BASE) {
      console.log(`⏭ ${r.fullName}：${reason}；未配置 LLM，等待重试`)
      continue
    }
    let result
    for (let i = 0; i < 3; i++) {
      try {
        result = await translateOne(r, readme.text)
        break
      } catch {
        if (i < 2) await sleep(2000 * 2 ** i)
      }
    }
    if (!result) {
      failed++
      console.error(`✖ ${r.fullName}：${reason}；翻译失败，将重试`)
      continue
    }
    zh[r.fullName] = result
    // 先保存翻译，再保存指纹；中断时最多重复翻译，不会漏翻。
    saveZh()
    entry.fingerprint = readme.fingerprint
    delete entry.baselinePending
    delete entry.newPending
    saveState()
    translated++
    console.log(`✔ ${r.fullName}：${reason}；翻译成功`)
  }
}
await Promise.all(Array.from({ length: Math.min(10, queue.length) }, worker))
if (failed) {
  console.error(`::warning::README 检查或翻译失败 ${failed} 项，将在下次运行重试`)
  console.log(`⚠ README 检查结束：翻译成功 ${translated}，失败 ${failed}`)
} else console.log(`✔ README 检查完成：翻译成功 ${translated}，失败 0`)
