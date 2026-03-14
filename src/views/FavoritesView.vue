<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'

import { formatRelativeDate } from '@/utils/date'
import { getArticleDisplayDate } from '@/utils/articleTime'
import { limitText } from '@/utils/text'
import { useArticleStore } from '@/stores/articles'

const articleStore = useArticleStore()
const router = useRouter()

onMounted(async () => {
  await articleStore.loadFavorites()
})
</script>

<template>
  <section class="page">
    <header class="page-header">
      <div>
        <p class="eyebrow">Library</p>
        <h1>收藏文章</h1>
      </div>
    </header>

    <div v-if="articleStore.items.length" class="article-list">
      <button
        v-for="article in articleStore.items"
        :key="article.id"
        class="article-card"
        @click="router.push({ name: 'article', params: { id: article.id } })"
      >
        <div class="article-card__meta">
          <span>{{ formatRelativeDate(getArticleDisplayDate(article)) }}</span>
          <span>已收藏</span>
        </div>
        <h3>{{ article.title }}</h3>
        <p>{{ limitText(article.contentText || article.summary || '', 96) }}</p>
      </button>
    </div>

    <van-empty v-else description="还没有收藏文章" />
  </section>
</template>
