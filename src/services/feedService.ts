import { getDb } from '@/services/db'
import { fetchFeedXml } from '@/services/workerClient'
import { parseFeedXml } from '@/services/feedParser'
import type { ArticleRecord, SubscriptionRecord } from '@/types/models'
import { compareArticlesByRecency } from '@/utils/articleTime'
import { createId } from '@/utils/id'
import { extractLeadImageFromHtml } from '@/utils/text'
import { buildSubscriptionIconCandidates, shouldUseTextOnlySubscriptionIcon } from '@/utils/url'

const MAX_ARTICLE_COUNT = 500

export async function createSubscriptionFromUrl(
  feedUrl: string,
  workerBaseUrl: string
): Promise<SubscriptionRecord> {
  const xml = await fetchFeedXml(workerBaseUrl, feedUrl)
  const parsed = parseFeedXml(xml)
  const now = new Date().toISOString()
  const db = await getDb()

  const existing = await db.getFromIndex('subscriptions', 'by-feed-url', feedUrl)
  if (existing) {
    throw new Error('该订阅已存在')
  }
  const subscription: SubscriptionRecord = {
    id: createId('sub'),
    title: parsed.title,
    feedUrl,
    siteUrl: parsed.link,
    iconUrl: buildSubscriptionIconCandidates(parsed.link, feedUrl)[0],
    iconLookupFailed: shouldUseTextOnlySubscriptionIcon(parsed.link, feedUrl),
    description: parsed.description,
    createdAt: now,
    updatedAt: now,
    lastFetchedAt: now,
    lastSuccessAt: now,
    isPinned: false
  }

  await db.put('subscriptions', subscription)
  await upsertFeedItems(subscription.id, parsed.items)
  await trimArticles(db)
  return subscription
}

export async function refreshSubscription(subscription: SubscriptionRecord, workerBaseUrl: string): Promise<number> {
  const xml = await fetchFeedXml(workerBaseUrl, subscription.feedUrl)
  const parsed = parseFeedXml(xml)
  const inserted = await upsertFeedItems(subscription.id, parsed.items)
  const db = await getDb()
  if (inserted > 0) {
    await trimArticles(db)
  }
  const nextIconUrl = buildSubscriptionIconCandidates(parsed.link || subscription.siteUrl, subscription.feedUrl)[0] || subscription.iconUrl
  const iconChanged = nextIconUrl !== subscription.iconUrl
  const textOnlyIcon = shouldUseTextOnlySubscriptionIcon(parsed.link || subscription.siteUrl, subscription.feedUrl)
  await db.put('subscriptions', {
    ...subscription,
    title: parsed.title || subscription.title,
    siteUrl: parsed.link || subscription.siteUrl,
    iconUrl: nextIconUrl,
    ...(iconChanged ? { cachedIconDataUrl: undefined } : {}),
    iconLookupFailed: textOnlyIcon ? true : iconChanged ? false : subscription.iconLookupFailed,
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
): Promise<number> {
  const db = await getDb()
  let inserted = 0

  for (const item of items) {
    const existing = await db.getFromIndex('articles', 'by-link', item.link)
    if (existing) continue

    const now = new Date().toISOString()
    const article: ArticleRecord = {
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

    await db.put('articles', article)
    inserted += 1
  }

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
