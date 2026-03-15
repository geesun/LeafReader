<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showToast } from 'vant'

import { DEFAULT_WORKER_BASE_URL } from '@/constants/settings'
import { sanitizeHtml } from '@/services/articleService'
import { proxyImagesForOnlineReading } from '@/services/offlineService'
import { formatRelativeDate } from '@/utils/date'
import { getArticleDisplayDate } from '@/utils/articleTime'
import { useArticleStore } from '@/stores/articles'
import { useSettingsStore } from '@/stores/settings'

const route = useRoute()
const router = useRouter()
const articleStore = useArticleStore()
const settingsStore = useSettingsStore()
const loading = ref(true)
const summaryLoading = ref(false)

const article = computed(() => articleStore.current)
const hasSummary = computed(() => Boolean(article.value?.aiSummaryText))
const articleHtml = computed(() => {
  const current = article.value
  if (!current) return ''

  // Offline content already has local asset paths — render as-is
  if (current.offlineContentHtml) {
    return sanitizeHtml(current.offlineContentHtml)
  }

  const preferredContent = current.fullContentHtml || current.feedContentHtml || current.summary || ''
  const sanitized = sanitizeHtml(preferredContent)

  // Rewrite image URLs through the Worker asset proxy so non-standard-port
  // and hotlink-protected images load correctly in the browser
  return proxyImagesForOnlineReading(sanitized, current.link, DEFAULT_WORKER_BASE_URL)
})

async function toggleRead() {
  if (!article.value) return
  await articleStore.setRead(article.value, !article.value.isRead)
}

async function toggleFavorite() {
  if (!article.value) return
  await articleStore.toggleFavorite(article.value)
}

async function generateSummary(forceRefresh = false) {
  if (!article.value || summaryLoading.value) return

  summaryLoading.value = true
  try {
    await articleStore.generateSummary(
      article.value,
      DEFAULT_WORKER_BASE_URL,
      forceRefresh,
      settingsStore.settings.summaryLength,
      settingsStore.settings.summaryProvider
    )
    showToast(forceRefresh ? '摘要已更新' : '摘要生成完成')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '摘要生成失败')
  } finally {
    summaryLoading.value = false
  }
}

function scrollToTop() {
  window.scrollTo(0, 0)
  document.documentElement.scrollTop = 0
  document.body.scrollTop = 0
}

async function loadArticle(id: string) {
  scrollToTop()

  const current = await articleStore.openArticle(id)

  if (current && !current.isRead) {
    await articleStore.setRead(current, true)
  }

  if (current && !current.isOfflineSaved) {
    try {
      await articleStore.saveOffline(current, DEFAULT_WORKER_BASE_URL)
    } catch {
    }
  }

  loading.value = false
  await nextTick()
  scrollToTop()
}

watch(
  () => route.params.id,
  async (id) => {
    if (typeof id !== 'string' || !id) return
    loading.value = true
    await loadArticle(id)
  },
  { immediate: true }
)
</script>

<template>
  <section class="page page--article">
    <button class="article-back-btn" @click="router.back()">
      <van-icon name="arrow-left" />
    </button>

    <template v-if="article">
      <header class="article-header">
        <h1>{{ article.title }}</h1>
        <div class="article-subline article-subline--actions">
          <span>{{ article.author || '未知作者' }}</span>
          <span class="article-subline__sep">·</span>
          <span>{{ formatRelativeDate(getArticleDisplayDate(article)) }}</span>

          <div class="toolbar toolbar--header-inline">
            <van-button size="small" round plain :loading="summaryLoading" @click="generateSummary(false)">
              {{ hasSummary ? '查看摘要' : 'AI 摘要' }}
            </van-button>
            <van-button size="small" round plain @click="toggleRead">{{ article.isRead ? '标未读' : '标已读' }}</van-button>
            <van-button size="small" round plain @click="toggleFavorite">{{ article.isFavorite ? '取消收藏' : '收藏' }}</van-button>
          </div>
        </div>
      </header>

      <section v-if="article.aiSummaryText" class="reader-surface ai-summary-card">
        <div class="ai-summary-card__head">
          <div>
            <p class="eyebrow">AI Summary</p>
            <h2>AI 摘要</h2>
          </div>
          <van-button size="small" round plain :loading="summaryLoading" @click="generateSummary(true)">刷新摘要</van-button>
        </div>
        <div class="ai-summary-card__text">{{ article.aiSummaryText }}</div>
        <p class="ai-summary-card__meta">
          <span>模型 {{ article.aiSummaryModel || 'gemini-1.5-flash' }}</span>
          <span class="article-subline__sep">·</span>
          <span>{{ article.aiSummaryGeneratedAt ? formatRelativeDate(article.aiSummaryGeneratedAt) : '刚刚生成' }}</span>
        </p>
      </section>

      <article class="reader-surface prose" v-html="articleHtml" />

      <div class="page-footer-actions">
        <a class="article-link-button" :href="article.link" target="_blank" rel="noopener noreferrer">打开原文</a>
      </div>
    </template>

    <van-skeleton v-else-if="loading" title :row="8" />
    <van-empty v-else description="文章不存在或已删除" />
  </section>
</template>
