import { defineStore } from 'pinia'

import {
  canTranslateArticle,
  clearOfflineLibrary,
  countArticles,
  fetchArticleFullText,
  generateArticleTranslation,
  generateArticleSummary,
  getArticle,
  getSubscriptionStats,
  getTotalArticleCount,
  listArticles,
  listArticlesPaginated,
  listFavoriteArticles,
  markArticlesReadByIds,
  markArticlesReadBySubscriptionIds,
  markArticleRead,
  markFilteredArticlesRead,
  removeArticleOfflineAssets,
  saveArticleWithOfflineAssets,
  toggleFavorite,
  type SubscriptionStats
} from '@/services/articleService'
import type { ArticleRecord, SummaryLength, SummaryProvider } from '@/types/models'

/** 每页加载的文章数量 */
const PAGE_SIZE = 10

export const useArticleStore = defineStore('articles', {
  state: () => ({
    items: [] as ArticleRecord[],
    current: undefined as ArticleRecord | undefined,
    loading: false,
    loadingMore: false,
    hasMore: true,
    totalCount: 0,
    readingList: [] as string[],   // ordered article ids from the current list context
    /** 订阅统计信息（用于 SubscriptionsView，避免加载全部文章） */
    subscriptionStats: new Map<string, SubscriptionStats>(),
    subscriptionStatsLoading: false
  }),
  actions: {
    setReadingList(ids: string[]) {
      this.readingList = ids
    },

    /**
     * 加载订阅统计信息（不加载全部文章内容）
     * 用于 SubscriptionsView 显示每个订阅的文章数、未读数等
     */
    async loadSubscriptionStats() {
      this.subscriptionStatsLoading = true
      try {
        const [stats, total] = await Promise.all([
          getSubscriptionStats(),
          getTotalArticleCount()
        ])
        this.subscriptionStats = stats
        this.totalCount = total
      } finally {
        this.subscriptionStatsLoading = false
      }
    },

    /**
     * 重置并加载第一页文章
     */
    async loadFirstPage(subscriptionId?: string) {
      this.loading = true
      this.hasMore = true
      try {
        const [result, total] = await Promise.all([
          listArticlesPaginated(0, PAGE_SIZE, subscriptionId),
          countArticles(subscriptionId)
        ])

        this.items = result.articles
        this.hasMore = result.hasMore
        this.totalCount = total
      } finally {
        this.loading = false
      }
    },

    /**
     * 加载更多文章（下一页）
     */
    async loadMoreArticles(subscriptionId?: string) {
      if (this.loadingMore || !this.hasMore) return

      this.loadingMore = true
      try {
        const result = await listArticlesPaginated(this.items.length, PAGE_SIZE, subscriptionId)

        // 合并新文章，避免重复
        const existingIds = new Set(this.items.map(a => a.id))
        const newArticles = result.articles.filter(a => !existingIds.has(a.id))
        this.items = [...this.items, ...newArticles]
        this.hasMore = result.hasMore
      } finally {
        this.loadingMore = false
      }
    },

    /**
     * 加载全部文章（保留用于兼容性和特殊场景）
     */
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
        this.hasMore = false
        this.totalCount = this.items.length
      } finally {
        this.loading = false
      }
    },

    async loadFavorites() {
      this.loading = true
      try {
        this.items = await listFavoriteArticles()
        this.hasMore = false
        this.totalCount = this.items.length
      } finally {
        this.loading = false
      }
    },

    async openArticle(id: string) {
      this.current = await getArticle(id)
      return this.current
    },

    /**
     * 更新单个文章（原地更新，避免创建新数组）
     */
    _updateItemInPlace(updated: ArticleRecord) {
      const index = this.items.findIndex(item => item.id === updated.id)
      if (index !== -1) {
        this.items[index] = updated
      }
    },

    async setRead(article: ArticleRecord, isRead: boolean) {
      const updated = await markArticleRead(article, isRead)
      this.current = this.current?.id === updated.id ? updated : this.current
      this._updateItemInPlace(updated)
      return updated
    },

    async toggleFavorite(article: ArticleRecord) {
      const updated = await toggleFavorite(article)
      this.current = this.current?.id === updated.id ? updated : this.current
      this._updateItemInPlace(updated)
      return updated
    },

    async ensureFullText(article: ArticleRecord, workerBaseUrl: string) {
      const updated = await fetchArticleFullText(article, workerBaseUrl)
      this.current = updated
      this._updateItemInPlace(updated)
      return updated
    },

    async saveOffline(article: ArticleRecord, workerBaseUrl: string) {
      const updated = await saveArticleWithOfflineAssets(article, workerBaseUrl)
      this.current = updated
      this._updateItemInPlace(updated)
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
      this._updateItemInPlace(updated)
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
      this._updateItemInPlace(updated)
      return updated
    },

    async removeOffline(article: ArticleRecord) {
      const updated = await removeArticleOfflineAssets(article)
      this.current = this.current?.id === updated.id ? updated : this.current
      this._updateItemInPlace(updated)
      return updated
    },

    async clearAllOffline() {
      await clearOfflineLibrary()
      this.items = await listArticles()
      this.hasMore = false
      this.totalCount = this.items.length
      if (this.current) {
        this.current = await getArticle(this.current.id)
      }
    },

    async markSubscriptionsRead(subscriptionIds: string[]) {
      await markArticlesReadBySubscriptionIds(subscriptionIds)
      
      // 更新统计数据（如果已加载）
      if (this.subscriptionStats.size > 0) {
        for (const subId of subscriptionIds) {
          const stats = this.subscriptionStats.get(subId)
          if (stats) {
            stats.unreadCount = 0
          }
        }
      }
      
      // 更新当前已加载的文章列表中的已读状态
      for (const item of this.items) {
        if (subscriptionIds.includes(item.subscriptionId) && !item.isRead) {
          item.isRead = true
          item.readAt = item.readAt ?? new Date().toISOString()
        }
      }
      
      if (this.current && subscriptionIds.includes(this.current.subscriptionId)) {
        this.current = await getArticle(this.current.id)
      }
    },

    async markArticlesRead(articleIds: string[]) {
      await markArticlesReadByIds(articleIds)
      
      // 更新当前已加载的文章列表中的已读状态，并收集需要更新统计的订阅 ID
      const affectedSubscriptions = new Set<string>()
      for (const item of this.items) {
        if (articleIds.includes(item.id) && !item.isRead) {
          item.isRead = true
          item.readAt = item.readAt ?? new Date().toISOString()
          affectedSubscriptions.add(item.subscriptionId)
        }
      }
      
      // 更新统计数据（如果已加载）- 需要重新查询因为我们不知道具体减少了多少
      if (this.subscriptionStats.size > 0 && affectedSubscriptions.size > 0) {
        const stats = await getSubscriptionStats()
        this.subscriptionStats = stats
      }
      
      if (this.current && articleIds.includes(this.current.id)) {
        this.current = await getArticle(this.current.id)
      }
    },

    /**
     * 标记筛选条件下的所有文章为已读
     * @param subscriptionId 可选，按订阅源过滤
     * @param filter 筛选条件
     * @returns 标记的文章数量
     */
    async markAllFilteredRead(
      subscriptionId?: string,
      filter?: 'all' | 'unread' | 'favorites'
    ): Promise<number> {
      const count = await markFilteredArticlesRead(subscriptionId, filter)
      
      // 更新当前已加载的文章列表中的已读状态
      for (const item of this.items) {
        const matchesSubscription = !subscriptionId || item.subscriptionId === subscriptionId
        const matchesFilter =
          filter === 'all' || !filter
            ? true
            : filter === 'unread'
              ? !item.isRead
              : item.isFavorite

        if (matchesSubscription && matchesFilter && !item.isRead) {
          item.isRead = true
          item.readAt = item.readAt ?? new Date().toISOString()
        }
      }
      
      // 更新统计数据（如果已加载）
      if (this.subscriptionStats.size > 0) {
        if (subscriptionId) {
          // 只更新指定订阅的统计
          const stats = this.subscriptionStats.get(subscriptionId)
          if (stats) {
            stats.unreadCount = 0
          }
        } else {
          // 更新所有订阅的统计
          for (const stats of this.subscriptionStats.values()) {
            stats.unreadCount = 0
          }
        }
      }
      
      return count
    }
  }
})
