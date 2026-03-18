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
      'by-deletable': number
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
    dbPromise = openDB<NeoReaderDB>('neoreader-db', 4, {
      async upgrade(db, oldVersion, _newVersion, tx) {
        if (oldVersion < 1) {
          const subscriptionStore = db.createObjectStore('subscriptions', { keyPath: 'id' })
          subscriptionStore.createIndex('by-feed-url', 'feedUrl', { unique: true })
          subscriptionStore.createIndex('by-updated', 'updatedAt')

          const articleStore = db.createObjectStore('articles', { keyPath: 'id' })
          articleStore.createIndex('by-subscription', 'subscriptionId')
          articleStore.createIndex('by-published', 'publishedAt')
          articleStore.createIndex('by-favorite', 'isFavorite')
          articleStore.createIndex('by-read', 'isRead')
          articleStore.createIndex('by-link', 'link')
          articleStore.createIndex('by-deletable', 'isDeletable')

          const offlineStore = db.createObjectStore('offline_assets', { keyPath: 'id' })
          offlineStore.createIndex('by-article', 'articleId')
          offlineStore.createIndex('by-local-path', 'localPath', { unique: true })
        }

        if (oldVersion < 4) {
          // Add by-deletable index and backfill isDeletable=false on all existing articles.
          // (This branch also runs for databases created at version 1, 2, or 3.)
          const articleStore = tx.objectStore('articles')
          if (!articleStore.indexNames.contains('by-deletable')) {
            articleStore.createIndex('by-deletable', 'isDeletable')
          }
          // Backfill: treat every existing article as not-deletable so they are
          // never trimmed until their subscription is refreshed at least once.
          let cursor = await articleStore.openCursor()
          while (cursor) {
            if ((cursor.value as ArticleRecord).isDeletable === undefined) {
              await cursor.update({ ...(cursor.value as ArticleRecord), isDeletable: false })
            }
            cursor = await cursor.continue()
          }
        }
      }
    })
  }

  return dbPromise
}
