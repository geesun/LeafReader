<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { SwipeCell } from 'vant'

import { DEFAULT_WORKER_BASE_URL } from '@/constants/settings'
import { createWorkerUrl } from '@/services/workerClient'
import type { ArticleRecord } from '@/types/models'
import { extractLeadImageFromHtml, limitText } from '@/utils/text'
import { toAbsoluteUrl } from '@/utils/url'

const props = defineProps<{
  article: ArticleRecord
  metaPrimary: string
  metaSecondary?: string
  metaTags?: string[]
  pressed?: boolean
}>()

const emit = defineEmits<{
  open: [article: ArticleRecord]
  pressstart: [articleId: string]
  pressend: []
  markread: [article: ArticleRecord]
}>()

const swipeCellRef = ref<{ close: (position?: string) => void } | null>(null)
const imageLoadFailed = ref(false)
const previewText = computed(() => limitText(props.article.contentText || props.article.summary || '', 90))
const rawLeadImageUrl = computed(() => {
  if (props.article.leadImageUrl) return props.article.leadImageUrl

  return extractLeadImageFromHtml(props.article.fullContentHtml || props.article.feedContentHtml || props.article.summary, props.article.link) || ''
})
const hasLeadImage = computed(() => Boolean(rawLeadImageUrl.value))
const coverImageUrl = computed(() => {
  if (!rawLeadImageUrl.value) return ''

  const absolute = toAbsoluteUrl(rawLeadImageUrl.value, props.article.link)
  return createWorkerUrl(DEFAULT_WORKER_BASE_URL, 'asset', absolute)
})

watch(coverImageUrl, () => {
  imageLoadFailed.value = false
})

function handleOpen() {
  emit('open', props.article)
}

function handleMarkRead() {
  emit('markread', props.article)
}

function handleSwipeOpen(event: { position?: string }) {
  if (event.position !== 'left' && event.position !== 'right') return
  handleMarkRead()
  swipeCellRef.value?.close('outside')
}

function handleImageError() {
  imageLoadFailed.value = true
}
</script>

<template>
  <SwipeCell ref="swipeCellRef" class="article-swipe-cell" :right-width="92" :left-width="92" @open="handleSwipeOpen">
    <template #left>
      <div class="article-swipe-action article-swipe-action--read" @click="handleMarkRead">标已读</div>
    </template>

    <template #right>
      <div class="article-swipe-action article-swipe-action--read" @click="handleMarkRead">标已读</div>
    </template>

    <button
      class="article-card"
      :class="{
        'article-card--read': article.isRead,
        'article-card--pressed': pressed,
        'article-card--with-image': hasLeadImage
      }"
      @touchstart="emit('pressstart', article.id)"
      @touchend="emit('pressend')"
      @touchcancel="emit('pressend')"
      @mousedown="emit('pressstart', article.id)"
      @mouseup="emit('pressend')"
      @mouseleave="emit('pressend')"
      @click.stop="handleOpen"
    >
      <div class="article-card__meta">
        <span>{{ metaPrimary }}</span>
        <span v-if="metaSecondary">{{ metaSecondary }}</span>
        <span v-for="tag in metaTags || []" :key="tag">{{ tag }}</span>
      </div>

      <div v-if="hasLeadImage" class="article-card__hero">
        <img v-if="!imageLoadFailed" :src="coverImageUrl" alt="" loading="lazy" @error="handleImageError" />
        <div v-else class="article-card__hero-placeholder" aria-hidden="true">
          <div class="article-card__hero-placeholder-badge">NeoReader</div>
        </div>
        <div class="article-card__hero-body article-card__hero-body--stacked">
          <h3>{{ article.title }}</h3>
        </div>
      </div>

      <div v-else class="article-card__body">
        <h3>{{ article.title }}</h3>
        <p>{{ previewText }}</p>
      </div>
    </button>
  </SwipeCell>
</template>
