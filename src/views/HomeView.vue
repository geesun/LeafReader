<script lang="ts">
// Module-level variable — survives component unmount/remount
let savedScrollY = 0
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import { showConfirmDialog, showToast } from 'vant'

import ArticleListItem from '@/components/ArticleListItem.vue'
import { DEFAULT_WORKER_BASE_URL } from '@/constants/settings'
import { formatRelativeDate } from '@/utils/date'
import { compareArticlesByRecency, getArticleDisplayDate } from '@/utils/articleTime'
import { useArticleStore } from '@/stores/articles'
import { useSubscriptionStore } from '@/stores/subscriptions'

const articleStore = useArticleStore()
const subscriptionStore = useSubscriptionStore()
const route = useRoute()
const router = useRouter()
const READING_FILTER_KEY = 'neoreader_reading_filter'

const refreshing = ref(false)
const keyword = ref('')
const filter = ref<'all' | 'unread' | 'favorites'>('all')
const selectedSubscriptionId = ref('')
const showSearchPopup = ref(false)
const showFilterPanel = ref(false)
const searchKeyword = ref('')
const titleTriggerRef = ref<HTMLElement | null>(null)
const filterPanelRef = ref<HTMLElement | null>(null)
const pressedArticleId = ref('')

const subscriptionsById = computed<Record<string, string>>(() => {
  return Object.fromEntries(subscriptionStore.items.map((item) => [item.id, item.title]))
})

const readingTitle = computed(() => {
  if (!selectedSubscriptionId.value) return '全部订阅'
  return subscriptionsById.value[selectedSubscriptionId.value] || '阅读流'
})

const filterLabel = computed(() => {
  if (filter.value === 'unread') return '未读'
  if (filter.value === 'favorites') return '收藏'
  return '全部'
})

const activeKeyword = computed(() => searchKeyword.value.trim().toLowerCase())

const filteredArticles = computed(() => {
  return articleStore.items
    .filter((article) => {
      const keywordMatched =
        !activeKeyword.value ||
        article.title.toLowerCase().includes(activeKeyword.value) ||
        (article.contentText ?? '').toLowerCase().includes(activeKeyword.value)

      const filterMatched =
        filter.value === 'all' ? true : filter.value === 'unread' ? !article.isRead : article.isFavorite

      const subscriptionMatched = selectedSubscriptionId.value ? article.subscriptionId === selectedSubscriptionId.value : true

      return keywordMatched && filterMatched && subscriptionMatched
    })
    .sort(compareArticlesByRecency)
})

watch(
  () => route.query.subscriptionId,
  (subscriptionId) => {
    selectedSubscriptionId.value = typeof subscriptionId === 'string' ? subscriptionId : ''
  },
  { immediate: true }
)

watch(
  () => route.query.filter,
  (value) => {
    if (value === 'unread' || value === 'favorites' || value === 'all') {
      filter.value = value
      return
    }

    const savedFilter = localStorage.getItem(READING_FILTER_KEY)
    if (savedFilter === 'unread' || savedFilter === 'favorites' || savedFilter === 'all') {
      filter.value = savedFilter
      return
    }

    filter.value = 'all'
  },
  { immediate: true }
)

watch(filter, (value) => {
  localStorage.setItem(READING_FILTER_KEY, value)
})

async function refreshAll() {
  if (subscriptionStore.sourceUpdateInProgress) {
    showToast('当前正在更新订阅源，请稍候')
    return
  }

  refreshing.value = true
  try {
    if (selectedSubscriptionId.value) {
      const inserted = await subscriptionStore.refreshOne(selectedSubscriptionId.value, DEFAULT_WORKER_BASE_URL)
      await articleStore.loadAll()
      showToast(`刷新完成，新增 ${inserted} 篇文章`)
      return
    }

    const summary = await subscriptionStore.refreshAll(DEFAULT_WORKER_BASE_URL)
    await articleStore.loadAll()

    if (summary.failureCount > 0) {
      showToast(`刷新完成，新增 ${summary.inserted} 篇，失败 ${summary.failureCount} 个订阅`)
      return
    }

    showToast(`刷新完成，新增 ${summary.inserted} 篇文章`)
  } catch (error) {
    showToast(error instanceof Error ? error.message : '刷新失败')
  } finally {
    refreshing.value = false
  }
}

