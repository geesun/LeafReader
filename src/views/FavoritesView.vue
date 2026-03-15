<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'

import ArticleListItem from '@/components/ArticleListItem.vue'
import { formatRelativeDate } from '@/utils/date'
import { getArticleDisplayDate } from '@/utils/articleTime'
import { useArticleStore } from '@/stores/articles'

const articleStore = useArticleStore()
const router = useRouter()

async function openArticle(article: (typeof articleStore.items)[number]) {
  await router.push({ name: 'article', params: { id: article.id } })
}

onMounted(async () => {
  await articleStore.loadFavorites()
})

async function markArticleRead(article: (typeof articleStore.items)[number]) {
  if (article.isRead) return
  await articleStore.setRead(article, true)
}
</script>

<template>
  <section class="page page--sticky-header">
    <header class="page-header page-header--sticky">
      <div>
        <p class="eyebrow">Library</p>
        <h1>收藏文章</h1>
      </div>
    </header>

    <div v-if="articleStore.items.length" class="article-list">
      <ArticleListItem
        v-for="article in articleStore.items"
        :key="article.id"
        :article="article"
        :meta-primary="formatRelativeDate(getArticleDisplayDate(article))"
        :meta-tags="['已收藏']"
        @open="openArticle"
        @markread="markArticleRead"
      />
    </div>

    <van-empty v-else description="还没有收藏文章" />
  </section>
</template>
