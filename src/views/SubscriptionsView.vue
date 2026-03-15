<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { showConfirmDialog, showToast } from 'vant'

import { DEFAULT_WORKER_BASE_URL } from '@/constants/settings'
import { getArticleSortTimestamp } from '@/utils/articleTime'
import { useArticleStore } from '@/stores/articles'
import { useSubscriptionStore } from '@/stores/subscriptions'
import { useUiStore } from '@/stores/ui'

const LONG_PRESS_MS = 420

const articleStore = useArticleStore()
const subscriptionStore = useSubscriptionStore()
const uiStore = useUiStore()
const router = useRouter()
const READING_FILTER_KEY = 'neoreader_reading_filter'

const feedUrl = ref('')
const feedUrlPlaceholder = ref('https://example.com/feed.xml')
const submitting = ref(false)
const showAddPopup = ref(false)
const selectedIds = ref<string[]>([])
const refreshing = ref(false)
const refreshCompleted = ref(0)
const refreshTotal = ref(0)
const refreshCurrentTitle = ref('')
const movedDuringPress = ref(false)
const pressedSubscriptionId = ref('')

let pressTimer: number | undefined
let activePressId: string | undefined
let longPressHandled = false

const articleCounts = computed(() => {
  const totalMap: Record<string, number> = {}
  const unreadMap: Record<string, number> = {}

  for (const article of articleStore.items) {
    totalMap[article.subscriptionId] = (totalMap[article.subscriptionId] ?? 0) + 1
    if (!article.isRead) {
      unreadMap[article.subscriptionId] = (unreadMap[article.subscriptionId] ?? 0) + 1
    }
  }

  return { totalMap, unreadMap }
})

const sortedSubscriptions = computed(() => {
  return [...subscriptionStore.items].sort((a, b) => {
    const aLatest = Math.max(
      0,
      ...articleStore.items.filter((article) => article.subscriptionId === a.id).map(getArticleSortTimestamp)
    )

    const bLatest = Math.max(
      0,
      ...articleStore.items.filter((article) => article.subscriptionId === b.id).map(getArticleSortTimestamp)
    )

    return bLatest - aLatest
  })
})

const hasSelection = computed(() => selectedIds.value.length > 0)
const allSelected = computed(() => selectedIds.value.length > 0 && selectedIds.value.length === sortedSubscriptions.value.length)
const refreshMessage = computed(() => {
  if (!refreshing.value || !refreshTotal.value) return ''
  return `正在刷新 ${refreshCompleted.value}/${refreshTotal.value}：${refreshCurrentTitle.value}`
})

watch(hasSelection, (value) => {
  uiStore.setTabbarHidden(value)
})

function openAddPopup() {
  feedUrl.value = ''
  showAddPopup.value = true
}

function closeAddPopup() {
  showAddPopup.value = false
  feedUrl.value = ''
}

function getSubscriptionInitial(title: string): string {
  const clean = title.trim()
  return clean.slice(0, 1).toUpperCase() || 'R'
}

function getFaviconUrl(feedUrl: string, siteUrl?: string): string {
  try {
    const target = new URL(siteUrl || feedUrl)
    return `${target.origin}/favicon.ico`
  } catch {
    return ''
  }
}

function clearPressTimer() {
  if (pressTimer !== undefined) {
    window.clearTimeout(pressTimer)
    pressTimer = undefined
  }
  activePressId = undefined
}

function setPressedSubscription(subscriptionId: string) {
  pressedSubscriptionId.value = subscriptionId
}

function clearPressedSubscription() {
  pressedSubscriptionId.value = ''
}

function waitForTapFeedback() {
  return new Promise((resolve) => window.setTimeout(resolve, 110))
}

function toggleSelection(subscriptionId: string) {
  if (selectedIds.value.includes(subscriptionId)) {
    selectedIds.value = selectedIds.value.filter((item) => item !== subscriptionId)
    return
  }

  selectedIds.value = [...selectedIds.value, subscriptionId]
}