async function openArticle(article: (typeof filteredArticles.value)[number]) {
  if (showFilterPanel.value) return

  pressedArticleId.value = article.id
  try {
    await new Promise((resolve) => window.setTimeout(resolve, 110))

    articleStore.setReadingList(filteredArticles.value.map((a) => a.id))

    if (!article.isRead) {
      await articleStore.setRead(article, true)
    }

    await router.push({ name: 'article', params: { id: article.id } })
  } finally {
    pressedArticleId.value = ''
  }
}

async function clearSubscriptionFilter() {
  await router.replace({
    name: 'reading',
    query: {
      ...(filter.value !== 'all' ? { filter: filter.value } : {})
    }
  })
}

async function markArticleReadFromList(article: (typeof filteredArticles.value)[number]) {
  if (article.isRead) return
  await articleStore.setRead(article, true)
}

async function setFilter(next: 'all' | 'unread' | 'favorites') {
  filter.value = next

  await router.replace({
    name: 'reading',
    query: {
      ...(selectedSubscriptionId.value ? { subscriptionId: selectedSubscriptionId.value } : {}),
      ...(next !== 'all' ? { filter: next } : {})
    }
  })
}

async function updateSubscriptionFilter(next: string) {
  selectedSubscriptionId.value = next

  await router.replace({
    name: 'reading',
    query: {
      ...(next ? { subscriptionId: next } : {}),
      ...(filter.value !== 'all' ? { filter: filter.value } : {})
    }
  })
}

function openSearch() {
  keyword.value = searchKeyword.value
  showSearchPopup.value = true
}

function applySearch() {
  keyword.value = searchKeyword.value
  showSearchPopup.value = false
}

async function markVisibleRead() {
  const ids = filteredArticles.value.filter((article) => !article.isRead).map((article) => article.id)
  await articleStore.markArticlesRead(ids)
  showToast(ids.length ? '当前列表已标记为已读' : '当前没有未读文章')
}

async function confirmMarkVisibleRead() {
  const scope = selectedSubscriptionId.value ? `当前订阅“${readingTitle.value}”` : '当前阅读流'

  try {
    await showConfirmDialog({
      title: '标记为已读',
      message: `确认将${scope}中的文章标记为全部已读吗？`
    })
    await markVisibleRead()
  } catch {
    return
  }
}

function toggleFilterPanel() {
  showFilterPanel.value = !showFilterPanel.value
}

function clearPressedArticle() {
  pressedArticleId.value = ''
}

function handlePageTapCapture(event: MouseEvent | TouchEvent) {
  if (!showFilterPanel.value) return

  const target = event.target as Node | null
  if (!target) return
  if (titleTriggerRef.value?.contains(target)) return
  if (filterPanelRef.value?.contains(target)) return

  event.stopPropagation()
  if ('preventDefault' in event) {
    event.preventDefault()
  }
  showFilterPanel.value = false
}

function handleOutsideClick(event: MouseEvent | TouchEvent) {
  const target = event.target as Node | null
  if (!target) return
  if (titleTriggerRef.value?.contains(target)) return
  if (filterPanelRef.value?.contains(target)) return
  showFilterPanel.value = false
}

onBeforeRouteLeave(() => {
  savedScrollY = window.scrollY
})

