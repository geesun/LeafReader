import { getDb } from '@/services/db'
import { extractFullText, fetchFeedXml } from '@/services/workerClient'
import { parseFeedXml } from '@/services/feedParser'
import type { ArticleRecord, SubscriptionRecord } from '@/types/models'
import { compareArticlesByRecency } from '@/utils/articleTime'
import { createId } from '@/utils/id'
import { extractLeadImageFromHtml } from '@/utils/text'

const MAX_ARTICLE_COUNT = 500

export async function createSubscriptionFromUrl(
  feedUrl: string,
  workerBaseUrl: string
): Promise<SubscriptionRecord> {
  const xml = await fetchFeedXml(workerBaseUrl, feedUrl)
  const parsed = parseFeedXml(xml)
  const now = new Date().toISOString()
  const db = await getDb()

  const existing = await db.getAll('subscriptions')
  const duplicated = existing.find((item) => item.feedUrl === feedUrl)
  if (duplicated) {
    throw new Error('该订阅已存在')
  }

  const subscription: SubscriptionRecord = {
    id: createId('sub'),
    title: parsed.title,
    feedUrl,
    siteUrl: parsed.link,
    description: parsed.description,
    createdAt: now,
    updatedAt: now,
    lastFetchedAt: now,
    lastSuccessAt: now,
    isPinned: false
  }

  await db.put('subscriptions', subscription)
  await upsertFeedItems(subscription.id, parsed.items, workerBaseUrl)
  return subscription
}

export async function refreshSubscription(subscription: SubscriptionRecord, workerBaseUrl: string): Promise<number> {
  const xml = await fetchFeedXml(workerBaseUrl, subscription.feedUrl)
  const parsed = parseFeedXml(xml)
  const inserted = await upsertFeedItems(subscription.id, parsed.items, workerBaseUrl)
  const db = await getDb()
  await db.put('subscriptions', {
    ...subscription,
    title: parsed.title || subscription.title,
    siteUrl: parsed.link || subscription.siteUrl,
    description: parsed.description || subscription.description,
    updatedAt: new Date().toISOString(),
    lastFetchedAt: new Date().toISOString(),
    lastSuccessAt: new Date().toISOString(),
    lastError: undefined
  })
  return inserted
}

async function upsertFeedItems(
  subscriptionId: string,
  items: ReturnType<typeof parseFeedXml>['items'],
  workerBaseUrl: string
): Promise<number> {
  const db = await getDb()
  let inserted = 0

  for (const item of items) {
    const existing = await db.getFromIndex('articles', 'by-link', item.link)
    if (existing) continue

    const now = new Date().toISOString()
    let article: ArticleRecord = {
      id: createId('art'),
      subscriptionId,
      feedItemId: item.feedItemId,
      title: item.title,
      link: item.link,
      author: item.author,
      summary: item.summary,
      feedContentHtml: item.contentHtml,
      contentText: item.contentText,
      contentSource: 'feed',
      publishedAt: item.publishedAt,
      createdAt: now,
      updatedAt: now,
      isRead: false,
      isFavorite: false,
      hasFullContent: false,
      isOfflineSaved: false,
      leadImageUrl: extractLeadImageFromHtml(item.contentHtml, item.link)
    }

    try {
      const fullText = await extractFullText(workerBaseUrl, item.link)
      article = {
        ...article,
        fullContentHtml: fullText.contentHtml,
        contentText: article.contentText || fullText.textContent,
        contentSource: 'fulltext',
        hasFullContent: true,
        leadImageUrl: fullText.leadImageUrl,
        author: fullText.byline || article.author
      }
    } catch {
    }

    await db.put('articles', article)
    inserted += 1
  }

  await trimArticles(db)

  return inserted
}

async function trimArticles(db: Awaited<ReturnType<typeof getDb>>): Promise<void> {
  const articles = await db.getAll('articles')
  if (articles.length <= MAX_ARTICLE_COUNT) return

  const sorted = [...articles].sort(compareArticlesByRecency)
  const expired = sorted.slice(MAX_ARTICLE_COUNT)

  const tx = db.transaction(['articles', 'offline_assets'], 'readwrite')

  for (const article of expired) {
    const offlineAssets = await tx.objectStore('offline_assets').index('by-article').getAll(article.id)
    for (const asset of offlineAssets) {
      await tx.objectStore('offline_assets').delete(asset.id)
    }

    await tx.objectStore('articles').delete(article.id)
  }

  await tx.done
}
