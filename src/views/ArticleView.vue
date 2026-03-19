<script setup lang="ts">
import { Clipboard } from '@capacitor/clipboard'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
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
const translationLoading = ref(false)
const summaryVisible = ref(false)
const translationVisible = ref(false)
const headerRef = ref<HTMLElement | null>(null)

// dynamically track header height so content is never covered
let headerResizeObserver: ResizeObserver | null = null

function updateHeaderOffset() {
  const h = headerRef.value?.offsetHeight
  if (h) {
    document.documentElement.style.setProperty('--article-header-height', `${h}px`)
  }
}

onMounted(() => {
  // 确保滚动条可见（文章页面需要显示滚动条）
  document.documentElement.classList.remove('hide-scrollbar')
  
  headerResizeObserver = new ResizeObserver(updateHeaderOffset)
  if (headerRef.value) headerResizeObserver.observe(headerRef.value)
})

onBeforeUnmount(() => {
  headerResizeObserver?.disconnect()
  document.documentElement.style.removeProperty('--article-header-height')
})

// swipe to navigate between articles in the reading list
let swipeTouchStartX = 0
let swipeTouchStartY = 0
let swipeAxisLocked = false

const currentIndex = computed(() => {
  const id = article.value?.id
  if (!id || !articleStore.readingList.length) return -1
  return articleStore.readingList.indexOf(id)
})

const prevId = computed(() =>
  currentIndex.value > 0 ? articleStore.readingList[currentIndex.value - 1] : null
)

const nextId = computed(() =>
  currentIndex.value >= 0 && currentIndex.value < articleStore.readingList.length - 1
    ? articleStore.readingList[currentIndex.value + 1]
    : null
)

function onSwipeTouchStart(e: TouchEvent) {
  swipeTouchStartX = e.touches[0]?.clientX ?? 0
  swipeTouchStartY = e.touches[0]?.clientY ?? 0
  swipeAxisLocked = false
}

function onSwipeTouchEnd(e: TouchEvent) {
  const endX = e.changedTouches[0]?.clientX ?? swipeTouchStartX
  const endY = e.changedTouches[0]?.clientY ?? swipeTouchStartY
  const dx = endX - swipeTouchStartX
  const dy = endY - swipeTouchStartY

  // ignore if primarily vertical scroll
  if (Math.abs(dy) > Math.abs(dx)) return
  // require at least 60px horizontal swipe
  if (Math.abs(dx) < 60) return

  // Ignore swipes that start near the left or right screen edge (≤ 30 px).
  // Those are reserved for the OS/browser back-gesture and must not be
  // intercepted — otherwise the back swipe would also navigate to the
  // previous article before the router pops back to the list.
  const edgeThreshold = 30
  const screenWidth = window.innerWidth
  if (swipeTouchStartX <= edgeThreshold || swipeTouchStartX >= screenWidth - edgeThreshold) return

  if (dx < 0 && nextId.value) {
    // swipe left → next article
    router.replace({ name: 'article', params: { id: nextId.value } })
  } else if (dx > 0 && prevId.value) {
    // swipe right → previous article
    router.replace({ name: 'article', params: { id: prevId.value } })
  }
}

const article = computed(() => articleStore.current)
const hasSummary = computed(() => Boolean(article.value?.aiSummaryText))
const hasTranslation = computed(() => Boolean(article.value?.aiTranslationFormat === 'paragraph-v1' && article.value?.aiTranslationBlocks?.length))
const showTranslateButton = computed(() => (article.value ? articleStore.canTranslate(article.value) : false))
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

  if (!forceRefresh && hasSummary.value) {
    summaryVisible.value = !summaryVisible.value
    return
  }

  summaryLoading.value = true
  try {
    await articleStore.generateSummary(
      article.value,
      DEFAULT_WORKER_BASE_URL,
      forceRefresh,
      settingsStore.settings.summaryLength,
      settingsStore.settings.summaryProvider
    )
    summaryVisible.value = true
    showToast(forceRefresh ? '摘要已更新' : '摘要生成完成')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '摘要生成失败')
  } finally {
    summaryLoading.value = false
  }
}

async function generateTranslation(forceRefresh = false) {
  if (!article.value || translationLoading.value || !showTranslateButton.value) return

  if (!forceRefresh && hasTranslation.value) {
    translationVisible.value = !translationVisible.value
    return
  }

  translationLoading.value = true
  try {
    await articleStore.generateTranslation(
      article.value,
      DEFAULT_WORKER_BASE_URL,
      forceRefresh,
      settingsStore.settings.summaryProvider
    )
    translationVisible.value = true
    showToast(forceRefresh ? '翻译已更新' : '双语翻译已生成')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '翻译生成失败')
  } finally {
    translationLoading.value = false
  }
}

async function copyArticleUrl() {
  const link = article.value?.link?.trim()
  if (!link) {
    showToast('未找到文章地址')
    return
  }

  try {
    await Clipboard.write({ string: link })
    showToast('文章地址已复制')
    return
  } catch (error) {
    console.error('Clipboard.write failed', error)
  }

  try {
    if (!navigator.clipboard?.writeText) {
      throw new Error('clipboard unavailable')
    }

    await navigator.clipboard.writeText(link)
    showToast('文章地址已复制')
  } catch (error) {
    console.error('navigator.clipboard.writeText failed', error)
    const message = error instanceof Error ? error.message : '复制失败'
    showToast(message)
  }
}

