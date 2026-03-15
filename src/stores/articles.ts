import { defineStore } from 'pinia'

import {
  clearOfflineLibrary,
  fetchArticleFullText,
  generateArticleSummary,
  getArticle,
  listArticles,
  listFavoriteArticles,
  markArticlesReadByIds,
  markArticlesReadBySubscriptionIds,
  markArticleRead,
  removeArticleOfflineAssets,
  saveArticleWithOfflineAssets,
  toggleFavorite
} from '@/services/articleService'
import type { ArticleRecord, SummaryLength, SummaryProvider } from '@/types/models'

export const useArticleStore = defineStore('articles', {
  state: () => ({
    items: [] as ArticleRecord[],
    current: undefined as ArticleRecord | undefined,
    loading: false
  }),
  actions: {
    async loadAll() {
      this.loading = true
      try {
        this.items = await listArticles()
      } finally {
        this.loading = false
      }
    },
    async loadFavorites() {
      this.loading = true
      try {
        this.items = await listFavoriteArticles()
      } finally {
        this.loading = false
      }
    },
    async openArticle(id: string) {
      this.current = await getArticle(id)
      return this.current
    },
    async setRead(article: ArticleRecord, isRead: boolean) {
      const updated = await markArticleRead(article, isRead)
      this.current = this.current?.id === updated.id ? updated : this.current
      this.items = this.items.map((item) => (item.id === updated.id ? updated : item))
      return updated
    },
    async toggleFavorite(article: ArticleRecord) {
      const updated = await toggleFavorite(article)
      this.current = this.current?.id === updated.id ? updated : this.current
      this.items = this.items.map((item) => (item.id === updated.id ? updated : item))
      return updated
    },
    async ensureFullText(article: ArticleRecord, workerBaseUrl: string) {
      const updated = await fetchArticleFullText(article, workerBaseUrl)
      this.current = updated
      this.items = this.items.map((item) => (item.id === updated.id ? updated : item))
      return updated
    },
    async saveOffline(article: ArticleRecord, workerBaseUrl: string) {
      const updated = await saveArticleWithOfflineAssets(article, workerBaseUrl)
      this.current = updated
      this.items = this.items.map((item) => (item.id === updated.id ? updated : item))
      return updated
    },
    async generateSummary(
      article: ArticleRecord,
      workerBaseUrl: string,
      forceRefresh = false,
      length: SummaryLength = 'medium',
      provider: SummaryProvider = 'google'
    ) {
      const updated = await generateArticleSummary(article, workerBaseUrl, forceRefresh, length, provider)
      this.current = this.current?.id === updated.id ? updated : this.current
      this.items = this.items.map((item) => (item.id === updated.id ? updated : item))
      return updated
    },
    async removeOffline(article: ArticleRecord) {
      const updated = await removeArticleOfflineAssets(article)
      this.current = this.current?.id === updated.id ? updated : this.current
      this.items = this.items.map((item) => (item.id === updated.id ? updated : item))
      return updated
    },
    async clearAllOffline() {
      await clearOfflineLibrary()
      this.items = await listArticles()
      if (this.current) {
        this.current = await getArticle(this.current.id)
      }
    },
    async markSubscriptionsRead(subscriptionIds: string[]) {
      await markArticlesReadBySubscriptionIds(subscriptionIds)
      this.items = await listArticles()
      if (this.current && subscriptionIds.includes(this.current.subscriptionId)) {
        this.current = await getArticle(this.current.id)
      }
    },
    async markArticlesRead(articleIds: string[]) {
      await markArticlesReadByIds(articleIds)
      this.items = await listArticles()
      if (this.current && articleIds.includes(this.current.id)) {
        this.current = await getArticle(this.current.id)
      }
    }
  }
})
