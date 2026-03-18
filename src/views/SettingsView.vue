<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { showConfirmDialog, showToast } from 'vant'

import { DEFAULT_WORKER_BASE_URL } from '@/constants/settings'
import { exportSubscriptionsToOpml, parseOpml } from '@/services/opmlService'
import { trimAllSubscriptionsArticles } from '@/services/feedService'
import { isNative } from '@/services/nativeHttp'
import { useSettingsStore } from '@/stores/settings'
import { useSubscriptionStore } from '@/stores/subscriptions'
import type { SummaryLength, SummaryProvider } from '@/types/models'

const settingsStore = useSettingsStore()
const subscriptionStore = useSubscriptionStore()

const fontSize = ref(settingsStore.settings.fontSize)
const articleRetentionDays = ref(settingsStore.settings.articleRetentionDays)
const githubCopilotApiKey = ref(settingsStore.settings.githubCopilotApiKey)
const importingOpml = ref(false)
const importProgress = ref(0)
const importTotal = ref(0)
const onNative = isNative()

const summaryLengthLabel = computed(() => {
  if (settingsStore.settings.summaryLength === 'short') return '简短'
  if (settingsStore.settings.summaryLength === 'long') return '详细'
  return '标准'
})

const summaryProviderLabel = computed(() => {
  if (settingsStore.settings.summaryProvider === 'volcengine') return '火山方舟'
  if (settingsStore.settings.summaryProvider === 'github') return 'GitHub Copilot'
  return 'Google Gemini'
})

function cycleSummaryProvider() {
  const next: Record<SummaryProvider, SummaryProvider> = {
    google: 'volcengine',
    volcengine: 'github',
    github: 'google'
  }

  settingsStore.patchSettings({ summaryProvider: next[settingsStore.settings.summaryProvider] })
}

function cycleSummaryLength() {
  const next: Record<SummaryLength, SummaryLength> = {
    short: 'medium',
    medium: 'long',
    long: 'short'
  }

  settingsStore.patchSettings({ summaryLength: next[settingsStore.settings.summaryLength] })
}

onMounted(async () => {
  await subscriptionStore.load()
})

watch(fontSize, (value) => {
  settingsStore.patchSettings({ fontSize: value })
})

watch(articleRetentionDays, (value) => {
  settingsStore.patchSettings({ articleRetentionDays: value })
})

watch(githubCopilotApiKey, (value) => {
  settingsStore.patchSettings({ githubCopilotApiKey: value })
})

const themeLabel = computed(() => {
  if (settingsStore.settings.theme === 'dark') return '深色'
  if (settingsStore.settings.theme === 'light') return '浅色'
  return '跟随系统'
})

const cleaningArticles = ref(false)

async function manualCleanArticles() {
  try {
    await showConfirmDialog({
      title: '清理旧文章',
      message: `将删除每个订阅中超过 ${articleRetentionDays.value} 天且不在收藏中的文章（每个订阅保留最近 50 条以内不受影响）。确认继续？`,
      confirmButtonText: '清理',
      cancelButtonText: '取消'
    })
  } catch {
    return
  }

  cleaningArticles.value = true
  try {
    const deleted = await trimAllSubscriptionsArticles(articleRetentionDays.value)
    showToast(deleted > 0 ? `已清理 ${deleted} 篇文章` : '没有需要清理的文章')
  } catch {
    showToast('清理失败，请重试')
  } finally {
    cleaningArticles.value = false
  }
}

async function downloadOpml() {
  if (!subscriptionStore.items.length) {
    showToast('当前没有可导出的订阅')
    return
  }

  const content = exportSubscriptionsToOpml(subscriptionStore.items)
  const fileName = `neoreader-subscriptions-${new Date().toISOString().slice(0, 10)}.opml`

  if ('share' in navigator && 'canShare' in navigator) {
    const file = new File([content], fileName, { type: 'text/xml;charset=utf-8' })

    try {
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: '导出 OPML',
          files: [file]
        })
        return
      }
    } catch {
      return
    }
  }

  const blob = new Blob([content], { type: 'text/xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  link.remove()
}

async function importOpml(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return

  if (subscriptionStore.sourceUpdateInProgress) {
    target.value = ''
    showToast('当前正在更新订阅源，请稍候')
    return
  }

  importingOpml.value = true
  importProgress.value = 0
  importTotal.value = 0

  let feeds

  try {
    const text = await file.text()
    feeds = parseOpml(text)
  } catch {
    importingOpml.value = false
    target.value = ''
    showToast('OPML 文件读取失败')
    return
  }

  if (!feeds.length) {
    importingOpml.value = false
    target.value = ''
    showToast('没有识别到可导入的订阅')
    return
  }

  importTotal.value = feeds.length
  try {
    const count = await subscriptionStore.importMany(
      feeds.map((item) => item.feedUrl),
      DEFAULT_WORKER_BASE_URL,
      ({ completed, total }) => {
        importProgress.value = completed
        importTotal.value = total
      }
    )

    showToast(count > 0 ? `导入完成，新增 ${count} 个订阅` : '导入完成，没有新增订阅')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '导入失败')
  } finally {
    importingOpml.value = false
    target.value = ''
  }
}
</script>

