import { readFileSync, appendFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { pathToFileURL } from 'node:url'
if (process.env.MOCK_CRASH_AFTER_ZH) {
  const rename = fs.renameSync
  let savedZh = false
  fs.renameSync = (...args) => {
    if (savedZh && String(args[1]).endsWith('readme-state.json')) process.exit(86)
    rename(...args)
    if (String(args[1]).endsWith('zh.json')) savedZh = true
  }
  syncBuiltinESMExports()
}
const fixture = JSON.parse(readFileSync(process.env.MOCK_FIXTURE, 'utf8'))
if (fixture.now !== undefined) {
  globalThis.Date = class extends Date {
    constructor(...args) { super(...(args.length ? args : [fixture.now])) }
    static now() { return fixture.now }
  }
}
globalThis.setTimeout = (fn) => { queueMicrotask(fn); return 0 }
globalThis.fetch = async (url, options = {}) => {
  if (url.includes('/chat/completions')) {
    const body = JSON.parse(options.body)
    const name = body.messages[1].content.match(/^项目：(.+)$/m)[1]
    const state = JSON.parse(readFileSync(new URL('readme-state.json', pathToFileURL(process.env.MOCK_FIXTURE)), 'utf8'))
    if (state.repos[name].lastAttemptAt !== new Date().toISOString()) throw new Error('Attempt not persisted before request')
    appendFileSync(process.env.MOCK_CALLS, `${name}\n`)
    if (process.env.MOCK_PROMPTS) appendFileSync(process.env.MOCK_PROMPTS, JSON.stringify({ name, content: body.messages[1].content }) + '\n')
    if (fixture.llmFail?.includes(name)) return new Response('', { status: 500 })
    return Response.json({ choices: [{ message: { content: JSON.stringify({ positioning: '中文', summary: '简介' }) } }] })
  }
  const match = url.match(/\/repos\/([^/]+\/[^/]+)(\/readme|\/git\/blobs\/[a-f0-9]{40})?$/)
  if (!match) throw new Error(`Unexpected URL: ${url}`)
  const name = match[1]
  if (!match[2]) {
    const status = fixture.repos?.[name] ?? 200
    if (status === 'ERROR') throw new Error('network error')
    return status === 200 ? Response.json({ full_name: name }) : new Response('', { status })
  }
  const value = fixture.readmes[name]
  const config = typeof value === 'string' ? { text: value } : value
  const bytes = typeof config?.text === 'string' ? Buffer.from(config.text) : null
  const sha = bytes && createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
  if (match[2].startsWith('/git/blobs/')) {
    if (options.headers.Accept !== 'application/vnd.github.raw+json') throw new Error('Invalid blob request')
    const requested = match[2].split('/').at(-1)
    const blob = requested === sha ? config : fixture.blobs?.[name]?.[requested]
    if (process.env.MOCK_BLOBS) appendFileSync(process.env.MOCK_BLOBS, `${name} ${requested}\n`)
    if (blob?.rawStatus === 'ERROR') throw new Error('network error')
    if (blob?.rawStatus || !blob) return new Response('', { status: blob?.rawStatus ?? 404 })
    return new Response(blob.rawText ?? blob.text)
  }
  if (value === 'ERROR') return new Response('', { status: 503 })
  if (value === null) return new Response('', { status: 404 })
  const content = config.metadataText === undefined ? bytes : Buffer.from(config.metadataText)
  return Response.json({ type: 'file', sha, size: bytes.length, encoding: config.encoding ?? 'base64', content: content.toString('base64') })
}
