import DOMPurify from 'dompurify'

import { getDb } from '@/services/db'
import { clearOfflineAssets, removeArticleOffline, saveArticleOffline } from '@/services/offlineService'
import { extractFullText } from '@/services/workerClient'
import type { ArticleRecord } from '@/types/models'
import { compareArticlesByRecency } from '@/utils/articleTime'

export function sanitizeHtml(html?: string): string {
  return DOMPurify.sanitize(html ?? '', {
    USE_PROFILES: { html: true }
  })
}

export async function listArticles(): Promise<ArticleRecord[]> {
  const db = await getDb()
  const articles = await db.getAll('articles')
  return articles.sort(compareArticlesByRecency)
}

export async function listFavoriteArticles(): Promise<ArticleRecord[]> {
  const articles = await listArticles()
  return articles.filter((article) => article.isFavorite)
}

export async function getArticle(id: string): Promise<ArticleRecord | undefined> {
  const db = await getDb()
  return db.get('articles', id)
}

export async function updateArticle(article: ArticleRecord): Promise<void> {
  const db = await getDb()
  await db.put('articles', {
    ...article,
    updatedAt: new Date().toISOString()
  })
}

export async function markArticleRead(article: ArticleRecord, isRead: boolean): Promise<ArticleRecord> {
  const updated = {
    ...article,
    isRead,
    readAt: isRead ? new Date().toISOString() : undefined,
    updatedAt: new Date().toISOString()
  }
  await updateArticle(updated)
  return updated
}

export async function toggleFavorite(article: ArticleRecord): Promise<ArticleRecord> {
  const nextFavorite = !article.isFavorite
  const updated = {
    ...article,
    isFavorite: nextFavorite,
    favoriteAt: nextFavorite ? new Date().toISOString() : undefined,
    updatedAt: new Date().toISOString()
  }
  await updateArticle(updated)
  return updated
}

export async function fetchArticleFullText(article: ArticleRecord, workerBaseUrl: string): Promise<ArticleRecord> {
  const fullText = await extractFullText(workerBaseUrl, article.link)
  const updated: ArticleRecord = {
    ...article,
    fullContentHtml: fullText.contentHtml,
    contentText: fullText.textContent || article.contentText,
    contentSource: 'fulltext',
    hasFullContent: true,
    leadImageUrl: fullText.leadImageUrl || article.leadImageUrl,
    updatedAt: new Date().toISOString()
  }

  await updateArticle(updated)
  return updated
}

export async function saveArticleWithOfflineAssets(article: ArticleRecord, workerBaseUrl: string): Promise<ArticleRecord> {
  return saveArticleOffline(article, workerBaseUrl)
}

export async function removeArticleOfflineAssets(article: ArticleRecord): Promise<ArticleRecord> {
  return removeArticleOffline(article)
}

export async function clearOfflineLibrary(): Promise<void> {
  await clearOfflineAssets()
}

export async function markArticlesReadBySubscriptionIds(subscriptionIds: string[]): Promise<void> {
  if (!subscriptionIds.length) return

  const db = await getDb()
  const tx = db.transaction('articles', 'readwrite')

  for (const subscriptionId of subscriptionIds) {
    const articles = await tx.store.index('by-subscription').getAll(subscriptionId)

    for (const article of articles) {
      await tx.store.put({
        ...article,
        isRead: true,
        readAt: article.readAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString()
      })
    }
  }

  await tx.done
}

export async function markArticlesReadByIds(articleIds: string[]): Promise<void> {
  if (!articleIds.length) return

  const db = await getDb()
  const tx = db.transaction('articles', 'readwrite')

  for (const articleId of articleIds) {
    const article = await tx.store.get(articleId)
    if (!article) continue

    await tx.store.put({
      ...article,
      isRead: true,
      readAt: article.readAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString()
    })
  }

  await tx.done
}
