<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { useUiStore } from '@/stores/ui'

const route = useRoute()
const router = useRouter()
const uiStore = useUiStore()

const active = computed(() => {
  if (route.name === 'reading') return 'reading'
  if (route.name === 'favorites') return 'favorites'
  if (route.name === 'settings') return 'settings'
  return 'home'
})

const hideTabbar = computed(() => route.name === 'article' || uiStore.tabbarHidden)

function onTabTap(name: string) {
  // Always scroll to top, whether switching tabs or re-tapping the active one
  window.scrollTo({ top: 0, behavior: 'smooth' })
  if (name !== active.value) {
    void router.push({ name })
  }
}
</script>

<template>
  <div class="app-shell">
    <main class="app-main" :class="{ 'app-main--full': hideTabbar }">
      <RouterView />
    </main>

    <van-tabbar v-if="!hideTabbar" :model-value="active" fixed placeholder>
      <van-tabbar-item name="home" icon="notes-o" @click="onTabTap('home')">订阅</van-tabbar-item>
      <van-tabbar-item name="reading" icon="newspaper-o" @click="onTabTap('reading')">阅读</van-tabbar-item>
      <van-tabbar-item name="favorites" icon="star-o" @click="onTabTap('favorites')">收藏</van-tabbar-item>
      <van-tabbar-item name="settings" icon="setting-o" @click="onTabTap('settings')">设置</van-tabbar-item>
    </van-tabbar>
  </div>
</template>
