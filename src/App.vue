<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { useUiStore } from '@/stores/ui'

const route = useRoute()
const router = useRouter()
const uiStore = useUiStore()

const active = computed({
  get: () => {
    if (route.name === 'reading') return 'reading'
    if (route.name === 'favorites') return 'favorites'
    if (route.name === 'settings') return 'settings'
    return 'home'
  },
  set: (value: string) => {
    void router.push({ name: value })
  }
})

const hideTabbar = computed(() => route.name === 'article' || uiStore.tabbarHidden)
</script>

<template>
  <div class="app-shell">
    <main class="app-main" :class="{ 'app-main--full': hideTabbar }">
      <RouterView />
    </main>

    <van-tabbar v-if="!hideTabbar" v-model="active" route fixed placeholder>
      <van-tabbar-item name="home" icon="cluster-o" to="/">订阅</van-tabbar-item>
      <van-tabbar-item name="reading" icon="newspaper-o" to="/reading">阅读</van-tabbar-item>
      <van-tabbar-item name="favorites" icon="star-o" to="/favorites">收藏</van-tabbar-item>
      <van-tabbar-item name="settings" icon="setting-o" to="/settings">设置</van-tabbar-item>
    </van-tabbar>
  </div>
</template>
