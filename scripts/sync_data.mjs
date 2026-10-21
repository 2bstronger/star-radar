#!/usr/bin/env node
/**
 * 把根目录 data/*.json 同步到 web/public/data/（构建前调用）
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = fileURLToPath(new URL('../data', import.meta.url))
const DST = fileURLToPath(new URL('../web/public/data', import.meta.url))

mkdirSync(DST, { recursive: true })
for (const f of ['stars.json', 'zh.json', 'meta.json', 'overrides.json']) {
  const src = join(SRC, f)
  if (existsSync(src)) {
    copyFileSync(src, join(DST, f))
    console.log(`✔ ${f} → web/public/data/`)
  } else {
    console.log(`⏭ data/${f} 不存在，跳过（web 端继续用现有文件）`)
  }
}
