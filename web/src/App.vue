<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue'
import StatsHeader from './components/StatsHeader.vue'
import FilterBar from './components/FilterBar.vue'
import RepoCard from './components/RepoCard.vue'
import DetailDrawer from './components/DetailDrawer.vue'
import { CATEGORIES } from './lib/taxonomy'

const stars = ref(null)
const zhMap = ref({})
const overrides = ref({})
const meta = ref(null)
const error = ref('')

onMounted(async () => {
  const get = async (f) => {
    try {
      const r = await fetch(`./data/${f}`)
      if (!r.ok) return null
      return await r.json()
    } catch {
      return null
    }
  }
  const s = await get('stars.json')
  if (!Array.isArray(s)) {
    error.value = 'stars.json 加载失败：请先运行 npm run fetch 与 npm run sync（详见 README）'
    return
  }
  stars.value = s
  const z = await get('zh.json')
  if (z && typeof z === 'object') zhMap.value = z
  const o = await get('overrides.json')
  if (o && typeof o === 'object') overrides.value = o
  meta.value = await get('meta.json')
})

// 合并三层：GitHub 元数据 + 中文摘要 + 人工覆盖（覆盖优先级最高）
const repos = computed(() =>
  (stars.value ?? []).map((r) => {
    const z = zhMap.value[r.fullName] || null
    const o = overrides.value[r.fullName] || {}
    const zh = z
      ? {
          ...z,
          ...(typeof o.positioning === 'string' ? { positioning: o.positioning } : {}),
          ...(Array.isArray(o.categories) ? { categories: o.categories } : {}),
        }
      : null
    return { ...r, zh, pinned: !!o.pin }
  }),
)

// 中英切换（记忆）与暗色模式（记忆）
const uiLang = ref(localStorage.getItem('radar-lang') || 'cn')
watch(uiLang, (v) => localStorage.setItem('radar-lang', v))
const dark = ref(localStorage.getItem('radar-dark') === '1')
watch(dark, (v) => {
  localStorage.setItem('radar-dark', v ? '1' : '0')
  document.documentElement.classList.toggle('dark', v)
})
onMounted(() => {
  if (dark.value) document.documentElement.classList.add('dark')
})

const f = reactive({
  query: '',
  cats: [],
  lang: '',
  license: '',
  range: 'all',
  sort: 'starredAt',
  hideArchived: true,
})

const languageOptions = computed(() => {
  const m = new Map()
  for (const r of repos.value) if (r.primaryLanguage) m.set(r.primaryLanguage, (m.get(r.primaryLanguage) || 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }))
})

const licenseOptions = computed(() => {
  const m = new Map()
  for (const r of repos.value) {
    const l = r.license || '无 License'
    m.set(l, (m.get(l) || 0) + 1)
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }))
})

const RANGE_DAYS = { '1m': 30, '3m': 90, '6m': 180, '1y': 365 }

const filtered = computed(() => {
  let list = repos.value
  if (f.hideArchived) list = list.filter((r) => !r.isArchived)
  if (f.cats.length) list = list.filter((r) => (r.zh?.categories ?? []).some((c) => f.cats.includes(c)))
  if (f.lang) list = list.filter((r) => r.primaryLanguage === f.lang)
  if (f.license) list = list.filter((r) => (r.license || '无 License') === f.license)
  if (f.range !== 'all') {
    const cutoff = Date.now() - RANGE_DAYS[f.range] * 86400000
    list = list.filter((r) => new Date(r.starredAt).getTime() >= cutoff)
  }
  const q = f.query.trim().toLowerCase()
  if (q) {
    list = list.filter((r) => {
      const hay = [
        r.fullName,
        r.description,
        r.primaryLanguage,
        r.zh?.positioning,
        r.zh?.summary,
        ...(r.topics ?? []),
        ...(r.zh?.tags ?? []),
      ]
        .filter(Boolean)
        .join('\n')
        .toLowerCase()
      return hay.includes(q)
    })
  }
  const key = { starredAt: (r) => r.starredAt, stars: (r) => r.stars, pushedAt: (r) => r.pushedAt }[f.sort]
  return [...list].sort((a, b) => new Date(key(b)) - new Date(key(a)))
})

const activeRepo = ref(null)
</script>

<template>
  <div class="min-h-screen">
    <StatsHeader
      :total="stars?.length ?? 0"
      :shown="filtered.length"
      :meta="meta"
      :ui-lang="uiLang"
      :dark="dark"
      @set-lang="uiLang = $event"
      @toggle-dark="dark = !dark"
    />
    <main class="mx-auto max-w-7xl px-4 pb-16">
      <div
        v-if="error"
        class="mt-10 rounded-xl border border-red-300 bg-red-50 p-6 text-center text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300"
      >
        {{ error }}
      </div>
      <div v-else-if="!stars" class="mt-16 text-center text-slate-400">数据加载中…</div>
      <template v-else>
        <FilterBar :f="f" :categories="CATEGORIES" :languages="languageOptions" :licenses="licenseOptions" />
        <p v-if="!filtered.length" class="mt-16 text-center text-slate-400">
          没有匹配的项目，换个筛选条件试试～
        </p>
        <div v-else class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <RepoCard v-for="r in filtered" :key="r.fullName" :repo="r" :ui-lang="uiLang" @open="activeRepo = r" />
        </div>
      </template>
    </main>
    <DetailDrawer v-if="activeRepo" :repo="activeRepo" :ui-lang="uiLang" @close="activeRepo = null" />
  </div>
</template>
