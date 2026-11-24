import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateReadmeTranslation } from '../scripts/lib/readme-policy.mjs'

function compare(before, after, fullName = 'a/repo') {
  const entry = Object.freeze({ fingerprint: 'blob:before' })
  const translation = Object.freeze({ summary: 'old' })
  const previous = Object.freeze({ fingerprint: entry.fingerprint, text: before })
  const current = Object.freeze({ fingerprint: 'blob:after', text: after })
  return evaluateReadmeTranslation({ fullName, entry, translation, previous, current, now: 0 })
}

const status = (...args) => compare(...args).status
const coreChanged = (...args) => assert.deepEqual(compare(...args), { status: 'translate', reasons: ['core-changed'] })

// Small representative fixtures for the 11/23 -> 11/24 display-only changes.
test('GitHub520 自动 Hosts 和更新时间不计入差异，获取或配置说明仍参与比较', () => {
  const repo = '521xueweihan/GitHub520'
  const sample = (ip, day, port = '8') => [
    '更新时间：2025-11-' + day,
    '该内容会自动定时更新， 数据更新时间：2025-11-' + day + 'T09:00:00+08:00',
    '### 配置',
    '从 [Hosts 镜像](https://example.org/hosts) 获取最新文件。',
    `设置端口为 ${port}。`,
    '<!-- GitHub520_START -->',
    '```text',
    '# GitHub520 Host Start',
    '# Update time: 2025-11-' + day + 'T09:00:00+08:00',
    `${ip} github.com`,
    '2606:50c0:8000::153 pages.github.com',
    '# GitHub520 Host End',
    '```',
    '<!-- GitHub520_END -->',
    '手动示例：',
    '```text',
    '127.0.0.1 example.org',
    '```',
  ].join('\n')
  const before = sample('140.82.112.4', '23')
  const after = sample('140.82.113.4', '24').replace('2606:50c0:8000::153', '2606:50c0:8000::154')
  assert.equal(status(before, after, repo), 'display-only')
  coreChanged(before, after, 'a/other')
  coreChanged(before, sample('140.82.113.4', '24', '9'), repo)
  coreChanged(before, after.replace('/hosts)', '/hosts2)'), repo)
  coreChanged(before, after.replace('127.0.0.1', '127.0.0.2'), repo)
})

test('徽章和统计图被局部过滤，保留同行链接、命令和普通图片', () => {
  const repo = 'shanraisshan/claude-code-best-practice'
  const sample = (count, tag = '1') => [
    '| 名称 | ★ | 信息 | 配置值 |',
    '| --- | --- | --- | --- |',
    `| Claude | ${count}k | [![Stars](https://img.shields.io/badge/stars-${count}-blue)](https://github.com/a/b) | 123 |`,
    `<a href="https://star-history.com/#a/b"><img alt="Star History" src="https://api.star-history.com/svg?repos=a/b&amp;type=${count}"></a>`,
    '## Quick Start',
    `请读 [安装指南](https://example.org/setup${tag})，再运行 \`npx tool@${tag}\`。 ![badge](https://img.shields.io/badge/v-${count}-blue)`,
    '![界面](https://example.org/screenshot1.png)',
    '[![Install](https://img.shields.io/badge/install-now-blue)](https://example.org/install1)',
  ].join('\n')
  assert.equal(status(sample(23), sample(24), repo), 'display-only')
  assert.equal(status(sample(23), sample(24).replace('123', '124'), repo), 'small-change')
  assert.equal(status(sample(23), sample(24).replace('Claude', 'Claude Code'), repo), 'small-change')
  coreChanged(sample(23), sample(24, '2'), repo)
  coreChanged(sample(23), sample(24).replace('screenshot1', 'screenshot2'), repo)
  coreChanged(sample(23), sample(24).replace('org/install1', 'org/install2'), repo)
})

test('只忽略明确配对的展示标记，保留代码示例和普通生成段落', () => {
  const sample = (tag) => `## 配置\n<!--START_SECTION:waka-->\n${tag}\n<!--END_SECTION:waka-->`
  assert.equal(status(sample('1'), sample('2')), 'display-only')
  const contributors = (tag) => `## Usage\n<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->\n${tag}\n<!-- ALL-CONTRIBUTORS-LIST:END -->`
  assert.equal(status(contributors('1'), contributors('2')), 'display-only')
  const fenced = (tag) => `## 配置\n~~~markdown\n${sample(tag)}\nLast updated: 2025-11-2${tag}\n~~~\n## Notes`
  coreChanged(fenced('3'), fenced('4'))
  const indented = (tag) => sample(tag).replaceAll('<!--', '    <!--')
  coreChanged(indented('1'), indented('2'))
  const general = (tag) => sample(tag).replaceAll('waka', 'autogen-config')
  coreChanged(general('1'), general('2'))
  const unpaired = (tag) => sample(tag).replace('<!--END_SECTION:waka-->', '')
  coreChanged(unpaired('1'), unpaired('2'))
})

test('识别中英文章节及代码块和行内安装运行命令的一字符变化', () => {
  for (const sample of [
    '## Installation\n### Linux\nChoose package VERSION.\n## History',
    '快速入门\n--------\n使用镜像 VERSION。\n其他\n-----',
    '## Configuration\nPORT=VERSION',
    '## Usage\nPORT=VERSION',
    '```sh\n$ docker compose up app-VERSION\n```',
    '```bash\nuv pip install widget==VERSION\n```',
    'Try `go install example.org/tool@vVERSION` here.',
    '- npm ci --prefix example-VERSION',
  ]) {
    coreChanged(sample.replace('VERSION', '1'), sample.replace('VERSION', '2'))
  }
  assert.equal(status('## Usage\nUse x.\n## History\n2023', '## Usage\nUse x.\n## History\n2024'), 'small-change')
  assert.equal(status('Try `npx tool` today.', 'Try `npx tool` tomorrow.'), 'small-change')
})

test('正文按 Unicode 码点计算真实增删，149 不触发，150 触发', () => {
  const intro = '项目有很多功能。'
  const codePoints = '🧪'.repeat(149)
  assert.equal(status(intro, intro + codePoints), 'small-change')
  assert.equal(status(intro, intro + codePoints + '🛠'), 'translate')
  assert.equal(status(intro + codePoints + '🛠', intro), 'translate')
  assert.equal(status('起' + '甲'.repeat(74) + '末尾', '起' + '乙'.repeat(74) + '末尾'), 'small-change')
  assert.equal(status('起' + '甲'.repeat(75) + '末尾', '起' + '乙'.repeat(75) + '末尾'), 'translate')
  const long = '字'.repeat(250000)
  assert.equal(status(`${long}甲${long}`, `${long}乙${long}`), 'small-change')
  assert.equal(status(`${intro}\n  功能`, `${intro} 功\t能\n`), 'display-only')
  assert.equal(status('甲'.repeat(100) + '乙'.repeat(74), '乙'.repeat(74) + '甲'.repeat(100)), 'small-change')
})

test('策略显式请求已核验的历史快照', () => {
  const entry = { fingerprint: 'blob:last' }
  const current = { fingerprint: 'blob:now', text: 'new' }
  const input = { fullName: 'a/repo', entry, translation: { summary: 'old' }, current, now: 0 }
  assert.equal(evaluateReadmeTranslation(input).status, 'needs-previous')
  assert.equal(evaluateReadmeTranslation({ ...input, previous: current }).status, 'check-failed')
})
