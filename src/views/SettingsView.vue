<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { showToast } from 'vant'

import { DEFAULT_WORKER_BASE_URL } from '@/constants/settings'
import { exportSubscriptionsToOpml, parseOpml } from '@/services/opmlService'
import { useSettingsStore } from '@/stores/settings'
import { useSubscriptionStore } from '@/stores/subscriptions'

const settingsStore = useSettingsStore()
const subscriptionStore = useSubscriptionStore()

const fontSize = ref(settingsStore.settings.fontSize)
const importingOpml = ref(false)
const importProgress = ref(0)
const importTotal = ref(0)

onMounted(async () => {
  await subscriptionStore.load()
})

watch(fontSize, (value) => {
  settingsStore.patchSettings({ fontSize: value })
})

const themeLabel = computed(() => {
  if (settingsStore.settings.theme === 'dark') return '深色'
  if (settingsStore.settings.theme === 'light') return '浅色'
  return '跟随系统'
})

async function downloadOpml() {
  if (!subscriptionStore.items.length) {
    showToast('当前没有可导出的订阅')
    return
  }

  const content = exportSubscriptionsToOpml(subscriptionStore.items)
  const fileName = `leafreader-subscriptions-${new Date().toISOString().slice(0, 10)}.opml`

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
  let count = 0

  for (const item of feeds) {
    try {
      await subscriptionStore.add(item.feedUrl, DEFAULT_WORKER_BASE_URL)
      count += 1
    } catch {
      // ignore duplicates or invalid feeds while keeping progress
    }

    importProgress.value += 1
  }

  await subscriptionStore.load()
  importingOpml.value = false
  target.value = ''
  showToast(count > 0 ? `导入完成，新增 ${count} 个订阅` : '导入完成，没有新增订阅')
}
</script>

<template>
  <section class="page">
    <header class="page-header">
      <div>
        <p class="eyebrow">Config</p>
        <h1>设置</h1>
      </div>
    </header>

    <van-cell-group inset title="阅读体验">
      <van-cell title="主题模式" :value="themeLabel" is-link @click="settingsStore.patchSettings({ theme: settingsStore.settings.theme === 'system' ? 'light' : settingsStore.settings.theme === 'light' ? 'dark' : 'system' })" />
      <van-cell title="字号">
        <template #right-icon>
          <span class="font-size-value" :style="{ fontSize: `${fontSize}px` }">{{ fontSize }}px</span>
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

    <van-cell-group inset title="数据管理">
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
</template>
