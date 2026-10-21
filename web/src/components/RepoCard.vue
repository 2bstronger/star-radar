<script setup>
import { langColor, fmtNum, relTime } from '../lib/utils'

defineProps({ repo: Object, uiLang: String })
defineEmits(['open'])
</script>

<template>
  <article
    class="group cursor-pointer rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-sky-400 hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
    @click="$emit('open')"
  >
    <div class="flex items-start justify-between gap-2">
      <h3 class="truncate font-mono text-sm font-semibold text-sky-700 group-hover:underline dark:text-sky-400">
        {{ repo.fullName }}
      </h3>
      <span
        v-if="repo.isArchived"
        class="shrink-0 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-400"
      >
        已归档
      </span>
    </div>
    <p class="mt-1.5 line-clamp-2 min-h-[2.5rem] text-sm text-slate-700 dark:text-slate-300">
      <template v-if="uiLang === 'cn' && repo.zh">{{ repo.zh.positioning }}</template>
      <template v-else>{{ repo.description || '暂无描述' }}</template>
    </p>
    <div class="mt-2 flex flex-wrap gap-1">
      <span
        v-if="!repo.zh"
        class="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700 dark:bg-amber-900/50 dark:text-amber-300"
      >
        待翻译
      </span>
      <span
        v-for="c in repo.zh?.categories ?? []"
        :key="c"
        class="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] text-sky-700 dark:bg-sky-950 dark:text-sky-300"
      >
        {{ c }}
      </span>
      <span
        v-for="t in (repo.topics ?? []).slice(0, 3)"
        :key="t"
        class="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-400"
      >
        #{{ t }}
      </span>
    </div>
    <div class="mt-3 flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
      <span class="flex items-center gap-1">
        <span class="inline-block h-2 w-2 rounded-full" :style="{ background: langColor(repo.primaryLanguage) }"></span>
        {{ repo.primaryLanguage || '—' }}
      </span>
      <span>⭐ {{ fmtNum(repo.stars) }}</span>
      <span class="ml-auto">{{ relTime(repo.pushedAt) }}推送</span>
    </div>
  </article>
</template>