function startPress(subscriptionId: string) {
  clearPressTimer()
  activePressId = subscriptionId
  longPressHandled = false
  movedDuringPress.value = false

  pressTimer = window.setTimeout(() => {
    if (movedDuringPress.value) return
    toggleSelection(subscriptionId)
    longPressHandled = true
  }, LONG_PRESS_MS)
}

function markMoved() {
  movedDuringPress.value = true
  clearPressedSubscription()
  finishPress()
}

function finishPress() {
  if (pressTimer !== undefined) {
    window.clearTimeout(pressTimer)
    pressTimer = undefined
  }
  activePressId = undefined
}

async function handleCardClick(subscriptionId: string) {
  if (movedDuringPress.value) {
    movedDuringPress.value = false
    activePressId = undefined
    return
  }

  if (longPressHandled && activePressId === subscriptionId) {
    longPressHandled = false
    activePressId = undefined
    return
  }

  if (hasSelection.value) {
    toggleSelection(subscriptionId)
    activePressId = undefined
    clearPressedSubscription()
    return
  }

  activePressId = undefined
  setPressedSubscription(subscriptionId)
  try {
    await waitForTapFeedback()
    const savedFilter = localStorage.getItem(READING_FILTER_KEY)
    await router.push({
      name: 'reading',
      query: {
        subscriptionId,
        ...((savedFilter === 'unread' || savedFilter === 'favorites') ? { filter: savedFilter } : {})
      }
    })
  } finally {
    clearPressedSubscription()
  }
}

function cancelSelection() {
  selectedIds.value = []
}

function toggleSelectAll() {
  if (allSelected.value) {
    cancelSelection()
    return
  }

  selectedIds.value = sortedSubscriptions.value.map((item) => item.id)
}

async function addSubscription() {
  if (!feedUrl.value.trim()) {
    showToast('请输入 RSS 地址')
    return
  }

  submitting.value = true
  try {
    await subscriptionStore.add(feedUrl.value.trim(), DEFAULT_WORKER_BASE_URL)
    await articleStore.loadAll()
    closeAddPopup()
    showToast('订阅已添加')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '添加失败')
  } finally {
    submitting.value = false
  }
}

async function deleteSelected() {
  try {
    await showConfirmDialog({
      title: '删除订阅',
      message: `确认删除所选 ${selectedIds.value.length} 个 RSS 订阅吗？`
    })
  } catch {
    return
  }

  await subscriptionStore.removeMany(selectedIds.value)
  await articleStore.loadAll()
  cancelSelection()
  showToast('已删除所选订阅')
}

async function markSelectedRead() {
  try {
    await showConfirmDialog({
      title: '标记为已读',
      message: `确认将所选 ${selectedIds.value.length} 个 RSS 订阅的文章全部标记为已读吗？`
    })
  } catch {
    return
  }

  await articleStore.markSubscriptionsRead(selectedIds.value)
  cancelSelection()
  showToast('所选订阅文章已标记为已读')
}

