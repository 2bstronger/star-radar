#!/usr/bin/env node
/**
 * 抓取当前 GitHub 账户的全部 starred 仓库及元数据（REST 版）
 *
 * 为什么不用 GraphQL：本机代理对 POST body 有内容审查，复杂 query 会被 502；
 * GET 请求无 body，完全免疫。/user/starred (star+json) 一次带回 starred_at + 完整仓库对象。
 *
 * 用法：node --env-file=.env scripts/fetch_stars.mjs
 * 产物：data/stars.json、data/meta.json
 * 请求量：~7 页列表 + 每仓库 2 次 GET（语言占比 / 最热 issue）≈ 1250 次 < 5000/h 限额
 */
import { writeFileSync, mkdirSync } from 'node:fs'

const token = process.env.GITHUB_TOKEN
if (!token) {
  console.error('✖ 缺少 GITHUB_TOKEN 环境变量（参考 .env.example），')
  console.error('  运行：node --env-file=.env scripts/fetch_stars.mjs')
  process.exit(1)
}

const H = {
  Authorization: `Bearer ${token}`,
  'X-GitHub-Api-Version': '2022-11-28',
}

// GET + 指数退避重试（对不稳定代理友好）
async function ghGet(path, accept = 'application/vnd.github+json', tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`https://api.github.com${path}`, { headers: { ...H, Accept: accept } })
      if (res.status === 404) return null
      if (res.status === 403 || res.status === 429) {
        console.error(`✖ 触发限流（${res.status}），等一小时再跑：${path}`)
        process.exit(1)
      }
      if (res.ok) return await res.json()
      if (res.status >= 500 && i < tries - 1) {
        await new Promise((s) => setTimeout(s, 1000 * 2 ** i))
        continue
      }
      console.error(`✖ GitHub ${res.status}：${path}`)
      return null
    } catch (e) {
      if (i === tries - 1) {
        console.error(`✖ 网络错误（${e.message}）：${path}`)
        return null
      }
      await new Promise((s) => setTimeout(s, 1000 * 2 ** i))
    }
  }
  return null
}

function mapRepo(edge) {
  const r = edge.repo
  return {
    id: r.id,
    fullName: r.full_name,
    description: r.description ?? null,
    homepageUrl: r.homepage || null,
    stars: r.stargazers_count,
    forks: r.forks_count,
    primaryLanguage: r.language ?? null,
    languages: [],
    license: !r.license || r.license.spdx_id === 'NOASSERTION' ? null : r.license.spdx_id,
    createdAt: r.created_at,
    pushedAt: r.pushed_at,
    starredAt: edge.starred_at,
    defaultBranch: r.default_branch ?? null,
    topics: r.topics ?? [],
    openIssues: r.open_issues_count,
    hotIssue: null,
    isArchived: r.archived,
  }
}

async function main() {
  // ── ① star 列表（含完整仓库对象）──
  const repos = []
  let login = null
  for (let page = 1; ; page++) {
    const data = await ghGet(`/user/starred?per_page=100&page=${page}`, 'application/vnd.github.star+json')
    if (!Array.isArray(data)) break
    if (!data.length) break
    for (const e of data) repos.push(mapRepo(e))
    console.log(`  列表第 ${page} 页，累计 ${repos.length}`)
    if (data.length < 100) break
  }
  if (!repos.length) {
    console.error('✖ 一个 star 都没抓到（token 权限或网络问题）')
    process.exit(1)
  }
  const me = await ghGet('/user')
  login = me?.login ?? null
  console.log(`✔ 列表完成：${repos.length} 个 star（账户 ${login}），开始补齐语言占比与最热 issue…`)

  // ── ② 每仓库：语言占比 + 最热 open issue（并发 4）──
  const queue = [...repos]
  let done = 0
  async function worker() {
    while (queue.length) {
      const r = queue.shift()
      const [langs, issues] = await Promise.all([
        ghGet(`/repos/${r.fullName}/languages`),
        ghGet(`/repos/${r.fullName}/issues?state=open&sort=comments&direction=desc&per_page=5`),
      ])
      if (langs && typeof langs === 'object') {
        const total = Object.values(langs).reduce((s, v) => s + v, 0)
        r.languages = Object.entries(langs)
          .map(([name, size]) => ({ name, size, pct: total > 0 ? Math.round((size / total) * 1000) / 10 : 0 }))
          .sort((a, b) => b.size - a.size)
          .slice(0, 12)
      }
      if (Array.isArray(issues)) {
        const issue = issues.find((i) => !i.pull_request) // REST 的 issues 混有 PR，剔除
        if (issue) {
          r.hotIssue = {
            number: issue.number,
            title: issue.title,
            url: issue.html_url,
            comments: issue.comments,
          }
        }
      }
      done++
      if (done % 50 === 0 || done === repos.length) {
        console.log(`  补齐进度 ${done}/${repos.length}`)
        // 中途落盘，断了不亏
        mkdirSync(new URL('../data/', import.meta.url), { recursive: true })
        writeFileSync(new URL('../data/stars.json', import.meta.url), JSON.stringify(repos, null, 2) + '\n')
      }
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker))

  // ── ③ 写产物 ──
  mkdirSync(new URL('../data/', import.meta.url), { recursive: true })
  writeFileSync(new URL('../data/stars.json', import.meta.url), JSON.stringify(repos, null, 2) + '\n')
  writeFileSync(
    new URL('../data/meta.json', import.meta.url),
    JSON.stringify({ fetchedAt: new Date().toISOString(), totalCount: repos.length, login }, null, 2) + '\n',
  )
  console.log(`✔ 抓取完成：${repos.length} 个 star → data/stars.json`)
}

main().catch((e) => {
  console.error('✖ 抓取失败：', e.message)
  process.exit(1)
})
