import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

import type { ArticleRecord, OfflineAssetRecord, SubscriptionRecord } from '@/types/models'

interface NeoReaderDB extends DBSchema {
  subscriptions: {
    key: string
    value: SubscriptionRecord
    indexes: { 'by-feed-url': string; 'by-updated': string }
  }
  articles: {
    key: string
    value: ArticleRecord
    indexes: {
      'by-subscription': string
      'by-published': string
      'by-favorite': number
      'by-read': number
      'by-link': string
    }
  }
  offline_assets: {
    key: string
    value: OfflineAssetRecord
    indexes: { 'by-article': string; 'by-local-path': string }
  }
}

let dbPromise: Promise<IDBPDatabase<NeoReaderDB>> | undefined

export function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<NeoReaderDB>('neoreader-db', 1, {
      upgrade(db) {
        const subscriptionStore = db.createObjectStore('subscriptions', { keyPath: 'id' })
        subscriptionStore.createIndex('by-feed-url', 'feedUrl', { unique: true })
        subscriptionStore.createIndex('by-updated', 'updatedAt')

        const articleStore = db.createObjectStore('articles', { keyPath: 'id' })
        articleStore.createIndex('by-subscription', 'subscriptionId')
        articleStore.createIndex('by-published', 'publishedAt')
        articleStore.createIndex('by-favorite', 'isFavorite')
        articleStore.createIndex('by-read', 'isRead')
        articleStore.createIndex('by-link', 'link')

        const offlineStore = db.createObjectStore('offline_assets', { keyPath: 'id' })
        offlineStore.createIndex('by-article', 'articleId')
        offlineStore.createIndex('by-local-path', 'localPath', { unique: true })
      }
    })
  }

  return dbPromise
}
