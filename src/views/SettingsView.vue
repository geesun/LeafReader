<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { showToast } from 'vant'

import { DEFAULT_WORKER_BASE_URL } from '@/constants/settings'
import { exportSubscriptionsToOpml, parseOpml } from '@/services/opmlService'
import { useArticleStore } from '@/stores/articles'
import { useSettingsStore } from '@/stores/settings'
import { useSubscriptionStore } from '@/stores/subscriptions'

const articleStore = useArticleStore()
const settingsStore = useSettingsStore()
const subscriptionStore = useSubscriptionStore()

const workerBaseUrl = ref(settingsStore.settings.workerBaseUrl)
const fontSize = ref(settingsStore.settings.fontSize)

onMounted(async () => {
  await subscriptionStore.load()
})

const themeLabel = computed(() => {
  if (settingsStore.settings.theme === 'dark') return '深色'
  if (settingsStore.settings.theme === 'light') return '浅色'
  return '跟随系统'
})

function saveBaseUrl() {
  settingsStore.patchSettings({ workerBaseUrl: workerBaseUrl.value.trim() })
  showToast('Worker 地址已保存')
}

function saveFontSize(value: number) {
  fontSize.value = value
  settingsStore.patchSettings({ fontSize: value })
}

function downloadOpml() {
  const content = exportSubscriptionsToOpml(subscriptionStore.items)
  const blob = new Blob([content], { type: 'text/xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `leafreader-subscriptions-${new Date().toISOString().slice(0, 10)}.opml`
  link.click()
  URL.revokeObjectURL(url)
}

async function importOpml(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return

  const text = await file.text()
  const feeds = parseOpml(text)
  let count = 0

  for (const item of feeds) {
    try {
      if (!settingsStore.settings.workerBaseUrl) {
        showToast('请先配置 Worker 地址')
        break
      }
      await subscriptionStore.add(item.feedUrl, settingsStore.settings.workerBaseUrl)
      count += 1
    } catch {
      continue
    }
  }

  target.value = ''
  showToast(`导入完成，新增 ${count} 个订阅`)
}

async function clearOffline() {
  await articleStore.clearAllOffline()
  showToast('已清空离线内容')
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

    <van-cell-group inset title="网络服务">
      <van-field
        v-model="workerBaseUrl"
        label="Worker"
        type="url"
        :placeholder="DEFAULT_WORKER_BASE_URL"
        autocomplete="off"
      />
      <van-cell>
        <template #title>默认服务</template>
        <template #label>
          <span>如果你不修改，应用默认使用 `{{ DEFAULT_WORKER_BASE_URL }}`。</span>
        </template>
      </van-cell>
      <div class="cell-actions">
        <van-button block round type="primary" @click="saveBaseUrl">保存 Worker 地址</van-button>
      </div>
    </van-cell-group>

    <van-cell-group inset title="阅读体验">
      <van-cell title="主题模式" :value="themeLabel" is-link @click="settingsStore.patchSettings({ theme: settingsStore.settings.theme === 'system' ? 'light' : settingsStore.settings.theme === 'light' ? 'dark' : 'system' })" />
      <van-cell title="自动标记已读">
        <template #right-icon>
          <van-switch :model-value="settingsStore.settings.autoMarkRead" @update:model-value="settingsStore.patchSettings({ autoMarkRead: $event })" />
        </template>
      </van-cell>
      <van-cell title="全文偏好" :value="settingsStore.settings.readContentPreference" is-link @click="settingsStore.patchSettings({ readContentPreference: settingsStore.settings.readContentPreference === 'auto' ? 'fulltext' : settingsStore.settings.readContentPreference === 'fulltext' ? 'feed' : 'auto' })" />
      <van-cell title="字号">
        <template #label>
          <van-stepper :model-value="fontSize" integer min="14" max="22" @update:model-value="saveFontSize" />
        </template>
      </van-cell>
    </van-cell-group>

    <van-cell-group inset title="离线策略">
      <van-cell title="图片下载策略" :value="settingsStore.settings.offlineImagePolicy" is-link @click="settingsStore.patchSettings({ offlineImagePolicy: settingsStore.settings.offlineImagePolicy === 'manual' ? 'on_open' : settingsStore.settings.offlineImagePolicy === 'on_open' ? 'on_favorite' : 'manual' })" />
      <van-cell title="Android APK">
        <template #label>
          <span>项目已预留 Capacitor，执行 `npm install` 后可用 `npm run cap:android` 打开 Android 工程。</span>
        </template>
      </van-cell>
    </van-cell-group>

    <van-cell-group inset title="数据管理">
      <van-cell title="导出 OPML" is-link @click="downloadOpml" />
      <van-cell title="导入 OPML">
        <template #label>
          <input class="file-input" type="file" accept=".opml,.xml,text/xml" @change="importOpml" />
        </template>
      </van-cell>
      <van-cell title="清空离线文章" is-link @click="clearOffline" />
    </van-cell-group>
  </section>
</template>
