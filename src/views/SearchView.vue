<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import ArticleListItem from '@/components/ArticleListItem.vue'
import { formatRelativeDate } from '@/utils/date'
import { getArticleDisplayDate } from '@/utils/articleTime'
import { useArticleStore } from '@/stores/articles'

const articleStore = useArticleStore()
const router = useRouter()
const keyword = ref('')

async function openArticle(article: (typeof results.value)[number]) {
  await router.push({ name: 'article', params: { id: article.id } })
}

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

async function markArticleRead(article: (typeof results.value)[number]) {
  if (article.isRead) return
  await articleStore.setRead(article, true)
}
</script>

<template>
  <section class="page page--sticky-header">
    <header class="page-header page-header--sticky">
      <div>
        <p class="eyebrow">Search</p>
        <h1>本地搜索</h1>
      </div>
    </header>

    <van-search v-model="keyword" placeholder="搜索标题、摘要、正文" />

    <div v-if="results.length" class="article-list">
      <ArticleListItem
        v-for="article in results"
        :key="article.id"
        :article="article"
        :meta-primary="formatRelativeDate(getArticleDisplayDate(article))"
        :meta-tags="article.isFavorite ? ['已收藏'] : []"
        @open="openArticle"
        @markread="markArticleRead"
      />
    </div>

    <van-empty v-else description="没有匹配结果" />
  </section>
</template>
