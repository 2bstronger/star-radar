import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

test('迁移、收藏、README 状态及失败重试', () => {
  const dir = mkdtempSync(join(resolve('test'), '.star-translate-'))
  const file = (name) => join(dir, name)
  const write = (name, obj) => writeFileSync(file(name), JSON.stringify(obj))
  const read = (name) => JSON.parse(readFileSync(file(name), 'utf8'))
  const repos = ['old', 'missing', 'absent', 'retry'].map((name) => ({ fullName: `a/${name}`, starredAt: '2024', description: 'old' }))
  const fixture = { readmes: { 'a/old': 'one', 'a/missing': 'missing', 'a/absent': null, 'a/retry': 'ERROR' } }
  write('stars.json', repos)
  write('zh.json', { 'a/old': { summary: 'legacy' }, 'a/absent': { summary: 'legacy' }, 'a/retry': { summary: 'legacy' } })
  writeFileSync(file('calls'), '')
  const run = () => {
    write('fixture.json', fixture)
    const result = spawnSync(process.execPath, ['--import', pathToFileURL(resolve('test/mock-translate.mjs')).href, resolve('scripts/translate.mjs')], {
      env: { SystemRoot: process.env.SystemRoot, TRANSLATE_DATA_DIR: dir, MOCK_FIXTURE: file('fixture.json'), MOCK_CALLS: file('calls'), GITHUB_TOKEN: 'test', LLM_BASE_URL: 'https://mock', LLM_API_KEY: 'test' }, encoding: 'utf8',
    })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout + result.stderr
  }
  const calls = () => readFileSync(file('calls'), 'utf8').trim().split('\n').filter(Boolean)
  try {
    run()
    assert.deepEqual(calls(), ['a/missing'])
    assert.equal(read('readme-state.json').repos['a/retry'].baselinePending, true)
    fixture.readmes['a/retry'] = 'recovered'
    repos[0].description = 'changed'; repos[0].pushedAt = 'later'; repos[0].topics = ['new']
    write('stars.json', repos); run()
    assert.deepEqual(calls(), ['a/missing'])
    fixture.readmes['a/old'] = 'two'; run(); run()
    assert.deepEqual(calls(), ['a/missing', 'a/old'])
    fixture.readmes['a/absent'] = 'created'; run()
    fixture.readmes['a/absent'] = null; run()
    assert.deepEqual(calls().slice(-2), ['a/absent', 'a/absent'])
    const added = { fullName: 'a/new', starredAt: '2025' }
    const cache = read('zh.json')
    cache['a/new'] = { summary: '取消收藏前保留的旧翻译' }
    write('zh.json', cache)
    fixture.readmes['a/new'] = 'new'; repos.push(added); write('stars.json', repos); run()
    repos.pop(); write('stars.json', repos); run()
    repos.push(added); write('stars.json', repos); run()
    assert.deepEqual(calls().slice(-2), ['a/new', 'a/new'])
    const before = read('readme-state.json').repos['a/old'].fingerprint
    fixture.readmes['a/old'] = 'ERROR'; run()
    assert.equal(read('readme-state.json').repos['a/old'].fingerprint, before)
    fixture.readmes['a/old'] = 'three'; fixture.llmFail = ['a/old']; run()
    assert.equal(read('readme-state.json').repos['a/old'].fingerprint, before)
    const count = calls().length
    delete fixture.llmFail; run(); run()
    assert.equal(calls().length, count + 1)
    assert.notEqual(read('readme-state.json').repos['a/old'].fingerprint, before)
    // Re-star between runs is detected from starredAt even if the old translation survives.
    added.starredAt = '2026'; write('stars.json', repos); run()
    assert.equal(calls().at(-1), 'a/new')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('首次翻译写入后崩溃可重试，旧异常状态也可恢复', () => {
  const dir = mkdtempSync(join(resolve('test'), '.star-translate-'))
  const file = (name) => join(dir, name)
  const write = (name, obj) => writeFileSync(file(name), JSON.stringify(obj))
  const read = (name) => JSON.parse(readFileSync(file(name), 'utf8'))
  const fixture = { readmes: { 'a/new': 'first' } }
  const run = (extra = {}) => {
    write('fixture.json', fixture)
    return spawnSync(process.execPath, ['--import', pathToFileURL(resolve('test/mock-translate.mjs')).href, resolve('scripts/translate.mjs')], {
      env: { SystemRoot: process.env.SystemRoot, TRANSLATE_DATA_DIR: dir, MOCK_FIXTURE: file('fixture.json'), MOCK_CALLS: file('calls'), GITHUB_TOKEN: 'test', LLM_BASE_URL: 'https://mock', LLM_API_KEY: 'test', ...extra }, encoding: 'utf8',
    })
  }
  try {
    write('stars.json', [{ fullName: 'a/new' }]); write('zh.json', {}); writeFileSync(file('calls'), '')
    assert.equal(run({ MOCK_CRASH_AFTER_ZH: '1' }).status, 86)
    assert.equal(read('zh.json')['a/new'].summary, '简介')
    assert.equal(read('readme-state.json').repos['a/new'].newPending, true)
    assert.equal(run().status, 0)
    assert.equal(readFileSync(file('calls'), 'utf8').trim().split('\n').length, 2)
    fixture.readmes['a/new'] = 'second'
    assert.equal(run().status, 0)
    assert.equal(readFileSync(file('calls'), 'utf8').trim().split('\n').length, 3)
    write('readme-state.json', { version: 1, repos: { 'a/new': { active: true, baselinePending: false } } })
    assert.equal(run().status, 0)
    assert.equal(readFileSync(file('calls'), 'utf8').trim().split('\n').length, 4)
    assert.ok(read('readme-state.json').repos['a/new'].fingerprint)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('README 404 仅在仓库可访问时确认为不存在', () => {
  const dir = mkdtempSync(join(resolve('test'), '.star-translate-'))
  const file = (name) => join(dir, name)
  const write = (name, obj) => writeFileSync(file(name), JSON.stringify(obj))
  const read = (name) => JSON.parse(readFileSync(file(name), 'utf8'))
  const fixture = { readmes: { 'a/repo': 'original' }, repos: {} }
  const run = () => {
    write('fixture.json', fixture)
    return spawnSync(process.execPath, ['--import', pathToFileURL(resolve('test/mock-translate.mjs')).href, resolve('scripts/translate.mjs')], {
      env: { SystemRoot: process.env.SystemRoot, TRANSLATE_DATA_DIR: dir, MOCK_FIXTURE: file('fixture.json'), MOCK_CALLS: file('calls'), GITHUB_TOKEN: 'test', LLM_BASE_URL: 'https://mock', LLM_API_KEY: 'test' }, encoding: 'utf8',
    })
  }
  try {
    write('stars.json', [{ fullName: 'a/repo' }]); write('zh.json', { 'a/repo': { summary: 'legacy' } }); writeFileSync(file('calls'), '')
    assert.equal(run().status, 0)
    const before = read('readme-state.json').repos['a/repo'].fingerprint
    fixture.readmes['a/repo'] = null
    for (const status of [404, 403, 429, 'ERROR']) {
      fixture.repos['a/repo'] = status
      const result = run()
      assert.equal(result.status, 0)
      assert.match(result.stderr, /::warning::.*失败 1/)
      assert.match(result.stdout, /失败 1/)
      assert.equal(read('readme-state.json').repos['a/repo'].fingerprint, before)
      assert.equal(read('zh.json')['a/repo'].summary, 'legacy')
    }
    fixture.repos['a/repo'] = 200
    assert.equal(run().status, 0)
    assert.equal(read('readme-state.json').repos['a/repo'].fingerprint, 'none')
    assert.equal(readFileSync(file('calls'), 'utf8').trim(), 'a/repo')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('大 README 使用完整 blob，失败保留指纹并重试', () => {
  const dir = mkdtempSync(join(resolve('test'), '.star-translate-'))
  const file = (name) => join(dir, name)
  const write = (name, obj) => writeFileSync(file(name), JSON.stringify(obj))
  const read = (name) => JSON.parse(readFileSync(file(name), 'utf8'))
  const large = '大README\n' + 'x'.repeat(520000) + '\n完整结尾'
  const changed = large + '\n更新'
  const fixture = { readmes: {
    'a/old': { text: large, metadataText: large.slice(0, 512000) },
    'a/new': { text: large, encoding: 'none' },
  } }
  const run = () => {
    write('fixture.json', fixture)
    const result = spawnSync(process.execPath, ['--import', pathToFileURL(resolve('test/mock-translate.mjs')).href, resolve('scripts/translate.mjs')], {
      env: { SystemRoot: process.env.SystemRoot, TRANSLATE_DATA_DIR: dir, MOCK_FIXTURE: file('fixture.json'), MOCK_CALLS: file('calls'), MOCK_PROMPTS: file('prompts'), GITHUB_TOKEN: 'test', LLM_BASE_URL: 'https://mock', LLM_API_KEY: 'test' }, encoding: 'utf8',
    })
    assert.equal(result.status, 0, result.stderr)
    return result
  }
  try {
    write('stars.json', [{ fullName: 'a/old' }, { fullName: 'a/new' }])
    write('zh.json', { 'a/old': { summary: 'legacy' } })
    writeFileSync(file('calls'), ''); writeFileSync(file('prompts'), '')
    run()
    assert.deepEqual(readFileSync(file('calls'), 'utf8').trim().split('\n'), ['a/new'])
    const prompt = JSON.parse(readFileSync(file('prompts'), 'utf8').trim())
    assert.equal(prompt.name, 'a/new')
    assert.equal(prompt.content.split('README 全文：\n')[1], large)
    const before = read('readme-state.json').repos['a/old'].fingerprint
    assert.ok(before.startsWith('blob:'))
    assert.equal(read('readme-state.json').repos['a/old'].baselinePending, undefined)
    fixture.readmes['a/old'] = { text: changed, metadataText: 'truncated', rawStatus: 404 }
    assert.match(run().stderr, /失败 1/)
    assert.equal(read('readme-state.json').repos['a/old'].fingerprint, before)
    fixture.readmes['a/old'] = { text: changed, metadataText: 'truncated', rawText: 'x'.repeat(Buffer.byteLength(changed)) }
    assert.match(run().stderr, /失败 1/)
    assert.equal(read('readme-state.json').repos['a/old'].fingerprint, before)
    assert.equal(readFileSync(file('calls'), 'utf8').trim(), 'a/new')
    fixture.readmes['a/old'] = { text: changed, metadataText: 'truncated' }
    run()
    const prompts = readFileSync(file('prompts'), 'utf8').trim().split('\n').map(JSON.parse)
    assert.equal(prompts.at(-1).name, 'a/old')
    assert.equal(prompts.at(-1).content.split('README 全文：\n')[1], changed)
    assert.notEqual(read('readme-state.json').repos['a/old'].fingerprint, before)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('无 token 且未配置 LLM 时离线跳过', () => {
  const dir = mkdtempSync(join(resolve('test'), '.star-translate-'))
  try {
    const result = spawnSync(process.execPath, [resolve('scripts/translate.mjs')], {
      env: { SystemRoot: process.env.SystemRoot, TRANSLATE_DATA_DIR: dir }, encoding: 'utf8',
    })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /跳过/)
    assert.equal(result.stderr, '')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
