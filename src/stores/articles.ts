import { defineStore } from 'pinia'

import {
  canTranslateArticle,
  clearOfflineLibrary,
  fetchArticleFullText,
  generateArticleTranslation,
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
    loading: false,
    readingList: [] as string[]   // ordered article ids from the current list context
  }),
  actions: {
    setReadingList(ids: string[]) {
      this.readingList = ids
    },
    async loadAll() {
      this.loading = true
      try {
        const fromDb = await listArticles()
        // Merge DB results with in-memory state: for articles already in memory,
        // keep the in-memory version if it is newer (higher updatedAt), so that
        // a concurrent loadAll triggered by refreshAll doesn't overwrite user
        // actions (setRead, toggleFavorite) that are in-flight or just committed.
        const memoryMap = new Map(this.items.map((a) => [a.id, a]))
        this.items = fromDb.map((dbItem) => {
          const mem = memoryMap.get(dbItem.id)
          if (mem && mem.updatedAt > dbItem.updatedAt) return mem
          return dbItem
        })
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
    canTranslate(article: ArticleRecord) {
      return canTranslateArticle(article)
    },
    async generateTranslation(
      article: ArticleRecord,
      workerBaseUrl: string,
      forceRefresh = false,
      provider: SummaryProvider = 'google'
    ) {
      const updated = await generateArticleTranslation(article, workerBaseUrl, forceRefresh, provider)
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
