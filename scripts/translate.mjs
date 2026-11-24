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
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CATEGORIES } from './lib/taxonomy.mjs'
import { evaluateReadmeTranslation } from './lib/readme-policy.mjs'

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
let stateDirty = !state
if (!state) {
  state = { version: 1, repos: {} }
  for (const r of stars) state.repos[r.fullName] = {
    active: true, starredAt: r.starredAt ?? null, baselinePending: Boolean(zh[r.fullName]), newPending: !zh[r.fullName],
  }
}
const currentStars = new Set(stars.map((r) => r.fullName))
for (const [name, entry] of Object.entries(state.repos)) {
  if (!currentStars.has(name) && entry.active !== false) {
    entry.active = false
    stateDirty = true
  }
}
for (const r of stars) {
  const entry = state.repos[r.fullName]
  if (!entry) {
    state.repos[r.fullName] = { active: true, starredAt: r.starredAt ?? null, newPending: true }
    stateDirty = true
  } else if (!entry.active || (entry.starredAt && r.starredAt && entry.starredAt !== r.starredAt)) {
    entry.active = true
    entry.starredAt = r.starredAt ?? null
    entry.newPending = true
    delete entry.baselinePending
    stateDirty = true
  }
}
if (stateDirty) saveState()
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

function blobSha(bytes) {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
}

async function fetchBlob(fullName, sha, size) {
  const res = await ghRequest(`https://api.github.com/repos/${fullName}/git/blobs/${sha}`, 'application/vnd.github.raw+json')
  if (!res.ok) throw new Error(`Git blob 获取失败 ${res.status}`)
  const bytes = Buffer.from(await res.arrayBuffer())
  if ((size !== undefined && bytes.length !== size) || blobSha(bytes) !== sha) {
    throw new Error('Git blob 内容与指纹不一致')
  }
  return bytes
}

async function fetchPreviousReadme(fullName, fingerprint) {
  const sha = /^blob:([a-f0-9]{40})$/.exec(fingerprint)?.[1]
  if (!sha) throw new Error('无效的历史 README 指纹')
  const bytes = await fetchBlob(fullName, sha)
  return { fingerprint, text: bytes.toString('utf8') }
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
  let bytes
  if (data.encoding === 'base64' && typeof data.content === 'string' && /^[A-Za-z0-9+/=\s]*$/.test(data.content)) {
    bytes = Buffer.from(data.content.replace(/\s/g, ''), 'base64')
  }
  if (!bytes || bytes.length !== data.size || blobSha(bytes) !== data.sha) {
    bytes = await fetchBlob(fullName, data.sha, data.size)
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

const reasonLabels = {
  'missing-translation': '缺少中文翻译',
  'new-star': '新收藏或重新收藏',
  'readme-added': 'README 新增',
  'readme-removed': 'README 删除',
  'core-changed': 'README 核心内容变化',
  'body-changed': 'README 正文达到差异阈值',
}
const queue = [...stars]
const skipped = { 'display-only': 0, 'small-change': 0, cooldown: 0 }
let translated = 0
let checkFailed = 0
let translationFailed = 0
async function worker() {
  while (queue.length) {
    const r = queue.shift()
    const fullName = r.fullName
    const entry = state.repos[fullName]
    let readme
    let decision
    let checking = '当前 README'
    try {
      readme = await fetchReadme(fullName)
      const input = { fullName, entry, translation: zh[fullName], current: readme }
      decision = evaluateReadmeTranslation({ ...input, now: Date.now() })
      if (decision.status === 'needs-previous') {
        checking = '历史 README blob'
        const previous = await fetchPreviousReadme(fullName, entry.fingerprint)
        decision = evaluateReadmeTranslation({ ...input, previous, now: Date.now() })
      }
      if (decision.status === 'check-failed') throw new Error('历史 README 无法确认')
    } catch {
      checkFailed++
      console.error(`✖ ${fullName}：${checking} 检查失败，将重试`)
      continue
    }
    if (decision.status === 'baseline') {
      entry.fingerprint = readme.fingerprint
      delete entry.baselinePending
      saveState()
    }
    if (Object.hasOwn(skipped, decision.status)) skipped[decision.status]++
    if (decision.status !== 'translate') continue

    const reason = decision.reasons.map((code) => reasonLabels[code]).join('、')
    console.log(`待翻译 ${fullName}：${reason}`)
    if (!KEY || !BASE) {
      console.log(`⏭ ${fullName}：${reason}；未配置 LLM，等待重试`)
      continue
    }
    // 一轮内的请求重试共用一个时间戳。进程中断也保留该轮的记录。
    entry.lastAttemptAt = new Date().toISOString()
    saveState()
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
      translationFailed++
      console.error(`✖ ${fullName}：${reason}；翻译失败，等待重试`)
      continue
    }
    zh[fullName] = result
    // 先保存翻译，再保存指纹。中断后按旧指纹及已记下的轮次重评。
    saveZh()
    entry.fingerprint = readme.fingerprint
    delete entry.baselinePending
    delete entry.newPending
    saveState()
    translated++
    console.log(`✔ ${fullName}：${reason}；翻译成功`)
  }
}
await Promise.all(Array.from({ length: Math.min(10, queue.length) }, worker))
const failed = checkFailed + translationFailed
if (failed) console.error(`::warning::README 检查或翻译失败 ${failed} 项，后续运行将按策略重试`)
console.log(`${failed ? '⚠' : '✔'} README 检查完成：翻译成功 ${translated}，失败 ${failed}（检查 ${checkFailed}，翻译 ${translationFailed}），展示或空白变化 ${skipped['display-only']}，小改动 ${skipped['small-change']}，冷却等待 ${skipped.cooldown}`)
