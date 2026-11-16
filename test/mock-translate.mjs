import { readFileSync, appendFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
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
globalThis.setTimeout = (fn) => { queueMicrotask(fn); return 0 }
globalThis.fetch = async (url, options = {}) => {
  if (url.includes('/chat/completions')) {
    const body = JSON.parse(options.body)
    const name = body.messages[1].content.match(/^项目：(.+)$/m)[1]
    appendFileSync(process.env.MOCK_CALLS, `${name}\n`)
    if (fixture.llmFail?.includes(name)) return new Response('', { status: 500 })
    return Response.json({ choices: [{ message: { content: JSON.stringify({ positioning: '中文', summary: '简介' }) } }] })
  }
  const match = url.match(/\/repos\/([^/]+\/[^/]+)(\/readme)?$/)
  if (!match) throw new Error(`Unexpected URL: ${url}`)
  const name = match[1]
  if (!match[2]) {
    const status = fixture.repos?.[name] ?? 200
    if (status === 'ERROR') throw new Error('network error')
    return status === 200 ? Response.json({ full_name: name }) : new Response('', { status })
  }
  const value = fixture.readmes[name]
  if (value === 'ERROR') return new Response('', { status: 503 })
  if (value === null) return new Response('', { status: 404 })
  const bytes = Buffer.from(value)
  const sha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
  return Response.json({ type: 'file', sha, size: bytes.length, encoding: 'base64', content: bytes.toString('base64') })
}
