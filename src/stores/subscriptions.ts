import { defineStore } from 'pinia'

import { getDb } from '@/services/db'
import { createSubscriptionFromUrl, refreshSubscription } from '@/services/feedService'
import type { RefreshSummary, SubscriptionRecord } from '@/types/models'

interface RefreshProgress {
  completed: number
  total: number
  title: string
  status: 'success' | 'failure'
}

export const useSubscriptionStore = defineStore('subscriptions', {
  state: () => ({
    items: [] as SubscriptionRecord[],
    loading: false
  }),
  actions: {
    async load() {
      this.loading = true
      try {
        const db = await getDb()
        const items = await db.getAll('subscriptions')
        this.items = items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      } finally {
        this.loading = false
      }
    },
    async add(feedUrl: string, workerBaseUrl: string) {
      const subscription = await createSubscriptionFromUrl(feedUrl, workerBaseUrl)
      this.items.unshift(subscription)
    },
    async update(subscription: SubscriptionRecord) {
      const db = await getDb()
      await db.put('subscriptions', subscription)
      const index = this.items.findIndex((item) => item.id === subscription.id)
      if (index >= 0) {
        this.items.splice(index, 1, subscription)
      } else {
        this.items.unshift(subscription)
      }
    },
    async refreshOne(subscriptionId: string, workerBaseUrl: string): Promise<number> {
      const subscription = this.items.find((item) => item.id === subscriptionId)
      if (!subscription) return 0
      const inserted = await refreshSubscription(subscription, workerBaseUrl)
      await this.load()
      return inserted
    },
    async refreshAll(
      workerBaseUrl: string,
      concurrency = 3,
      onProgress?: (progress: RefreshProgress) => void
    ): Promise<RefreshSummary> {
      const queue = [...this.items]
      const total = queue.length
      let completed = 0
      const summary: RefreshSummary = {
        inserted: 0,
        successCount: 0,
        failureCount: 0,
        failures: []
      }

      const worker = async () => {
        while (queue.length) {
          const subscription = queue.shift()
          if (!subscription) return

          try {
            summary.inserted += await refreshSubscription(subscription, workerBaseUrl)
            summary.successCount += 1
            completed += 1
            onProgress?.({
              completed,
              total,
              title: subscription.title,
              status: 'success'
            })
          } catch (error) {
            summary.failureCount += 1
            summary.failures.push({
              subscriptionId: subscription.id,
              message: error instanceof Error ? error.message : '刷新失败'
            })
            completed += 1
            onProgress?.({
              completed,
              total,
              title: subscription.title,
              status: 'failure'
            })
          }
        }
      }

      const workers = Array.from({ length: Math.min(concurrency, Math.max(queue.length, 1)) }, () => worker())
      await Promise.all(workers)
      await this.load()
      return summary
    },
    async remove(subscriptionId: string) {
      const db = await getDb()
      await db.delete('subscriptions', subscriptionId)

      const articleIds = (await db.getAllFromIndex('articles', 'by-subscription', subscriptionId)).map((article) => article.id)
      const tx = db.transaction('articles', 'readwrite')
      for (const articleId of articleIds) {
        await tx.store.delete(articleId)
      }
      await tx.done

      this.items = this.items.filter((item) => item.id !== subscriptionId)
    },
    async removeMany(subscriptionIds: string[]) {
      for (const subscriptionId of subscriptionIds) {
        await this.remove(subscriptionId)
      }
    }
  }
})