<template>
  <section class="page page--sticky-header">
    <header class="page-header page-header--sticky">
      <div>
        <p class="eyebrow">Config</p>
        <h1>设置</h1>
      </div>
    </header>

    <div class="settings-sections">
      <section class="settings-section">
        <p class="settings-section__title">阅读体验</p>
        <van-cell-group inset>
          <van-cell title="主题模式" :value="themeLabel" is-link @click="settingsStore.patchSettings({ theme: settingsStore.settings.theme === 'system' ? 'light' : settingsStore.settings.theme === 'light' ? 'dark' : 'system' })" />
          <van-cell>
            <template #title>
              <div class="setting-cell-head">
                <span>字号</span>
                <span class="font-size-value" :style="{ fontSize: `${fontSize}px` }">{{ fontSize }}px</span>
              </div>
            </template>
            <template #label>
              <div class="font-slider-wrap">
                <span class="font-slider-label">小</span>
                <input v-model="fontSize" class="font-range" type="range" min="14" max="24" step="1" />
                <span class="font-slider-label">大</span>
              </div>
            </template>
          </van-cell>
        </van-cell-group>
      </section>

      <section class="settings-section">
        <p class="settings-section__title">AI 设置</p>
        <van-cell-group inset>
          <van-cell v-if="!onNative" title="摘要模型" :value="summaryProviderLabel" is-link @click="cycleSummaryProvider" />
          <van-cell title="摘要长度" :value="summaryLengthLabel" is-link @click="cycleSummaryLength" />
          <van-cell v-if="onNative" title="GitHub Copilot API Key">
            <template #label>
              <input
                v-model="githubCopilotApiKey"
                class="api-key-input"
                type="password"
                placeholder="输入 GitHub Copilot API Key"
                autocomplete="off"
                spellcheck="false"
              />
            </template>
          </van-cell>
        </van-cell-group>
      </section>

      <section class="settings-section">
        <p class="settings-section__title">数据管理</p>
        <van-cell-group inset>
          <van-cell>
            <template #title>
              <div class="setting-cell-head">
                <span>文章保留天数</span>
                <span class="font-size-value">{{ articleRetentionDays }} 天</span>
              </div>
            </template>
            <template #label>
              <div class="font-slider-wrap">
                <span class="font-slider-label">2</span>
                <input v-model="articleRetentionDays" class="font-range" type="range" min="2" max="30" step="1" />
                <span class="font-slider-label">30</span>
              </div>
            </template>
          </van-cell>
          <van-cell title="清理旧文章">
            <template #label>
              <span
                class="import-file-text"
                :class="{ 'import-file-text--disabled': cleaningArticles }"
                @click="manualCleanArticles"
              >{{ cleaningArticles ? '正在清理…' : '删除超期旧文章' }}</span>
            </template>
          </van-cell>
          <van-cell title="导出 OPML">
            <template #label>
              <span class="import-file-text" @click="downloadOpml">导出 OPML</span>
            </template>
          </van-cell>
          <van-cell title="导入 OPML">
            <template #label>
              <label class="import-file-text import-file-text--picker">
                <span>{{ importingOpml ? `正在导入 ${importProgress}/${importTotal}` : '选择 OPML 文件' }}</span>
                <input class="file-input file-input--overlay" type="file" accept=".opml,.OPML,.xml,.XML,text/xml,application/xml,text/x-opml,application/octet-stream" @change="importOpml" />
              </label>
            </template>
          </van-cell>
        </van-cell-group>
      </section>
    </div>
  </section>
</template>
