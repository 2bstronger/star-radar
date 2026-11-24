import { isIP } from 'node:net'

export const README_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000
const BODY_THRESHOLD = 150
const whitespace = /\s/gu
const coreHeading = /\b(?:install(?:ing|ation)?|quick[ -]?start|getting started|get started|setup|set up|configuration|configure|usage|how to (?:use|run)|running|deployment|prerequisites)\b|安装|快速(?:开始|上手|入门|启动)|入门|配置|使用(?:说明|方法|指南|方式)?|运行|部署|环境要求|前置条件/iu
const command = /^(?:[>$]\s*)*(?:(?:sudo|env)\s+)*(?:(?:npm|pnpm|yarn|bun|pipx?|brew|cargo|winget|choco|apt(?:-get)?|conda|poetry|uv|dotnet)\s+(?:install|i|ci|add|run|start|build|sync|restore|tool install|pip install)\b|(?:npx|pnpx|bunx)\s+\S|go\s+(?:install|run|build)\b|git\s+clone\b|docker\s+(?:run|pull|build|compose\s+(?:up|run))\b|docker-compose\s+(?:up|run)\b|python[\d.]*\s+(?:-m\s+\S|\S+\.py\b)|(?:bash|sh)\s+\S|\.\/\S|make(?:\s|$)|export\s+\w+=)/i
const updateLine = /^(?:#\s+)?(?:[*_`]+)?(?:last\s+updated(?:\s+at)?|(?:auto\s*)?update(?:d)?\s+(?:time|at)|更新时间|最后更新(?:时间)?|上次更新)\s*[:：]?\s*(?:[*_`]+)?\s*\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}(?:日)?(?:[T\s]+\d{1,2}:\d{2}(?::\d{2})?(?:\s*(?:Z|UTC(?:[+-]\d{1,2}(?::?\d{2})?)?|[+-]\d{2}:?\d{2}))?)?\s*[*_`]*$/i
const displaySection = /^<!--\s*(START|END)_SECTION\s*:\s*(waka|activity|github-stats|star-history)\s*-->$/i
const contributorsSection = /^<!--\s*ALL-CONTRIBUTORS-LIST:(START|END)(?:\s+-\s+Do not remove or modify this section)?\s*-->$/i
const hostsSection = /^<!--\s*GitHub520_(START|END)\s*-->$/i
const hostsBlock = /^#\s*GitHub520 Hosts? (Start|End)\s*$/i
const hostsUpdatedAt = /^(\s*该内容会自动定时更新[，,]\s*数据更新时间[:：])\s*\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})\s*$/i
const hostsRow = /^(\S+)\s+([^#]+?)(?:\s+#.*)?$/
const hostName = /^(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z\d-]+\.?$/i
const starColumnHeading = /^(?:★|⭐|(?:github\s+)?stars|stargazers|star\s+count|星标(?:数|数量)?)$/iu
const starCount = /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*[kmb]?$/i

const markdownImage = /!\[([^\]]*)\]\(\s*<?([^\s<>()]+)>?(?:\s+"[^"]*")?\s*\)/
const htmlImage = /<img\b[^>]*>/i
const displayMarkup = new RegExp([
  '`+[^`]*`+', `\\[${markdownImage.source}\\]\\([^\\n]*?\\)`, markdownImage.source,
  `<a\\b[^>]*>\\s*${htmlImage.source}\\s*</a>`, htmlImage.source,
].join('|'), 'gi')

function isDisplayImage(url) {
  let parsed
  try { parsed = new URL(url.startsWith('//') ? `https:${url}` : url) } catch { return false }
  const { hostname, pathname } = parsed
  return ['img.shields.io', 'shields.io', 'badgen.net', 'badge.fury.io', 'repobeats.axiom.co',
    'starchart.cc', 'github-readme-stats.vercel.app', 'github-readme-streak-stats.herokuapp.com',
    'streak-stats.demolab.com', 'github-profile-trophy.vercel.app', 'komarev.com'].includes(hostname) ||
    (['api.star-history.com', 'api.star-history.cc', 'star-history.com', 'star-history.cc'].includes(hostname) && pathname === '/svg') ||
    (hostname === 'github.com' && /^\/[^/]+\/[^/]+\/actions\/workflows\/[^/]+\/badge\.svg$/.test(pathname)) ||
    (hostname === 'github.com' && /^\/[^/]+\/[^/]+\/workflows\/[^/]+\/badge\.svg$/.test(pathname)) ||
    (hostname === 'codecov.io' && /\/badge\.svg$/.test(pathname))
}

function stripDisplayImages(line) {
  return line.replace(displayMarkup, (markup) => {
    if (markup.startsWith('`')) return markup
    const image = markup.match(markdownImage)
    const tag = image ? '' : markup.match(htmlImage)?.[0] ?? ''
    const alt = image?.[1] ?? tag.match(/\salt\s*=\s*["']([^"']*)["']/i)?.[1] ?? ''
    const url = image?.[2] ?? tag.match(/\ssrc\s*=\s*["']([^"']*)["']/i)?.[1]
    if (url && !/\b(?:install|download|quick[ -]?start|setup)\b|安装|下载|上手/i.test(alt) && isDisplayImage(url)) return ''
    return markup
  })
}

function markFences(text) {
  let fence = null
  return text.split(/\r?\n/u).map((line) => {
    const trimmed = line.trim()
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
    if (marker && !fence) {
      fence = marker[1]
      return { line, trimmed, delimiter: true }
    }
    if (marker && fence && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) {
      fence = null
      return { line, trimmed, delimiter: true }
    }
    return { line, trimmed, fenced: Boolean(fence) }
  })
}

function markPairedRanges(lines, match, ranges) {
  const starts = new Map()
  for (const [index, line] of lines.entries()) {
    const marker = match(line)
    if (!marker) continue
    const direction = marker[1].toLowerCase()
    const label = marker[2]?.toLowerCase() ?? ''
    if (direction === 'start') starts.set(label, index)
    else if (starts.has(label)) {
      ranges[starts.get(label)]++
      ranges[index + 1]--
      starts.delete(label)
    }
  }
}

function tableCells(line = '') {
  if (!/^ {0,3}\|.*\|\s*$/.test(line)) return null
  return line.trim().slice(1, -1).split(/(?<!\\)\|/)
}

function comparisonText(fullName, text) {
  const lines = markFences(text)
  const displayRanges = new Int32Array(lines.length + 1)
  markPairedRanges(lines, ({ line, trimmed, fenced }) => !fenced && /^ {0,3}<!--/.test(line) && trimmed.match(displaySection), displayRanges)
  markPairedRanges(lines, ({ line, trimmed, fenced }) => !fenced && /^ {0,3}<!--/.test(line) && trimmed.match(contributorsSection), displayRanges)
  const hostsRanges = new Int32Array(lines.length + 1)
  const isGitHub520 = fullName?.toLowerCase() === '521xueweihan/github520'
  if (isGitHub520) {
    markPairedRanges(lines, ({ trimmed, fenced }) => !fenced && trimmed.match(hostsSection), hostsRanges)
    markPairedRanges(lines, ({ trimmed }) => trimmed.match(hostsBlock), hostsRanges)
  }

  let inDisplay = 0
  let inHosts = 0
  let starsTable = null
  const body = []
  const core = []
  const headings = []
  for (const [index, { line, trimmed, fenced, delimiter }] of lines.entries()) {
    inDisplay += displayRanges[index]
    inHosts += hostsRanges[index]
    const prose = !fenced && !/^(?: {4}| *\t)/.test(line)
    const cells = prose && tableCells(line)
    if (!cells || cells.length !== starsTable?.width) starsTable = null
    if (inDisplay || delimiter || !trimmed) continue
    if (inHosts) {
      const row = trimmed.match(hostsRow)
      if (hostsSection.test(trimmed) || hostsBlock.test(trimmed) || updateLine.test(trimmed) ||
        (row && isIP(row[1]) && row[2].trim().split(/\s+/).every((host) => hostName.test(host)))) continue
    }
    if (prose && updateLine.test(trimmed)) continue
    const next = lines[index + 1]
    let content = line
    if (cells) {
      const divider = tableCells(next?.line)
      if (divider?.length === cells.length && divider.every((cell) => /^:?-{3,}:?$/.test(cell.trim()))) {
        const columns = cells.flatMap((cell, column) => starColumnHeading.test(cell.trim()) ? [column] : [])
        starsTable = columns.length ? { width: cells.length, columns } : null
      } else if (starsTable) {
        for (const column of starsTable.columns) if (starCount.test(cells[column].trim())) cells[column] = ''
        content = `|${cells.join('|')}|`
      }
    }
    if (prose) {
      if (isGitHub520) content = content.replace(hostsUpdatedAt, '$1')
      content = stripDisplayImages(content)
    }
    const normalized = content.replace(whitespace, '')
    if (!normalized) continue
    const atx = prose && content.match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/)
    const setext = !fenced && !next?.fenced && next?.trimmed.match(/^(=+|-+)$/)
    if (atx || setext) {
      const level = atx ? atx[1].length : setext[1][0] === '=' ? 1 : 2
      while (headings.length && headings.at(-1).level >= level) headings.pop()
      headings.push({ level, core: coreHeading.test(atx ? atx[2] : content) })
    }
    body.push(normalized)
    const commandLine = content.trim().replace(/^[-*+]\s+|^\d+[.)]\s+/, '')
    if (headings.some((heading) => heading.core) || command.test(commandLine)) {
      core.push(normalized)
    } else if (!fenced) {
      for (const [, code] of content.matchAll(/`+([^`]+)`+/g)) {
        if (command.test(code.trim())) core.push(code.replace(whitespace, ''))
      }
    }
  }
  return { body: body.join(''), core: core.join('') }
}

// Bounded Myers insert/delete distance over Unicode code points. A replacement costs two edits.
function reachesBodyThreshold(before, after) {
  if (before === after) return false
  const a = Array.from(before)
  const b = Array.from(after)
  if (Math.abs(a.length - b.length) >= BODY_THRESHOLD) return true
  let start = 0
  let endA = a.length
  let endB = b.length
  while (start < endA && start < endB && a[start] === b[start]) start++
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const offset = BODY_THRESHOLD
  const furthest = new Int32Array(2 * offset + 1)
  for (let edits = 0; edits < BODY_THRESHOLD; edits++) {
    for (let k = -edits; k <= edits; k += 2) {
      const diagonal = offset + k
      let x = k === -edits || (k !== edits && furthest[diagonal - 1] < furthest[diagonal + 1])
        ? furthest[diagonal + 1] : furthest[diagonal - 1] + 1
      let y = x - k
      while (start + x < endA && start + y < endB && a[start + x] === b[start + y]) {
        x++
        y++
      }
      if (start + x >= endA && start + y >= endB) return false
      furthest[diagonal] = x
    }
  }
  return true
}

/** Decide using verified snapshots and a caller-supplied epoch time in milliseconds. */
export function evaluateReadmeTranslation({ fullName, entry, translation, current, previous, now }) {
  const reasons = []
  if (!translation) reasons.push('missing-translation')
  if (entry.newPending || (!entry.fingerprint && !entry.baselinePending)) reasons.push('new-star')
  if (reasons.length) return { status: 'translate', reasons }
  if (entry.baselinePending) return { status: 'baseline' }
  if (entry.fingerprint === current.fingerprint) return { status: 'unchanged' }

  let reason
  if (entry.fingerprint === 'none') reason = 'readme-added'
  else if (current.fingerprint === 'none') reason = 'readme-removed'
  else {
    if (!previous) return { status: 'needs-previous' }
    if (previous.fingerprint !== entry.fingerprint || typeof previous.text !== 'string') return { status: 'check-failed' }
    const before = comparisonText(fullName, previous.text)
    const after = comparisonText(fullName, current.text)
    if (before.body === after.body) return { status: 'display-only' }
    if (before.core !== after.core) reason = 'core-changed'
    else if (reachesBodyThreshold(before.body, after.body)) reason = 'body-changed'
    else return { status: 'small-change' }
  }

  const last = Date.parse(entry.lastAttemptAt ?? translation.translatedAt)
  if (Number.isFinite(last) && now - last < README_COOLDOWN_MS) {
    return { status: 'cooldown', reasons: [reason], retryAt: last + README_COOLDOWN_MS }
  }
  return { status: 'translate', reasons: [reason] }
}