async function refreshSubscriptions() {
  refreshing.value = true
  refreshCompleted.value = 0
  refreshTotal.value = subscriptionStore.items.length
  refreshCurrentTitle.value = '准备中'

  try {
    const summary = await subscriptionStore.refreshAll(
      DEFAULT_WORKER_BASE_URL,
      3,
      ({ completed, total, title }) => {
        refreshCompleted.value = completed
        refreshTotal.value = total
        refreshCurrentTitle.value = title
      }
    )
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

onMounted(async () => {
  await Promise.all([subscriptionStore.load(), articleStore.loadAll()])
})

onBeforeUnmount(() => {
  clearPressTimer()
  uiStore.setTabbarHidden(false)
})
</script>

<template>
  <section class="page page--subscriptions page--sticky-header">
    <header class="page-header page-header--aligned page-header--sticky">
      <div>
        <p class="eyebrow">Feeds</p>
        <h1>{{ hasSelection ? '选择订阅' : '订阅首页' }}</h1>
      </div>
      <van-button v-if="!hasSelection" class="page-header__icon" round plain icon="plus" @click="openAddPopup" />
    </header>

    <van-notice-bar v-if="refreshMessage" left-icon="replay" :text="refreshMessage" />

    <van-pull-refresh v-model="refreshing" @refresh="refreshSubscriptions">
      <div v-if="sortedSubscriptions.length" class="feed-grid">
        <button
          v-for="subscription in sortedSubscriptions"
          :key="subscription.id"
          class="feed-icon-card"
          :class="{
            'feed-icon-card--selected': selectedIds.includes(subscription.id),
            'feed-icon-card--pressed': pressedSubscriptionId === subscription.id
          }"
          @touchstart.passive="startPress(subscription.id); setPressedSubscription(subscription.id)"
          @touchmove.passive="markMoved"
          @touchend="finishPress(); clearPressedSubscription()"
          @touchcancel="finishPress(); clearPressedSubscription()"
          @mousedown="startPress(subscription.id); setPressedSubscription(subscription.id)"
          @mousemove="markMoved"
          @mouseup="finishPress"
          @mouseleave="finishPress(); clearPressedSubscription()"
          @click="handleCardClick(subscription.id)"
        >
          <div class="feed-icon-card__badge" v-if="articleCounts.unreadMap[subscription.id]">{{ articleCounts.unreadMap[subscription.id] }}</div>
          <div class="feed-icon-card__avatar feed-icon-card__avatar--image">
            <img
              :src="getFaviconUrl(subscription.feedUrl, subscription.siteUrl)"
              :alt="subscription.title"
              @error="($event.target as HTMLImageElement).style.display = 'none'"
            />
            <span>{{ getSubscriptionInitial(subscription.title) }}</span>
          </div>
          <strong>{{ subscription.title }}</strong>
          <span>{{ articleCounts.totalMap[subscription.id] || 0 }} 篇</span>
        </button>
      </div>

      <van-empty v-else description="暂无订阅，点击右上角 + 添加" />
    </van-pull-refresh>

    <van-popup v-model:show="showAddPopup" round position="bottom" class="sheet-popup">
      <section class="sheet-popup__content">
        <div class="sheet-popup__header">
          <div>
            <p class="eyebrow">Add Feed</p>
            <h2>添加订阅</h2>
          </div>
          <van-button plain round size="small" @click="closeAddPopup">取消</van-button>
        </div>

        <van-cell-group inset>
          <van-field
            v-model="feedUrl"
            :placeholder="feedUrlPlaceholder"
            @focus="feedUrlPlaceholder = ''"
            @blur="feedUrlPlaceholder = feedUrl ? '' : 'https://example.com/feed.xml'"
          />
        </van-cell-group>

        <div class="cell-actions">
          <van-button block round type="primary" :loading="submitting" @click="addSubscription">添加订阅</van-button>
        </div>
      </section>
    </van-popup>

    <div v-if="hasSelection" class="bulk-toolbar bulk-toolbar--icons">
      <button class="bulk-toolbar__icon-btn" @click="toggleSelectAll">
        <van-icon :name="allSelected ? 'checked' : 'circle'" />
        <span>全选</span>
      </button>
      <button class="bulk-toolbar__icon-btn" @click="deleteSelected">
        <van-icon name="delete-o" />
        <span>删除</span>
      </button>
      <button class="bulk-toolbar__icon-btn" @click="markSelectedRead">
        <van-icon name="passed" />
        <span>全部已读</span>
      </button>
      <button class="bulk-toolbar__icon-btn" @click="cancelSelection">
        <van-icon name="cross" />
        <span>取消</span>
      </button>
    </div>
  </section>
</template>
