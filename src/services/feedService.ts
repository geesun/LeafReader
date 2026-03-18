import { getDb } from '@/services/db'
import { fetchFeedXml } from '@/services/workerClient'
import { parseFeedXml } from '@/services/feedParser'
import type { ArticleRecord, SubscriptionRecord } from '@/types/models'

import { createId } from '@/utils/id'
import { extractLeadImageFromHtml } from '@/utils/text'
import { buildSubscriptionIconCandidates, shouldUseTextOnlySubscriptionIcon } from '@/utils/url'

const MAX_ARTICLE_COUNT = 500
let trimInProgress = false

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
  await trimArticles(db)
  return subscription
}

export async function refreshSubscription(subscription: SubscriptionRecord, workerBaseUrl: string): Promise<number> {
  const xml = await fetchFeedXml(workerBaseUrl, subscription.feedUrl)
  const parsed = parseFeedXml(xml)
  const inserted = await syncFeedItems(subscription.id, parsed.items)
  const db = await getDb()
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
  return inserted
}

export async function trimArticlesAfterRefresh(): Promise<void> {
  const db = await getDb()
  await trimArticles(db)
}

/**
 * Sync the latest feed items into the articles store.
 *
 * Algorithm:
 * 1. Mark ALL existing articles for this subscription as isDeletable=true.
 * 2. For each item returned by the feed XML:
 *    - If an article with the same link already exists → set isDeletable=false
 *      (keep all user state: isRead, isFavorite, etc. untouched).
 *    - If no article exists → insert a new record with isDeletable=false.
 * 3. Return the number of newly inserted articles.
 *
 * After this call, any article whose isDeletable is still true was absent from
 * the latest feed response and is a candidate for trimming.
 */
async function syncFeedItems(
  subscriptionId: string,
  items: ReturnType<typeof parseFeedXml>['items'],
): Promise<number> {
  const db = await getDb()

  // Step 1: mark all articles for this subscription as deletable.
  const existing = await db.getAllFromIndex('articles', 'by-subscription', subscriptionId)
  for (const article of existing) {
    if (!article.isDeletable) {
      await db.put('articles', { ...article, isDeletable: true, updatedAt: new Date().toISOString() })
    }
  }

  // Build lookup maps for fast matching.
  // Try link first, then stable feedItemId, then normalized title within the
  // same subscription as a final fallback for feeds that rewrite URLs.
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

  // Step 2: upsert each item from the feed.
  // RSS XML typically lists newest items first, so iterate in reverse order
  // (oldest first). This ensures that when publishedAt is absent, the
  // createdAt insertion timestamp naturally reflects chronological order:
  // older articles get a smaller createdAt, newer ones get a larger createdAt.
  for (const item of [...items].reverse()) {
    const normalizedTitle = normalizeArticleTitle(item.title)
    const existingId = linkToId.get(item.link) ?? feedItemIdToId.get(item.feedItemId) ?? titleToId.get(normalizedTitle)

    if (existingId) {
      // Article already in DB — only clear the deletable flag. Do not overwrite
      // any existing article fields so user state and previously stored content
      // remain untouched.
      const record = await db.get('articles', existingId)
      if (record?.isDeletable) {
        await db.put('articles', {
          ...record,
          isDeletable: false,
          updatedAt: new Date().toISOString()
        })
      }
    } else {
      // New article — insert it.
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
        isDeletable: false,
        hasFullContent: false,
        isOfflineSaved: false,
        leadImageUrl: extractLeadImageFromHtml(item.contentHtml, item.link)
      }
      await db.put('articles', article)
      inserted += 1
    }
  }

  return inserted
}

/**
 * Remove articles that are marked isDeletable=true (absent from the latest feed
 * response) when the total article count exceeds MAX_ARTICLE_COUNT.
 *
 * Eviction order: oldest createdAt first (insertion order), skipping favorites.
 * If there are no deletable articles, nothing is deleted even if the total
 * exceeds MAX_ARTICLE_COUNT (feed-active articles are never force-evicted).
 */
async function trimArticles(db: Awaited<ReturnType<typeof getDb>>): Promise<void> {
  // Prevent concurrent trim runs (e.g. from parallel refreshAll workers).
  if (trimInProgress) return
  trimInProgress = true
  try {
    const articles = await db.getAll('articles')
    if (articles.length <= MAX_ARTICLE_COUNT) return

    // Candidates: isDeletable=true and not favorited, sorted oldest-first.
    const candidates = articles
      .filter(a => a.isDeletable && !a.isFavorite)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))

    if (!candidates.length) return

    // How many do we need to remove?
    const toRemoveCount = articles.length - MAX_ARTICLE_COUNT
    const expired = candidates.slice(0, toRemoveCount)

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
  } finally {
    trimInProgress = false
  }
}