function scrollToTop() {
  window.scrollTo(0, 0)
  document.documentElement.scrollTop = 0
  document.body.scrollTop = 0
}

async function loadArticle(id: string) {
  scrollToTop()
  summaryVisible.value = false
  translationVisible.value = false

  const current = await articleStore.openArticle(id)

  if (current && !current.isRead) {
    await articleStore.setRead(current, true)
  }

  loading.value = false
  await nextTick()
  scrollToTop()

  // Run offline save after the article is already visible and scroll is reset,
  // so it never triggers a mid-read scroll jump
  // Use articleStore.current (updated by setRead above) instead of the stale
  // local `current` snapshot, to avoid overwriting isRead when saving offline.
  const latest = articleStore.current
  if (latest && !latest.isOfflineSaved) {
    articleStore.saveOffline(latest, DEFAULT_WORKER_BASE_URL).catch(() => {})
  }
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
  <section
    class="page page--article page--sticky-header"
    @touchstart.passive="onSwipeTouchStart"
    @touchend.passive="onSwipeTouchEnd"
  >
    <template v-if="article">
      <header ref="headerRef" class="page-header page-header--sticky page-header--stacked page-header--sticky-tall article-page-header">
        <div class="page-header__mainline article-page-header__mainline">
          <van-button class="page-header__icon" round plain icon="arrow-left" @click="router.back()" />
          <div class="page-header__center article-page-header__title-wrap">
            <h1>{{ article.title }}</h1>
          </div>
        </div>
        <div class="article-page-header__subline">
          <div class="article-subline article-subline--header-meta">
            <span>{{ formatRelativeDate(getArticleDisplayDate(article)) }}</span>
          </div>
          <div class="toolbar toolbar--header-inline article-page-header__actions">
            <van-button size="small" round plain @click="toggleRead">{{ article.isRead ? '标未读' : '标已读' }}</van-button>
            <van-button size="small" round plain :loading="summaryLoading" @click="generateSummary(false)">
              {{ hasSummary ? (summaryVisible ? '隐藏摘要' : '显示摘要') : 'AI 摘要' }}
            </van-button>
            <van-button
              v-if="showTranslateButton"
              size="small"
              round
              plain
              :loading="translationLoading"
              @click="generateTranslation(false)"
            >
              {{ hasTranslation ? (translationVisible ? '隐藏对照' : '显示对照') : '中英对照' }}
            </van-button>
            <van-button size="small" round plain @click="toggleFavorite">{{ article.isFavorite ? '取消收藏' : '收藏' }}</van-button>
          </div>
        </div>
      </header>

      <section v-if="article.aiSummaryText && summaryVisible" class="reader-surface ai-summary-card">
        <div class="ai-summary-card__head">
          <div>
            <p class="eyebrow">AI Summary</p>
            <h2>AI 摘要</h2>
          </div>
          <van-button size="small" round plain @click="summaryVisible = false">收起</van-button>
        </div>
        <div class="ai-summary-card__text">{{ article.aiSummaryText }}</div>
        <p class="ai-summary-card__meta">
          <span>模型 {{ article.aiSummaryModel || 'gemini-1.5-flash' }}</span>
          <span class="article-subline__sep">·</span>
          <span>{{ article.aiSummaryGeneratedAt ? formatRelativeDate(article.aiSummaryGeneratedAt) : '刚刚生成' }}</span>
        </p>
      </section>

      <section v-if="article.aiTranslationBlocks?.length && translationVisible" class="reader-surface ai-translation-card">
        <div class="ai-summary-card__head">
          <div>
            <p class="eyebrow">AI Translation</p>
            <h2>中英对照</h2>
          </div>
          <van-button size="small" round plain @click="translationVisible = false">收起</van-button>
        </div>
        <div class="bilingual-blocks">
          <div v-for="(block, index) in article.aiTranslationBlocks" :key="`${article.id}-${index}`" class="bilingual-block">
            <div class="bilingual-block__pair">
              <p class="bilingual-block__source">{{ block.sourceText }}</p>
              <p class="bilingual-block__translation">{{ block.translatedText }}</p>
            </div>
          </div>
        </div>
        <p class="ai-summary-card__meta">
          <span>模型 {{ article.aiTranslationModel || article.aiSummaryModel || 'gemini-flash-latest' }}</span>
          <span class="article-subline__sep">·</span>
          <span>{{ article.aiTranslationGeneratedAt ? formatRelativeDate(article.aiTranslationGeneratedAt) : '刚刚生成' }}</span>
        </p>
      </section>

      <article class="reader-surface prose" v-html="articleHtml" />

      <div class="page-footer-actions article-page-footer-actions">
        <van-button class="article-link-button" round plain block @click="copyArticleUrl">复制地址</van-button>
        <van-button
          class="article-link-button"
          round
          plain
          block
          tag="a"
          :href="article.link"
          target="_blank"
          rel="noopener noreferrer"
        >
          打开原文
        </van-button>
      </div>
    </template>

    <van-skeleton v-else-if="loading" title :row="8" />
    <van-empty v-else description="文章不存在或已删除" />
  </section>
</template>
