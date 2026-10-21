<script setup>
import { langColor } from '../lib/utils'

defineProps({ languages: Array })
</script>

<template>
  <div class="space-y-1.5">
    <div v-for="l in languages" :key="l.name" class="flex items-center gap-2 text-xs">
      <span class="w-24 shrink-0 truncate text-slate-600 dark:text-slate-300">{{ l.name }}</span>
      <div class="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div class="h-full rounded-full" :style="{ width: Math.max(l.pct, 1.5) + '%', background: langColor(l.name) }"></div>
      </div>
      <span class="w-12 shrink-0 text-right text-slate-400">{{ l.pct }}%</span>
    </div>
    <p v-if="!languages?.length" class="text-xs text-slate-400">无语言数据</p>
  </div>
</template>
