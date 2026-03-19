<script lang="ts">
let savedScrollY = 0
</script>

<script setup lang="ts">
import { nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useRouter, onBeforeRouteLeave } from 'vue-router'

import ArticleListItem from '@/components/ArticleListItem.vue'
import { formatRelativeDate } from '@/utils/date'
import { getArticleDisplayDate } from '@/utils/articleTime'
import { useArticleStore } from '@/stores/articles'

const articleStore = useArticleStore()
const router = useRouter()

async function openArticle(article: (typeof articleStore.items)[number]) {
  articleStore.setReadingList(articleStore.items.map((a) => a.id))
  await router.push({ name: 'article', params: { id: article.id } })
}

onBeforeRouteLeave((to) => {
  if (to.name === 'article') {
    savedScrollY = window.scrollY
    // 离开时移除滚动条隐藏（在导航到文章页前）
    document.documentElement.classList.remove('hide-scrollbar')
  } else {
    savedScrollY = 0
  }
})

onMounted(async () => {
  // 隐藏滚动条
  document.documentElement.classList.add('hide-scrollbar')
  
  await articleStore.loadFavorites()

  if (savedScrollY > 0) {
    const y = savedScrollY
    savedScrollY = 0
    await nextTick()
    requestAnimationFrame(() => {
      window.scrollTo({ top: y, behavior: 'instant' })
    })
  }
})

onBeforeUnmount(() => {
  // 恢复滚动条
  document.documentElement.classList.remove('hide-scrollbar')
})

async function markArticleRead(article: (typeof articleStore.items)[number]) {
  if (article.isRead) return
  await articleStore.setRead(article, true)
}
</script>

<template>
  <section class="page page--sticky-header page--hide-scrollbar">
    <header class="page-header page-header--sticky">
      <div>
        <p class="eyebrow">Library</p>
        <h1>收藏文章</h1>
      </div>
    </header>

    <!-- 加载中状态 -->
    <div v-if="articleStore.loading" class="loading-placeholder">
      <van-loading size="24px">加载中...</van-loading>
    </div>

    <div v-else-if="articleStore.items.length" class="article-list">
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

<style scoped>
.loading-placeholder {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 48px 16px;
}
</style>
