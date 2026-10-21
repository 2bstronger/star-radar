<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import LangBars from './LangBars.vue'
import { fmtNum, fmtDate, relTime, copyText } from '../lib/utils'

const props = defineProps({ repo: Object, uiLang: String })
const emit = defineEmits(['close'])

const repoUrl = computed(() => `https://github.com/${props.repo.fullName}`)
const readmeUrl = computed(() => `${repoUrl.value}#readme`)

const copied = ref(false)
async function copy() {
  if (await copyText(props.repo.zh?.quickStart ?? '')) {
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  }
}

function onKey(e) {
  if (e.key === 'Escape') emit('close')
}
onMounted(() => {
  document.addEventListener('keydown', onKey)
  document.body.style.overflow = 'hidden'
})
onUnmounted(() => {
  document.removeEventListener('keydown', onKey)
  document.body.style.overflow = ''
})

const H = 'mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400'
</script>

<template>
  <teleport to="body">
    <div class="fixed inset-0 z-40 bg-black/40" @click="emit('close')"></div>
    <aside
      class="drawer-enter fixed right-0 top-0 z-50 h-full w-full max-w-xl overflow-y-auto bg-white shadow-2xl dark:bg-slate-900"
    >
      <div
        class="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white/90 px-5 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90"
      >
        <a :href="repoUrl" target="_blank" rel="noopener" class="truncate font-mono font-bold hover:underline">
          {{ repo.fullName }}
        </a>
        <button
          class="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          @click="emit('close')"
        >
          ✕
        </button>
      </div>

      <div class="space-y-6 px-5 py-5 text-sm">
        <!-- 中文四件套 -->
        <template v-if="repo.zh">
          <section>
            <h3 :class="H">一句话定位</h3>
            <p class="text-lg font-semibold leading-snug">{{ repo.zh.positioning }}</p>
          </section>
          <section>
            <h3 :class="H">简介</h3>
            <p class="whitespace-pre-line leading-relaxed text-slate-700 dark:text-slate-300">
              {{ repo.zh.summary }}
            </p>
          </section>
          <section>
            <h3 :class="H">适用场景</h3>
            <ul class="list-disc space-y-1 pl-5 leading-relaxed text-slate-700 dark:text-slate-300">
              <li v-for="(s, i) in repo.zh.scenarios" :key="i">{{ s }}</li>
            </ul>
          </section>
          <section>
            <div class="flex items-center justify-between">
              <h3 :class="H">快速上手</h3>
              <button
                class="rounded border border-slate-300 px-2 py-0.5 text-xs hover:border-slate-500 dark:border-slate-700"
                @click="copy"
              >
                {{ copied ? '已复制 ✓' : '复制' }}
              </button>
            </div>
            <pre class="overflow-x-auto rounded-lg bg-slate-950 p-3 text-xs leading-relaxed text-slate-100 dark:bg-black">{{ repo.zh.quickStart }}</pre>
          </section>
        </template>
        <p v-else class="rounded-lg bg-amber-50 p-3 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
          该项目还没有中文摘要（待翻译）。可运行 npm run translate 生成。
        </p>

        <!-- 原文核对 -->
        <details
          class="rounded-lg border border-slate-200 p-3 dark:border-slate-800"
          :open="uiLang === 'en' || !repo.zh"
        >
          <summary :class="H + ' cursor-pointer'">原文核对（English）</summary>
          <p class="mt-2 leading-relaxed text-slate-700 dark:text-slate-300">
            {{ repo.description || '暂无描述' }}
          </p>
          <div class="mt-2 flex flex-wrap gap-1" v-if="repo.topics?.length">
            <span
              v-for="t in repo.topics"
              :key="t"
              class="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-400"
            >
              #{{ t }}
            </span>
          </div>
          <div v-if="repo.zh?.tags?.length" class="mt-2 flex flex-wrap gap-1">
            <span
              v-for="t in repo.zh.tags"
              :key="t"
              class="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] text-sky-700 dark:bg-sky-950 dark:text-sky-300"
            >
              {{ t }}
            </span>
          </div>
        </details>

        <section>
          <h3 :class="H">语言占比</h3>
          <LangBars :languages="repo.languages" />
        </section>

        <section class="grid grid-cols-2 gap-x-6 gap-y-2 text-slate-600 dark:text-slate-300">
          <div>⭐ Stars：<b>{{ fmtNum(repo.stars) }}</b></div>
          <div>🍴 Forks：<b>{{ fmtNum(repo.forks) }}</b></div>
          <div>📅 创建于：<b>{{ fmtDate(repo.createdAt) }}</b></div>
          <div>🚀 最近推送：<b>{{ fmtDate(repo.pushedAt) }}</b>（{{ relTime(repo.pushedAt) }}）</div>
          <div>⏰ 我 star 于：<b>{{ fmtDate(repo.starredAt) }}</b></div>
          <div>❗ Open issues：<b>{{ repo.openIssues }}</b></div>
          <div>📄 License：<b>{{ repo.license || '无' }}</b></div>
          <div>🌿 默认分支：<b class="font-mono">{{ repo.defaultBranch || '—' }}</b></div>
        </section>

        <section>
          <h3 :class="H">最热 Open Issue</h3>
          <a
            v-if="repo.hotIssue"
            :href="repo.hotIssue.url"
            target="_blank"
            rel="noopener"
            class="block rounded-lg border border-slate-200 p-3 leading-snug hover:border-sky-400 hover:text-sky-700 dark:border-slate-800 dark:hover:border-sky-500 dark:hover:text-sky-300"
          >
            #{{ repo.hotIssue.number }} {{ repo.hotIssue.title }}
            <span class="mt-1 block text-xs text-slate-400">💬 {{ repo.hotIssue.comments }} 条评论</span>
          </a>
          <p v-else class="text-slate-400">暂无</p>
        </section>

        <section class="flex flex-wrap gap-2 pb-6">
          <a
            :href="repoUrl"
            target="_blank"
            rel="noopener"
            class="rounded-lg bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-700 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
          >
            GitHub 仓库
          </a>
          <a
            :href="readmeUrl"
            target="_blank"
            rel="noopener"
            class="rounded-lg border border-slate-300 px-4 py-2 hover:border-slate-500 dark:border-slate-700"
          >
            README
          </a>
          <a
            v-if="repo.homepageUrl"
            :href="repo.homepageUrl"
            target="_blank"
            rel="noopener"
            class="rounded-lg border border-slate-300 px-4 py-2 hover:border-slate-500 dark:border-slate-700"
          >
            项目主页 ↗
          </a>
          <span
            v-else
            class="cursor-not-allowed rounded-lg border border-slate-200 px-4 py-2 text-slate-300 dark:border-slate-800 dark:text-slate-600"
            title="该项目没有设置主页"
          >
            项目主页
          </span>
        </section>
      </div>
    </aside>
  </teleport>
</template>
