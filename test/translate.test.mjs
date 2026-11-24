import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { README_COOLDOWN_MS } from '../scripts/lib/readme-policy.mjs'

const start = Date.parse('2025-11-23T12:00:00Z')
const iso = (time) => new Date(time).toISOString()
const sha = (text) => createHash('sha1').update(`blob ${Buffer.byteLength(text)}\0`).update(text).digest('hex')
const fingerprint = (text) => `blob:${sha(text)}`
const star = (fullName, starredAt = '2024') => ({ fullName, starredAt })
const legacy = { summary: 'legacy' }

function offline(t, stars, readmes, zh = {}) {
  const dir = mkdtempSync(join(resolve('test'), '.star-translate-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const file = (name) => join(dir, name)
  const write = (name, value) => writeFileSync(file(name), JSON.stringify(value))
  const read = (name) => JSON.parse(readFileSync(file(name), 'utf8'))
  const lines = (name) => readFileSync(file(name), 'utf8').trim().split('\n').filter(Boolean)
  const fixture = { now: start, readmes, blobs: {} }
  write('stars.json', stars)
  write('zh.json', zh)
  for (const name of ['calls', 'prompts', 'blobs']) writeFileSync(file(name), '')

  const run = (extra = {}, expectedExit = 0) => {
    for (const [name, value] of Object.entries(fixture.readmes)) {
      const text = value?.text ?? value
      if (typeof text !== 'string' || value === 'ERROR') continue
      const blobs = fixture.blobs[name] ??= {}
      blobs[sha(text)] ??= { text }
    }
    write('fixture.json', fixture)
    const result = spawnSync(process.execPath, ['--import', pathToFileURL(resolve('test/mock-translate.mjs')).href, resolve('scripts/translate.mjs')], {
      env: {
        SystemRoot: process.env.SystemRoot, TRANSLATE_DATA_DIR: dir, MOCK_FIXTURE: file('fixture.json'),
        MOCK_CALLS: file('calls'), MOCK_PROMPTS: file('prompts'), MOCK_BLOBS: file('blobs'),
        GITHUB_TOKEN: 'test', LLM_BASE_URL: 'https://mock', LLM_API_KEY: 'test', ...extra,
      },
      encoding: 'utf8',
    })
    assert.equal(result.status, expectedExit, result.stderr)
    return result.stdout + result.stderr
  }
  return {
    fixture, run, write, read, entry: (name) => read('readme-state.json').repos[name],
    calls: () => lines('calls'), prompts: () => lines('prompts').map(JSON.parse), blobCalls: () => lines('blobs'),
  }
}

test('迁移保留旧翻译，缺译和新增或重新收藏立即处理', (t) => {
  const stars = ['a/old', 'a/missing', 'a/retry'].map((name) => star(name))
  const { fixture, run, write, entry, calls, blobCalls } = offline(t, stars, {
    'a/old': 'one', 'a/missing': 'missing', 'a/retry': 'ERROR',
  }, { 'a/old': legacy, 'a/retry': legacy, 'a/new': legacy })
  run()
  assert.deepEqual(calls(), ['a/missing'])
  assert.deepEqual(blobCalls(), [])
  assert.equal(entry('a/old').fingerprint, fingerprint('one'))
  assert.equal(entry('a/old').lastAttemptAt, undefined)
  assert.equal(entry('a/retry').baselinePending, true)
  fixture.readmes['a/retry'] = 'recovered'
  stars[0] = { ...stars[0], description: 'changed', pushedAt: 'later', topics: ['new'] }
  write('stars.json', stars)
  run()
  assert.deepEqual(calls(), ['a/missing'])
  assert.deepEqual(blobCalls(), [])
  assert.equal(entry('a/retry').fingerprint, fingerprint('recovered'))

  const added = star('a/new', '2025')
  fixture.readmes['a/new'] = 'new'
  const setStars = (repos) => { write('stars.json', repos); run() }
  setStars([...stars, added])
  setStars(stars)
  setStars([...stars, added])
  setStars([...stars, { ...added, starredAt: '2026' }])
  assert.deepEqual(calls(), ['a/missing', 'a/new', 'a/new', 'a/new'])
})

test('累积、展示噪声、冷却和恢复原文均使用已翻译基线', (t) => {
  const name = 'a/repo'
  const before = '项目介绍\nLast updated: 2025-11-23'
  const updated = before.replace('11-23', '11-24')
  const { fixture, run, write, entry, calls, prompts } = offline(t, [star(name)], { [name]: before }, {
    [name]: { ...legacy, translatedAt: iso(start) },
  })
  write('readme-state.json', { version: 1, repos: { [name]: { active: true, fingerprint: fingerprint(before) } } })
  run()
  assert.deepEqual(calls(), [])
  fixture.readmes[name] = updated
  assert.match(run(), /展示或空白变化 1/)
  const body = (count) => `项目介绍${'x'.repeat(count)}\nLast updated: 2025-11-24`
  fixture.readmes[name] = body(149)
  assert.match(run(), /小改动 1/)
  fixture.readmes[name] = body(150)
  fixture.now = start + README_COOLDOWN_MS - 1
  assert.match(run(), /冷却等待 1/)
  assert.equal(entry(name).fingerprint, fingerprint(before))
  assert.equal(entry(name).lastAttemptAt, undefined)
  fixture.readmes[name] = before
  fixture.now++
  run()
  assert.deepEqual(calls(), [])

  fixture.readmes[name] = body(150)
  assert.match(run({ LLM_API_KEY: '' }), /未配置 LLM/)
  assert.equal(entry(name).lastAttemptAt, undefined)
  run()
  assert.deepEqual(calls(), [name])
  assert.equal(prompts()[0].content.split('README 全文：\n')[1], body(150))
  assert.equal(entry(name).fingerprint, fingerprint(body(150)))
})

test('README 型翻译失败保留指纹，冷却满 7 天后对未再修改的 README 重试', (t) => {
  const name = 'a/retry'
  const oldReadme = '```sh\nnpm install pkg@1\n```'
  const current = oldReadme.replace('@1', '@2')
  const { fixture, run, read, entry, calls } = offline(t, [star(name)], { [name]: oldReadme }, { [name]: legacy })
  run()
  fixture.readmes[name] = current
  fixture.llmFail = [name]
  assert.match(run(), /核心内容变化.*翻译失败/)
  assert.deepEqual(calls(), [name, name, name])
  assert.equal(entry(name).lastAttemptAt, iso(start))
  assert.equal(entry(name).fingerprint, fingerprint(oldReadme))
  assert.deepEqual(read('zh.json')[name], legacy)
  delete fixture.llmFail
  fixture.now += README_COOLDOWN_MS - 1
  assert.match(run(), /冷却等待 1/)
  assert.equal(calls().length, 3)
  fixture.now++
  run()
  assert.equal(calls().length, 4)
  assert.equal(entry(name).fingerprint, fingerprint(current))
  assert.equal(entry(name).lastAttemptAt, iso(start + README_COOLDOWN_MS))
})

test('缺译和新收藏失败后可立即重试', (t) => {
  const names = ['a/new', 'a/missing']
  const { fixture, run, write, entry, calls } = offline(t, names.map((name) => star(name)), {
    'a/new': 'new', 'a/missing': 'missing',
  }, { 'a/new': legacy })
  write('readme-state.json', { version: 1, repos: {
    'a/missing': { active: true, fingerprint: fingerprint('missing'), lastAttemptAt: iso(start) },
  } })
  fixture.llmFail = names
  assert.match(run(), /失败 2/)
  assert.equal(entry('a/new').newPending, true)
  assert.equal(entry('a/missing').lastAttemptAt, iso(start))
  delete fixture.llmFail
  assert.match(run(), /翻译成功 2/)
  for (const name of names) assert.equal(calls().filter((call) => call === name).length, 4)
})

test('首次翻译写入后崩溃可重试，旧异常状态也可恢复', (t) => {
  const name = 'a/new'
  const { run, write, read, entry, calls } = offline(t, [star(name)], { [name]: 'first' })
  run({ MOCK_CRASH_AFTER_ZH: '1' }, 86)
  assert.equal(read('zh.json')[name].summary, '简介')
  assert.equal(entry(name).newPending, true)
  run()
  assert.equal(calls().length, 2)
  write('readme-state.json', { version: 1, repos: { [name]: { active: true, baselinePending: false } } })
  run()
  assert.equal(calls().length, 3)
  assert.equal(entry(name).fingerprint, fingerprint('first'))
})

test('README 404 仅在仓库可访问时确认为不存在，新增和删除均有冷却', (t) => {
  const name = 'a/repo'
  const { fixture, run, read, entry, calls, blobCalls } = offline(t, [star(name)], { [name]: 'original' }, { [name]: legacy })
  run()
  fixture.readmes[name] = null
  for (const status of [404, 403, 429, 'ERROR']) {
    fixture.repos = { [name]: status }
    assert.match(run(), /::warning::.*失败 1/)
    assert.equal(entry(name).fingerprint, fingerprint('original'))
    assert.deepEqual(read('zh.json')[name], legacy)
  }
  fixture.repos[name] = 200
  assert.match(run(), /README 删除/)
  assert.equal(entry(name).fingerprint, 'none')
  fixture.readmes[name] = 'restored'
  assert.match(run(), /冷却等待 1/)
  fixture.now += README_COOLDOWN_MS
  assert.match(run(), /README 新增/)
  assert.equal(entry(name).fingerprint, fingerprint('restored'))
  assert.deepEqual(calls(), [name, name])
  assert.deepEqual(blobCalls(), [])
})

test('历史 blob 缺失、限流、网络故障或 SHA 不符保留翻译和指纹', (t) => {
  const name = 'a/repo'
  const before = '## 安装\nnpm install a@1'
  const { fixture, run, read, entry, calls, blobCalls } = offline(t, [star(name)], { [name]: before }, { [name]: legacy })
  run()
  fixture.readmes[name] = before.replace('@1', '@2')
  const blob = fixture.blobs[name][sha(before)]
  for (const status of [404, 403, 429, 'ERROR', null]) {
    blob.rawStatus = status
    blob.rawText = before.replace('@1', '@3')
    assert.match(run(), /历史 README blob 检查失败/)
    assert.equal(entry(name).fingerprint, fingerprint(before))
    assert.equal(entry(name).lastAttemptAt, undefined)
    assert.deepEqual(read('zh.json')[name], legacy)
  }
  assert.deepEqual(calls(), [])
  assert.deepEqual(blobCalls(), Array(7).fill(`${name} ${sha(before)}`))
  delete blob.rawText
  run()
  assert.deepEqual(calls(), [name])
  assert.equal(entry(name).fingerprint, fingerprint(fixture.readmes[name]))
})

test('大 README 使用完整 blob，失败保留指纹并重试', (t) => {
  const large = '大README\n' + 'x'.repeat(520000) + '\n完整结尾'
  const changed = large + '\n' + '更新'.repeat(75)
  const { fixture, run, entry, calls, prompts } = offline(t, [star('a/old'), star('a/new')], {
    'a/old': { text: large, metadataText: large.slice(0, 512000) },
    'a/new': { text: large, encoding: 'none' },
  }, { 'a/old': legacy })
  run()
  assert.deepEqual(calls(), ['a/new'])
  assert.equal(prompts()[0].content.split('README 全文：\n')[1], large)
  assert.equal(entry('a/old').fingerprint, fingerprint(large))
  assert.equal(entry('a/old').baselinePending, undefined)
  fixture.readmes['a/old'] = { text: changed, metadataText: 'truncated', rawStatus: 404 }
  assert.match(run(), /失败 1/)
  assert.equal(entry('a/old').fingerprint, fingerprint(large))
  fixture.readmes['a/old'] = { text: changed, metadataText: 'truncated', rawText: 'x'.repeat(Buffer.byteLength(changed)) }
  assert.match(run(), /失败 1/)
  assert.equal(entry('a/old').fingerprint, fingerprint(large))
  assert.deepEqual(calls(), ['a/new'])
  fixture.readmes['a/old'] = { text: changed, metadataText: 'truncated' }
  run()
  const prompt = prompts().at(-1)
  assert.equal(prompt.name, 'a/old')
  assert.equal(prompt.content.split('README 全文：\n')[1], changed)
  assert.equal(entry('a/old').fingerprint, fingerprint(changed))
})

test('无 token 且未配置 LLM 时离线跳过', (t) => {
  const { run } = offline(t, [], {})
  assert.match(run({ GITHUB_TOKEN: '', LLM_API_KEY: '' }), /跳过/)
})
