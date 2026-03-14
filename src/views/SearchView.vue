<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { formatRelativeDate } from '@/utils/date'
import { getArticleDisplayDate } from '@/utils/articleTime'
import { limitText } from '@/utils/text'
import { useArticleStore } from '@/stores/articles'

const articleStore = useArticleStore()
const router = useRouter()
const keyword = ref('')

const results = computed(() => {
  const normalized = keyword.value.trim().toLowerCase()
  if (!normalized) return articleStore.items

  return articleStore.items.filter((article) => {
    return (
      article.title.toLowerCase().includes(normalized) ||
      (article.contentText ?? '').toLowerCase().includes(normalized) ||
      (article.summary ?? '').toLowerCase().includes(normalized)
    )
  })
})

onMounted(async () => {
  await articleStore.loadAll()
})
</script>

<template>
  <section class="page">
    <header class="page-header">
      <div>
        <p class="eyebrow">Search</p>
        <h1>本地搜索</h1>
      </div>
    </header>

    <van-search v-model="keyword" placeholder="搜索标题、摘要、正文" />

    <div v-if="results.length" class="article-list">
      <button
        v-for="article in results"
        :key="article.id"
        class="article-card"
        @click="router.push({ name: 'article', params: { id: article.id } })"
      >
        <div class="article-card__meta">
          <span>{{ formatRelativeDate(getArticleDisplayDate(article)) }}</span>
          <span v-if="article.isFavorite">已收藏</span>
        </div>
        <h3>{{ article.title }}</h3>
        <p>{{ limitText(article.contentText || article.summary || '', 96) }}</p>
      </button>
    </div>

    <van-empty v-else description="没有匹配结果" />
  </section>
</template>