onMounted(async () => {
  await Promise.all([articleStore.loadAll(), subscriptionStore.load()])

  if (savedScrollY > 0) {
    // Returning from article view — restore previous scroll position.
    // Wait for the list to fully render before scrolling.
    const y = savedScrollY
    savedScrollY = 0
    await nextTick()
    requestAnimationFrame(() => {
      window.scrollTo({ top: y, behavior: 'instant' })
    })
  }

  if (!route.query.filter) {
    const savedFilter = localStorage.getItem(READING_FILTER_KEY)
    if (savedFilter === 'unread' || savedFilter === 'favorites') {
      await router.replace({
        name: 'reading',
        query: {
          ...(typeof route.query.subscriptionId === 'string' ? { subscriptionId: route.query.subscriptionId } : {}),
          filter: savedFilter
        }
      })
    }
  }

  document.addEventListener('click', handleOutsideClick)
  document.addEventListener('touchstart', handleOutsideClick)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', handleOutsideClick)
  document.removeEventListener('touchstart', handleOutsideClick)
})
</script>

<template>
  <section
    class="page page--sticky-header"
    :class="{ 'page--sticky-header-expanded': $route.name === 'reading' && showFilterPanel }"
    @click.capture="handlePageTapCapture"
    @touchstart.capture="handlePageTapCapture"
  >
    <header class="page-header page-header--aligned page-header--sticky page-header--stacked page-header--sticky-tall">
      <div class="page-header__mainline">
        <van-button class="page-header__icon" round plain icon="search" @click="openSearch" />
        <button ref="titleTriggerRef" class="page-header__center page-header__center-btn" @click="toggleFilterPanel">
          <div class="page-header__title-stack">
            <h1>{{ readingTitle }}</h1>
            <p class="reading-status reading-status--title">{{ filterLabel }}</p>
          </div>
        </button>
        <van-button class="page-header__icon" round plain icon="checked" @click="confirmMarkVisibleRead" />
      </div>

      <template v-if="$route.name === 'reading' && showFilterPanel">
        <div ref="filterPanelRef" class="reading-panel reading-panel--header">
          <div class="reading-filters">
            <button class="reading-chip" :class="{ 'reading-chip--active': filter === 'all' }" @click="setFilter('all')">全部</button>
            <button class="reading-chip" :class="{ 'reading-chip--active': filter === 'unread' }" @click="setFilter('unread')">未读</button>
            <button class="reading-chip" :class="{ 'reading-chip--active': filter === 'favorites' }" @click="setFilter('favorites')">收藏</button>
          </div>

          <div class="subscription-select-wrap">
            <select :value="selectedSubscriptionId" class="subscription-select" @change="updateSubscriptionFilter(($event.target as HTMLSelectElement).value)">
              <option value="">全部订阅</option>
              <option v-for="item in subscriptionStore.items" :key="item.id" :value="item.id">{{ item.title }}</option>
            </select>
          </div>
        </div>
      </template>
    </header>

    <van-pull-refresh v-model="refreshing" :pull-distance="150" @refresh="refreshAll">
      <div v-if="filteredArticles.length" class="article-list">
        <ArticleListItem
          v-for="article in filteredArticles"
          :key="article.id"
          :article="article"
          :pressed="pressedArticleId === article.id"
          :meta-primary="subscriptionsById[article.subscriptionId] || '未知订阅'"
          :meta-secondary="formatRelativeDate(getArticleDisplayDate(article))"
          :meta-tags="[...(article.isFavorite ? ['已收藏'] : []), ...(article.hasFullContent ? ['全文'] : [])]"
          @pressstart="pressedArticleId = $event"
          @pressend="clearPressedArticle"
          @open="openArticle"
          @markread="markArticleReadFromList"
        />
      </div>

      <van-empty v-else description="当前筛选下没有文章" />
    </van-pull-refresh>

    <van-popup v-model:show="showSearchPopup" round position="top" class="search-popup">
      <section class="search-popup__content">
        <div class="sheet-popup__header">
          <div>
            <p class="eyebrow">Search</p>
            <h2>查找文章</h2>
          </div>
          <van-button plain round size="small" @click="showSearchPopup = false">取消</van-button>
        </div>
        <van-search v-model="searchKeyword" placeholder="搜索标题或正文" show-action @search="applySearch">
          <template #action>
            <span @click="applySearch">搜索</span>
          </template>
        </van-search>
      </section>
    </van-popup>
  </section>
</template>
