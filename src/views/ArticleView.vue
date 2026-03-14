<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { DEFAULT_WORKER_BASE_URL } from '@/constants/settings'
import { sanitizeHtml } from '@/services/articleService'
import { formatRelativeDate } from '@/utils/date'
import { useArticleStore } from '@/stores/articles'

const route = useRoute()
const router = useRouter()
const articleStore = useArticleStore()
const loading = ref(true)

const article = computed(() => articleStore.current)
const articleHtml = computed(() => {
  const current = article.value
  if (!current) return ''

  const preferredContent = current.fullContentHtml || current.feedContentHtml

  return sanitizeHtml(current.offlineContentHtml || preferredContent || current.summary || '')
})

async function toggleRead() {
  if (!article.value) return
  await articleStore.setRead(article.value, !article.value.isRead)
}

async function toggleFavorite() {
  if (!article.value) return
  await articleStore.toggleFavorite(article.value)
}

onMounted(async () => {
  const current = await articleStore.openArticle(route.params.id as string)

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
})
</script>

<template>
  <section class="page page--article">
    <van-nav-bar left-arrow title="文章" @click-left="router.back()" />

    <template v-if="article">
      <header class="article-header">
        <p class="eyebrow">{{ formatRelativeDate(article.publishedAt || article.createdAt) }}</p>
        <h1>{{ article.title }}</h1>
        <p class="article-subline">
          <span>{{ article.author || '未知作者' }}</span>
        </p>

        <div class="toolbar toolbar--header-right">
          <van-button size="small" round plain @click="toggleRead">{{ article.isRead ? '标未读' : '标已读' }}</van-button>
          <van-button size="small" round plain @click="toggleFavorite">{{ article.isFavorite ? '取消收藏' : '收藏' }}</van-button>
        </div>
      </header>

      <article class="reader-surface prose" v-html="articleHtml" />

      <div class="page-footer-actions">
        <a class="article-link-button" :href="article.link" target="_blank" rel="noopener noreferrer">打开原文</a>
      </div>
    </template>

    <van-skeleton v-else-if="loading" title :row="8" />
    <van-empty v-else description="文章不存在或已删除" />
  </section>
</template>
