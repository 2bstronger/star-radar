#!/usr/bin/env node
/**
 * 抓取当前 GitHub 账户的全部 starred 仓库及元数据
 *
 * 用法：
 *   GITHUB_TOKEN=xxx node scripts/fetch_stars.mjs
 *   或 node --env-file=.env scripts/fetch_stars.mjs
 *
 * 产物：data/stars.json、data/meta.json
 */
import { writeFileSync, mkdirSync } from 'node:fs'

const API = 'https://api.github.com/graphql'

const token = process.env.GITHUB_TOKEN
if (!token) {
  console.error('✖ 缺少 GITHUB_TOKEN 环境变量。')
  console.error('  请在 .env 中配置（参考 .env.example）：需要 fine-grained PAT，')
  console.error('  权限仅需 Metadata: read + Starring: read。')
  console.error('  然后运行：node --env-file=.env scripts/fetch_stars.mjs')
  process.exit(1)
}

// 注意：issues 字段出现两次，必须用别名（openIssues / hotIssues）
const QUERY = `query ($cursor: String) {
  viewer {
    login
    starredRepositories(first: 100, orderBy: {field: STARRED_AT, direction: DESC}, after: $cursor) {
      totalCount
      edges {
        starredAt
        node {
          databaseId
          nameWithOwner
          description
          homepageUrl
          stargazerCount
          forkCount
          primaryLanguage { name }
          languages(first: 12, orderBy: {field: SIZE, direction: DESC}) {
            totalSize
            edges { size name }
          }
          licenseInfo { spdxId }
          createdAt
          pushedAt
          defaultBranchRef { name }
          repositoryTopics(first: 20) { nodes { topic { name } } }
          isArchived
          openIssues: issues(states: OPEN) { totalCount }
          hotIssues: issues(states: OPEN, orderBy: {field: COMMENTS, direction: DESC}, first: 1) {
            nodes { number title url comments }
          }
        }
      }
      pageInfo { endCursor hasNextPage }
    }
  }
}`

function mapRepo(edge) {
  const n = edge.node
  const langs = (n.languages?.edges ?? []).map((e) => ({ name: e.name, size: e.size }))
  const total = n.languages?.totalSize || langs.reduce((s, l) => s + l.size, 0)
  for (const l of langs) l.pct = total > 0 ? Math.round((l.size / total) * 1000) / 10 : 0
  const spdx = n.licenseInfo?.spdxId
  const hot = n.hotIssues?.nodes?.[0] ?? null
  return {
    id: n.databaseId,
    fullName: n.nameWithOwner,
    description: n.description ?? null,
    homepageUrl: n.homepageUrl || null,
    stars: n.stargazerCount,
    forks: n.forkCount,
    primaryLanguage: n.primaryLanguage?.name ?? null,
    languages: langs,
    license: !spdx || spdx === 'NOASSERTION' ? null : spdx,
    createdAt: n.createdAt,
    pushedAt: n.pushedAt,
    starredAt: edge.starredAt,
    defaultBranch: n.defaultBranchRef?.name ?? null,
    topics: (n.repositoryTopics?.nodes ?? []).map((t) => t.topic.name),
    openIssues: n.openIssues?.totalCount ?? 0,
    hotIssue: hot ? { number: hot.number, title: hot.title, url: hot.url, comments: hot.comments } : null,
    isArchived: n.isArchived,
  }
}

async function main() {
  const repos = []
  let login = null
  let totalCount = 0
  let cursor = null
  let page = 0
  do {
    const res = await fetch(API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ query: QUERY, variables: { cursor } }),
    })
    if (!res.ok) {
      console.error(`✖ GitHub API ${res.status}：${(await res.text()).slice(0, 300)}`)
      process.exit(1)
    }
    const json = await res.json()
    if (json.errors?.length) {
      console.error('✖ GraphQL 错误：', json.errors)
      process.exit(1)
    }
    const sr = json.data.viewer.starredRepositories
    login = json.data.viewer.login
    totalCount = sr.totalCount
    page += 1
    for (const e of sr.edges) repos.push(mapRepo(e))
    console.log(`  第 ${page} 页，累计 ${repos.length}/${totalCount}`)
    cursor = sr.pageInfo.hasNextPage ? sr.pageInfo.endCursor : null
  } while (cursor)

  mkdirSync(new URL('../data/', import.meta.url), { recursive: true })
  writeFileSync(new URL('../data/stars.json', import.meta.url), JSON.stringify(repos, null, 2) + '\n')
  writeFileSync(
    new URL('../data/meta.json', import.meta.url),
    JSON.stringify({ fetchedAt: new Date().toISOString(), totalCount, login }, null, 2) + '\n',
  )
  console.log(`✔ 抓取完成：${repos.length} 个 star → data/stars.json`)
}

main().catch((e) => {
  console.error('✖ 抓取失败：', e.message)
  process.exit(1)
})
