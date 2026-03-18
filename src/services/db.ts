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
    dbPromise = openDB<NeoReaderDB>('neoreader-db', 5, {
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

          const offlineStore = db.createObjectStore('offline_assets', { keyPath: 'id' })
          offlineStore.createIndex('by-article', 'articleId')
          offlineStore.createIndex('by-local-path', 'localPath', { unique: true })
        }

        if (oldVersion < 4) {
          // Version 4 added the by-deletable index; that migration is superseded
          // by version 5 which removes it. Nothing to do here for fresh installs
          // (oldVersion < 1 already handled above), but we must handle the case
          // where someone is upgrading from v1/v2/v3 directly to v5 — in that
          // scenario the by-deletable index was never created so we skip it.
        }

        if (oldVersion < 5) {
          // Remove the by-deletable index (isDeletable field is no longer used).
          const articleStore = tx.objectStore('articles')
          if ((articleStore.indexNames as DOMStringList).contains('by-deletable')) {
            articleStore.deleteIndex('by-deletable' as never)
          }
          // Strip the isDeletable field from all existing article records.
          let cursor = await articleStore.openCursor()
          while (cursor) {
            const record = cursor.value as ArticleRecord & { isDeletable?: boolean }
            if ('isDeletable' in record) {
              const { isDeletable: _, ...clean } = record
              await cursor.update(clean as ArticleRecord)
            }
            cursor = await cursor.continue()
          }
        }
      }
    })
  }

  return dbPromise
}
