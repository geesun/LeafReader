import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  scrollBehavior(_to, _from, savedPosition) {
    if (savedPosition) return savedPosition
    return { top: 0 }
  },
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('@/views/SubscriptionsView.vue')
    },
    {
      path: '/reading',
      name: 'reading',
      component: () => import('@/views/HomeView.vue')
    },
    {
      path: '/subscriptions',
      name: 'subscriptions',
      redirect: '/'
    },
    {
      path: '/favorites',
      name: 'favorites',
      component: () => import('@/views/FavoritesView.vue')
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('@/views/SettingsView.vue')
    },
    {
      path: '/search',
      name: 'search',
      component: () => import('@/views/SearchView.vue')
    },
    {
      path: '/article/:id',
      name: 'article',
      component: () => import('@/views/ArticleView.vue')
    }
  ]
})

export default router
