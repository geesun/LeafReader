<script lang="ts">
// Module-level variables — survive component unmount/remount
let savedScrollY = 0
let savedArticleCount = 0  // 记录离开时已加载的文章数量
let savedSubscriptionId = ''  // 记录离开时的订阅 ID
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

// 无限滚动相关
const listRef = ref<HTMLElement | null>(null)
const isLoadingMore = ref(false)
const isRestoringScroll = ref(false)  // 标记是否正在恢复滚动位置

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

// 是否可以加载更多
const canLoadMore = computed(() => {
  return articleStore.hasMore && !articleStore.loadingMore && !isLoadingMore.value
})

// 加载更多文章
async function loadMore() {
  if (!canLoadMore.value) return

  isLoadingMore.value = true
  try {
    await articleStore.loadMoreArticles(selectedSubscriptionId.value || undefined)
  } finally {
    isLoadingMore.value = false
  }
}

// 确保加载足够的文章以填充筛选列表
async function ensureEnoughArticles(subscriptionId?: string) {
  const minArticles = 10
  const maxIterations = 100  // 防止无限循环
  let iterations = 0
  
  while (filteredArticles.value.length < minArticles && articleStore.hasMore && iterations < maxIterations) {
    iterations++
    // 等待任何正在进行的加载完成
    while (articleStore.loadingMore) {
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    // 再次检查条件，因为状态可能已经改变
    if (filteredArticles.value.length >= minArticles || !articleStore.hasMore) break
    
    await articleStore.loadMoreArticles(subscriptionId || undefined)
  }
}

// 滚动到底部时自动加载更多
function handleScroll() {
  if (!canLoadMore.value || isRestoringScroll.value) return

  const scrollHeight = document.documentElement.scrollHeight
  const scrollTop = window.scrollY
  const clientHeight = window.innerHeight

  // 距离底部 300px 时开始加载（提前一点加载，体验更流畅）
  if (scrollHeight - scrollTop - clientHeight < 300) {
    loadMore()
  }
}

// 标记是否已完成首次初始化（由 onMounted 触发）
const isInitialized = ref(false)

watch(
  () => route.query.subscriptionId,
  async (subscriptionId, oldSubscriptionId) => {
    const newId = typeof subscriptionId === 'string' ? subscriptionId : ''
    
    // 更新选中的订阅 ID
    selectedSubscriptionId.value = newId
    
    // 首次触发时（oldSubscriptionId === undefined），由 onMounted 处理加载
    // 后续变化时，重新加载该订阅的文章
    if (oldSubscriptionId !== undefined && isInitialized.value) {
      await articleStore.loadFirstPage(newId || undefined)
    }
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

// 当过滤后的文章数量较少且还有更多数据时，自动加载更多
watch(
  [filteredArticles, () => articleStore.hasMore, () => articleStore.loading],
  async ([articles, hasMore, loading]) => {
    // 如果正在恢复滚动位置、正在初始加载、或正在加载更多，不触发
    if (isRestoringScroll.value || loading || isLoadingMore.value || articleStore.loadingMore) return
    // 必须已经初始化完成
    if (!isInitialized.value) return
    // 如果过滤后文章少于 10 篇且还有更多数据，自动加载
    if (articles.length < 10 && hasMore) {
      await ensureEnoughArticles(selectedSubscriptionId.value || undefined)
    }
  }
)

async function refreshAll() {
  if (subscriptionStore.sourceUpdateInProgress) {
    showToast('当前正在更新订阅源，请稍候')
    return
  }

  refreshing.value = true
  try {
    if (selectedSubscriptionId.value) {
      const inserted = await subscriptionStore.refreshOne(selectedSubscriptionId.value, DEFAULT_WORKER_BASE_URL)
      await articleStore.loadFirstPage(selectedSubscriptionId.value)
      showToast(`刷新完成，新增 ${inserted} 篇文章`)
      return
    }

    const summary = await subscriptionStore.refreshAll(DEFAULT_WORKER_BASE_URL)
    await articleStore.loadFirstPage()

    if (summary.failureCount > 0) {
      showToast(`刷新完成，新增 ${summary.inserted} 篇，失败 ${summary.failureCount} 个订阅`)
    } else {
      showToast(`刷新完成，新增 ${summary.inserted} 篇文章`)
    }
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
  const count = await articleStore.markAllFilteredRead(
    selectedSubscriptionId.value || undefined,
    filter.value
  )
  showToast(count > 0 ? `已将 ${count} 篇文章标记为已读` : '当前没有未读文章')
}

async function confirmMarkVisibleRead() {
  const scope = selectedSubscriptionId.value ? `当前订阅"${readingTitle.value}"` : '当前阅读流'

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

onBeforeRouteLeave((to) => {
  if (to.name === 'article') {
    savedScrollY = window.scrollY
    savedArticleCount = articleStore.items.length
    savedSubscriptionId = selectedSubscriptionId.value
  } else {
    savedScrollY = 0
    savedArticleCount = 0
    savedSubscriptionId = ''
  }
})

onMounted(async () => {
  const currentSubscriptionId = selectedSubscriptionId.value
  const needsScrollRestore = savedScrollY > 0 && savedSubscriptionId === currentSubscriptionId
  const targetScrollY = savedScrollY
  const targetArticleCount = savedArticleCount
  
  // 重置保存的值
  savedScrollY = 0
  savedArticleCount = 0
  savedSubscriptionId = ''

  // 如果需要恢复滚动位置，设置标记
  if (needsScrollRestore) {
    isRestoringScroll.value = true
  }

  // 检查是否已有数据且是同一个订阅的数据
  const hasExistingData = articleStore.items.length > 0

  // 并行加载订阅列表（如果还没有的话）
  const subscriptionLoadPromise = subscriptionStore.items.length === 0 
    ? subscriptionStore.load() 
    : Promise.resolve()

  if (needsScrollRestore && hasExistingData) {
    // 从文章页返回同一个订阅，已有数据，检查是否需要加载更多以恢复位置
    await subscriptionLoadPromise

    // 如果当前数据量小于离开时的数据量，需要继续加载
    while (articleStore.items.length < targetArticleCount && articleStore.hasMore) {
      await articleStore.loadMoreArticles(currentSubscriptionId || undefined)
    }

    // 恢复滚动位置
    await nextTick()
    requestAnimationFrame(() => {
      window.scrollTo({ top: targetScrollY, behavior: 'instant' })
      // 延迟取消恢复标记，避免触发自动加载
      setTimeout(() => {
        isRestoringScroll.value = false
      }, 100)
    })
  } else {
    // 首次加载、切换了订阅、或数据被清空，都需要重新加载第一页
    await Promise.all([
      articleStore.loadFirstPage(currentSubscriptionId || undefined),
      subscriptionLoadPromise
    ])
    isRestoringScroll.value = false
  }

  // 标记初始化完成，后续 watch 才会触发加载
  isInitialized.value = true

  // 初始化完成后，检查是否需要自动加载更多（比如筛选后文章不够）
  // 使用循环确保加载足够的文章
  await ensureEnoughArticles(currentSubscriptionId)

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

  // 添加滚动监听
  window.addEventListener('scroll', handleScroll, { passive: true })
  document.addEventListener('click', handleOutsideClick)
  document.addEventListener('touchstart', handleOutsideClick)
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', handleScroll)
  document.removeEventListener('click', handleOutsideClick)
  document.removeEventListener('touchstart', handleOutsideClick)
})
</script>

<template>
  <section
    class="page page--sticky-header page--hide-scrollbar"
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
      <div v-if="filteredArticles.length" ref="listRef" class="article-list">
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

        <!-- 加载更多指示器 -->
        <div v-if="articleStore.hasMore" class="load-more-indicator">
          <van-loading v-if="articleStore.loadingMore || isLoadingMore" size="24px">加载中...</van-loading>
          <span v-else class="load-more-hint" @click="loadMore">上拉加载更多</span>
        </div>

        <!-- 已加载全部 -->
        <div v-else class="load-more-indicator">
          <span class="load-more-done">已加载全部文章</span>
        </div>
      </div>

      <van-empty v-else-if="!articleStore.loading" description="当前筛选下没有文章" />
      
      <!-- 首次加载中 -->
      <div v-else class="loading-placeholder">
        <van-loading size="24px">加载中...</van-loading>
      </div>
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

<style scoped>
.load-more-indicator {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 16px;
  color: var(--color-text-secondary, #666);
  font-size: 14px;
}

.load-more-hint {
  cursor: pointer;
  color: var(--color-text-tertiary, #999);
}

.load-more-done {
  color: var(--color-text-tertiary, #999);
}

.loading-placeholder {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 48px 16px;
}
</style>
