<script setup>
import { relTime } from '../lib/utils'

defineProps({ total: Number, shown: Number, meta: Object, uiLang: String, dark: Boolean })
defineEmits(['set-lang', 'toggle-dark'])
</script>

<template>
  <header
    class="sticky top-0 z-30 border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80"
  >
    <div class="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3">
      <h1 class="text-xl font-bold">⭐ 开源项目雷达</h1>
      <span class="text-sm text-slate-500 dark:text-slate-400">
        {{ total }} 个项目<template v-if="meta?.fetchedAt"> · 更新于 {{ relTime(meta.fetchedAt) }}</template><template v-if="shown !== total"> · 筛出 {{ shown }}</template>
      </span>
      <div class="ml-auto flex items-center gap-2">
        <div class="flex overflow-hidden rounded-lg border border-slate-300 text-sm dark:border-slate-700">
          <button
            class="px-3 py-1"
            :class="uiLang === 'cn' ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'text-slate-600 dark:text-slate-300'"
            @click="$emit('set-lang', 'cn')"
          >
            中文
          </button>
          <button
            class="px-3 py-1"
            :class="uiLang === 'en' ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'text-slate-600 dark:text-slate-300'"
            @click="$emit('set-lang', 'en')"
          >
            EN
          </button>
        </div>
        <button
          class="rounded-lg border border-slate-300 px-3 py-1 text-sm dark:border-slate-700"
          @click="$emit('toggle-dark')"
        >
          {{ dark ? '☀️' : '🌙' }}
        </button>
      </div>
    </div>
  </header>
</template>
