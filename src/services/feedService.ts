import { getDb } from '@/services/db'
import { fetchFeedXml } from '@/services/workerClient'
import { parseFeedXml } from '@/services/feedParser'
import { loadSettings } from '@/services/settings'
import type { ArticleRecord, SubscriptionRecord } from '@/types/models'

import { createId } from '@/utils/id'
import { extractLeadImageFromHtml } from '@/utils/text'
import { buildSubscriptionIconCandidates, shouldUseTextOnlySubscriptionIcon } from '@/utils/url'

const PER_SUBSCRIPTION_TRIM_THRESHOLD = 50

function normalizeArticleTitle(title: string | undefined): string {
  return (title ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

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
  await syncFeedItems(subscription.id, parsed.items)
  return subscription
}

export async function refreshSubscription(subscription: SubscriptionRecord, workerBaseUrl: string): Promise<number> {
  const xml = await fetchFeedXml(workerBaseUrl, subscription.feedUrl)
  const parsed = parseFeedXml(xml)
  
  const db = await getDb()
  const beforeCount = (await db.countFromIndex('articles', 'by-subscription', subscription.id))
  
  await syncFeedItems(subscription.id, parsed.items)
  
  // 直接从 DB 计算实际插入数，而不是依赖 syncFeedItems 的返回值
  const afterCountBeforeTrim = (await db.countFromIndex('articles', 'by-subscription', subscription.id))
  const inserted = afterCountBeforeTrim - beforeCount
  
  // Re-read from IDB to avoid overwriting concurrent writes (e.g. from other
  // parallel refresh workers that may have updated this record).
  const fresh = (await db.get('subscriptions', subscription.id)) ?? subscription
  const nextIconUrl = buildSubscriptionIconCandidates(parsed.link || fresh.siteUrl, fresh.feedUrl)[0] || fresh.iconUrl
  const iconChanged = nextIconUrl !== fresh.iconUrl
  const textOnlyIcon = shouldUseTextOnlySubscriptionIcon(parsed.link || fresh.siteUrl, fresh.feedUrl)
  await db.put('subscriptions', {
    ...fresh,
    title: parsed.title || fresh.title,
    siteUrl: parsed.link || fresh.siteUrl,
    iconUrl: nextIconUrl,
    ...(iconChanged ? { cachedIconDataUrl: undefined } : {}),
    iconLookupFailed: textOnlyIcon ? true : iconChanged ? false : fresh.iconLookupFailed,
    description: parsed.description || fresh.description,
    updatedAt: new Date().toISOString(),
    lastFetchedAt: new Date().toISOString(),
    lastSuccessAt: new Date().toISOString(),
    lastError: undefined
  })
  const settings = loadSettings()
  await trimSubscriptionArticles(subscription.id, settings.articleRetentionDays)
  return inserted
}

/**
 * Trim articles for a single subscription.
 *
 * Only runs when the subscription has more than PER_SUBSCRIPTION_TRIM_THRESHOLD
 * articles. Deletes non-favorite articles whose createdAt is older than
 * retentionDays. Also cleans up associated offline_assets.
 */
export async function trimSubscriptionArticles(subscriptionId: string, retentionDays: number): Promise<void> {
  const db = await getDb()
  const articles = await db.getAllFromIndex('articles', 'by-subscription', subscriptionId)

  if (articles.length <= PER_SUBSCRIPTION_TRIM_THRESHOLD) return

  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString()
  const expired = articles.filter((a) => !a.isFavorite && a.createdAt < cutoff)

  if (!expired.length) return

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

/**
 * Trim articles for all subscriptions at once.
 * Used by the manual "clean up" action in Settings.
 * Returns the total number of articles deleted across all subscriptions.
 */
export async function trimAllSubscriptionsArticles(retentionDays: number): Promise<number> {
  const db = await getDb()
  const subscriptions = await db.getAll('subscriptions')
  let totalDeleted = 0

  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString()

  for (const sub of subscriptions) {
    const articles = await db.getAllFromIndex('articles', 'by-subscription', sub.id)
    if (articles.length <= PER_SUBSCRIPTION_TRIM_THRESHOLD) continue

    const expired = articles.filter((a) => !a.isFavorite && a.createdAt < cutoff)
    if (!expired.length) continue

    const tx = db.transaction(['articles', 'offline_assets'], 'readwrite')
    for (const article of expired) {
      const offlineAssets = await tx.objectStore('offline_assets').index('by-article').getAll(article.id)
      for (const asset of offlineAssets) {
        await tx.objectStore('offline_assets').delete(asset.id)
      }
      await tx.objectStore('articles').delete(article.id)
      totalDeleted += 1
    }
    await tx.done
  }

  return totalDeleted
}

/**
 * Sync the latest feed items into the articles store.
 *
 * For each item in the feed: if an article with the same link, feedItemId, or
 * normalized title already exists, skip it (preserve all user state). Otherwise
 * insert a new record. Returns the number of newly inserted articles.
 *
 * Iterates oldest-first so that when publishedAt is absent, createdAt insertion
 * timestamps reflect chronological order.
 */
async function syncFeedItems(
  subscriptionId: string,
  items: ReturnType<typeof parseFeedXml>['items'],
): Promise<number> {
  const db = await getDb()

  const existing = await db.getAllFromIndex('articles', 'by-subscription', subscriptionId)

  // Build lookup maps for fast deduplication.
  // Priority: link → feedItemId → normalized title (same subscription).
  const linkToId = new Map<string, string>(existing.map((a) => [a.link, a.id]))
  const feedItemIdToId = new Map<string, string>(existing.filter((a) => a.feedItemId).map((a) => [a.feedItemId, a.id]))
  const titleToId = new Map<string, string>()
  for (const article of existing) {
    const normalizedTitle = normalizeArticleTitle(article.title)
    if (normalizedTitle && !titleToId.has(normalizedTitle)) {
      titleToId.set(normalizedTitle, article.id)
    }
  }

  let inserted = 0

  // RSS XML lists newest first; iterate oldest-first so createdAt is monotonic.
  for (const item of [...items].reverse()) {
    const normalizedTitle = normalizeArticleTitle(item.title)
    const alreadyExists =
      linkToId.has(item.link) ||
      feedItemIdToId.has(item.feedItemId) ||
      titleToId.has(normalizedTitle)

    if (alreadyExists) continue

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
    linkToId.set(article.link, article.id)
    if (article.feedItemId) feedItemIdToId.set(article.feedItemId, article.id)
    if (normalizedTitle) titleToId.set(normalizedTitle, article.id)
    inserted += 1
  }

  return inserted
}
