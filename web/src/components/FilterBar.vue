<script setup>
import { ref, watch } from 'vue'

const props = defineProps({ f: Object, categories: Array, languages: Array, licenses: Array })

const SORTS = [
  ['starredAt', '我 star 的时间'],
  ['stars', 'Star 数'],
  ['pushedAt', '最近推送'],
]
const RANGES = [
  ['all', '全部'],
  ['1m', '近 1 月'],
  ['3m', '近 3 月'],
  ['6m', '近 6 月'],
  ['1y', '近 1 年'],
]

// 搜索防抖 200ms
const q = ref(props.f.query)
let timer
watch(q, (v) => {
  clearTimeout(timer)
  timer = setTimeout(() => (props.f.query = v), 200)
})

const sel =
  'rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950'

function toggleCat(c) {
  const i = props.f.cats.indexOf(c)
  if (i >= 0) props.f.cats.splice(i, 1)
  else props.f.cats.push(c)
}
</script>

<template>
  <section
    class="mt-4 space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
  >
    <div class="flex flex-wrap items-center gap-3">
      <input
        v-model="q"
        type="search"
        placeholder="搜索：名称 / 描述 / 中文定位 / 标签…"
        class="w-64 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950"
      />
      <select v-model="f.lang" :class="sel">
        <option value="">全部语言</option>
        <option v-for="l in languages" :key="l.name" :value="l.name">{{ l.name }}（{{ l.count }}）</option>
      </select>
      <select v-model="f.license" :class="sel">
        <option value="">全部 License</option>
        <option v-for="l in licenses" :key="l.name" :value="l.name">{{ l.name }}（{{ l.count }}）</option>
      </select>
      <select v-model="f.range" :class="sel">
        <option v-for="[v, label] in RANGES" :key="v" :value="v">star 时间：{{ label }}</option>
      </select>
      <select v-model="f.sort" :class="sel">
        <option v-for="[v, label] in SORTS" :key="v" :value="v">按{{ label }}</option>
      </select>
      <label class="flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300">
        <input v-model="f.hideArchived" type="checkbox" class="accent-slate-700" />
        隐藏已归档
      </label>
    </div>
    <div class="flex flex-wrap items-center gap-1.5">
      <button
        v-for="c in categories"
        :key="c"
        class="rounded-full border px-2.5 py-0.5 text-xs transition"
        :class="
          f.cats.includes(c)
            ? 'border-sky-500 bg-sky-500 text-white'
            : 'border-slate-300 text-slate-600 hover:border-sky-400 hover:text-sky-600 dark:border-slate-700 dark:text-slate-300'
        "
        @click="toggleCat(c)"
      >
        {{ c }}
      </button>
      <button v-if="f.cats.length" class="ml-1 text-xs text-slate-400 underline" @click="f.cats.splice(0)">
        清空
      </button>
    </div>
  </section>
</template>
