import DOMPurify from 'dompurify'

import { getDb } from '@/services/db'
import { clearOfflineAssets, removeArticleOffline, saveArticleOffline } from '@/services/offlineService'
import { extractFullText, summarizeArticle, translateArticle } from '@/services/workerClient'
import { isNative, nativeExtractFullText, nativeSummarizeArticle, nativeTranslateArticle } from '@/services/nativeHttp'
import { loadSettings } from '@/services/settings'
import type { ArticleRecord, BilingualParagraph, SummaryLength, SummaryProvider, TranslationBlockPayload } from '@/types/models'
import { compareArticlesByRecency } from '@/utils/articleTime'
import { compactTranslationBlocks, extractParagraphsFromHtml, looksLikeEnglishArticle, splitTextIntoParagraphBlocks, stripHtml } from '@/utils/text'

function normalizeSummarySource(article: ArticleRecord): string {
  const source = article.fullContentHtml || article.offlineContentHtml || article.feedContentHtml || article.contentText || article.summary || ''

  return stripHtml(source)
}

function normalizeTranslationSource(article: ArticleRecord): string {
  return stripHtml(article.fullContentHtml || article.offlineContentHtml || article.feedContentHtml || article.contentText || article.summary || '')
}

function getTranslationHtmlSource(article: ArticleRecord): string | undefined {
  return article.fullContentHtml || article.offlineContentHtml || article.feedContentHtml
}

export function canTranslateArticle(article: ArticleRecord): boolean {
  return looksLikeEnglishArticle(normalizeTranslationSource(article))
}

export function buildTranslationBlocks(article: ArticleRecord): string[] {
  const htmlSource = getTranslationHtmlSource(article)
  const htmlParagraphs = extractParagraphsFromHtml(htmlSource)

  if (htmlParagraphs.length) {
    return compactTranslationBlocks(htmlParagraphs)
  }

  return compactTranslationBlocks(splitTextIntoParagraphBlocks(normalizeTranslationSource(article)))
}

function createTranslationPayload(blocks: string[]): TranslationBlockPayload[] {
  return blocks.map((text, index) => ({
    id: `block-${index + 1}`,
    text
  }))
}

export function createBilingualParagraphs(
  sourceBlocks: TranslationBlockPayload[],
  translatedBlocks: TranslationBlockPayload[]
): BilingualParagraph[] {
  const translatedMap = new Map(translatedBlocks.map((block) => [block.id, block.text.trim()]))

  return sourceBlocks.reduce<BilingualParagraph[]>((paragraphs, sourceBlock) => {
    const sourceText = sourceBlock.text.trim()
    const translatedText = translatedMap.get(sourceBlock.id)?.trim()

    if (!sourceText || !translatedText) {
      return paragraphs
    }

    paragraphs.push({
      sourceText,
      translatedText
    })

    return paragraphs
  }, [])
}

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

/**
 * 分页加载文章，使用 IndexedDB cursor 按发布时间倒序遍历
 * @param offset 跳过的文章数
 * @param limit 返回的文章数
 * @param subscriptionId 可选，按订阅源过滤
 */
export async function listArticlesPaginated(
  offset: number,
  limit: number,
  subscriptionId?: string
): Promise<{ articles: ArticleRecord[]; hasMore: boolean }> {
  const db = await getDb()
  const tx = db.transaction('articles', 'readonly')

  // 收集所有文章，然后排序（IndexedDB 的 by-published 索引是字符串排序，不完全准确）
  // 为了保证与 compareArticlesByRecency 一致，我们仍需在内存中排序
  // 但只在首次加载时获取全部 ID 和排序键，后续分页基于此
  let articles: ArticleRecord[]

  if (subscriptionId) {
    articles = await tx.store.index('by-subscription').getAll(subscriptionId)
  } else {
    articles = await tx.store.getAll()
  }

  await tx.done

  // 按时间排序（与 listArticles 保持一致）
  articles.sort(compareArticlesByRecency)

  // 分页
  const paginated = articles.slice(offset, offset + limit)
  const hasMore = offset + limit < articles.length

  return { articles: paginated, hasMore }
}

/**
 * 获取文章总数
 */
export async function countArticles(subscriptionId?: string): Promise<number> {
  const db = await getDb()
  if (subscriptionId) {
    return db.countFromIndex('articles', 'by-subscription', subscriptionId)
  }
  return db.count('articles')
}

/**
 * 订阅统计信息
 */
export interface SubscriptionStats {
  subscriptionId: string
  totalCount: number
  unreadCount: number
  latestTimestamp: number
  latestArticleUrl: string
}

/**
 * 获取所有订阅的统计信息（不加载文章内容到内存）
 * 使用 IndexedDB cursor 遍历，只提取必要字段进行聚合
 */
export async function getSubscriptionStats(): Promise<Map<string, SubscriptionStats>> {
  const db = await getDb()
  const tx = db.transaction('articles', 'readonly')

  const statsMap = new Map<string, SubscriptionStats>()

  // 使用 cursor 遍历所有文章，只提取统计所需的字段
  let cursor = await tx.store.openCursor()

  while (cursor) {
    const article = cursor.value
    const subId = article.subscriptionId

    // 计算文章时间戳（与 getArticleSortTimestamp 逻辑一致）
    const timestamp = new Date(article.publishedAt || article.createdAt).getTime()

    let stats = statsMap.get(subId)
    if (!stats) {
      stats = {
        subscriptionId: subId,
        totalCount: 0,
        unreadCount: 0,
        latestTimestamp: 0,
        latestArticleUrl: ''
      }
      statsMap.set(subId, stats)
    }

    stats.totalCount++
    if (!article.isRead) {
      stats.unreadCount++
    }

    if (timestamp > stats.latestTimestamp) {
      stats.latestTimestamp = timestamp
      stats.latestArticleUrl = article.link
    }

    cursor = await cursor.continue()
  }

  await tx.done
  return statsMap
}

/**
 * 获取文章总数（所有订阅的文章总数）
 */
export async function getTotalArticleCount(): Promise<number> {
  const db = await getDb()
  return db.count('articles')
}

/**
 * 直接使用索引查询收藏文章，避免全量加载
 */
export async function listFavoriteArticles(): Promise<ArticleRecord[]> {
  const db = await getDb()
  // isFavorite 存储为 boolean，但索引值为 1 (true) 或 0 (false)
  // 使用 getAllFromIndex 直接查询 isFavorite = true 的文章
  const tx = db.transaction('articles', 'readonly')
  const index = tx.store.index('by-favorite')

  const articles: ArticleRecord[] = []
  let cursor = await index.openCursor(IDBKeyRange.only(1))

  while (cursor) {
    articles.push(cursor.value)
    cursor = await cursor.continue()
  }

  await tx.done

  return articles.sort(compareArticlesByRecency)
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
  // Re-read from DB so we never spread a stale in-memory snapshot back.
  const db = await getDb()
  const fresh = (await db.get('articles', article.id)) ?? article
  const updated = {
    ...fresh,
    isRead,
    readAt: isRead ? (fresh.readAt ?? new Date().toISOString()) : undefined,
    updatedAt: new Date().toISOString()
  }
  await updateArticle(updated)
  return updated
}

export async function toggleFavorite(article: ArticleRecord): Promise<ArticleRecord> {
  // Re-read from DB so we never spread a stale in-memory snapshot back.
  const db = await getDb()
  const fresh = (await db.get('articles', article.id)) ?? article
  const nextFavorite = !fresh.isFavorite
  const updated = {
    ...fresh,
    isFavorite: nextFavorite,
    favoriteAt: nextFavorite ? new Date().toISOString() : undefined,
    updatedAt: new Date().toISOString()
  }
  await updateArticle(updated)
  return updated
}

export async function fetchArticleFullText(article: ArticleRecord, workerBaseUrl: string): Promise<ArticleRecord> {
  // On Android native, extract full text locally using Readability (no Worker needed).
  const fullText = isNative()
    ? await nativeExtractFullText(article.link)
    : await extractFullText(workerBaseUrl, article.link)

  // Re-read from DB after the async network call to avoid overwriting concurrent
  // changes (e.g. isRead / isFavorite set while the request was in-flight).
  const db = await getDb()
  const fresh = (await db.get('articles', article.id)) ?? article
  const updated: ArticleRecord = {
    ...fresh,
    fullContentHtml: fullText.contentHtml,
    contentText: fresh.contentText || fullText.textContent,
    contentSource: 'fulltext',
    hasFullContent: true,
    leadImageUrl: fullText.leadImageUrl || fresh.leadImageUrl,
    updatedAt: new Date().toISOString()
  }

  await updateArticle(updated)
  return updated
}

export async function generateArticleSummary(
  article: ArticleRecord,
  workerBaseUrl: string,
  forceRefresh = false,
  length: SummaryLength = 'medium',
  provider: SummaryProvider = 'google'
): Promise<ArticleRecord> {
  if (!forceRefresh && article.aiSummaryText) {
    return article
  }

  const content = normalizeSummarySource(article)
  if (!content) {
    throw new Error('当前文章没有可用于总结的正文内容')
  }

  const result = isNative()
    ? await nativeSummarizeArticle(loadSettings().githubCopilotApiKey, {
        title: article.title,
        url: article.link,
        content,
        length
      })
    : await summarizeArticle(workerBaseUrl, {
        title: article.title,
        url: article.link,
        content,
        length,
        provider
      })

  // Re-read from DB after the async AI call to avoid overwriting concurrent changes.
  const db = await getDb()
  const fresh = (await db.get('articles', article.id)) ?? article
  const updated: ArticleRecord = {
    ...fresh,
    aiSummaryText: result.summaryText,
    aiSummaryModel: result.model,
    aiSummaryGeneratedAt: result.generatedAt,
    updatedAt: new Date().toISOString()
  }

  await updateArticle(updated)
  return updated
}

export async function generateArticleTranslation(
  article: ArticleRecord,
  workerBaseUrl: string,
  forceRefresh = false,
  provider: SummaryProvider = 'google'
): Promise<ArticleRecord> {
  const hasParagraphTranslation = article.aiTranslationFormat === 'paragraph-v1' && article.aiTranslationBlocks?.length

  if (!forceRefresh && hasParagraphTranslation) {
    return article
  }

  if (!canTranslateArticle(article)) {
    throw new Error('当前文章未检测为英文内容')
  }

  const blocks = buildTranslationBlocks(article)
  if (!blocks.length) {
    throw new Error('当前文章没有可用于翻译的正文内容')
  }

  const payloadBlocks = createTranslationPayload(blocks)

  const result = isNative()
    ? await nativeTranslateArticle(loadSettings().githubCopilotApiKey, {
        title: article.title,
        url: article.link,
        blocks: payloadBlocks
      })
    : await translateArticle(workerBaseUrl, {
        title: article.title,
        url: article.link,
        blocks: payloadBlocks,
        provider
      })

  const bilingualBlocks = createBilingualParagraphs(payloadBlocks, result.translatedBlocks)

  if (!bilingualBlocks.length) {
    throw new Error('AI 未返回可用的翻译结果')
  }

  // Re-read from DB after the async AI call to avoid overwriting concurrent changes.
  const db = await getDb()
  const fresh = (await db.get('articles', article.id)) ?? article
  const updated: ArticleRecord = {
    ...fresh,
    aiTranslationBlocks: bilingualBlocks,
    aiTranslationModel: result.model,
    aiTranslationGeneratedAt: result.generatedAt,
    aiTranslationFormat: 'paragraph-v1',
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

/**
 * 标记筛选条件下的所有未读文章为已读
 * @param subscriptionId 可选，按订阅源过滤
 * @param filter 筛选条件：'all' | 'unread' | 'favorites'
 * @returns 标记的文章数量
 */
export async function markFilteredArticlesRead(
  subscriptionId?: string,
  filter?: 'all' | 'unread' | 'favorites'
): Promise<number> {
  const db = await getDb()
  const tx = db.transaction('articles', 'readwrite')

  let cursor
  if (subscriptionId) {
    cursor = await tx.store.index('by-subscription').openCursor(subscriptionId)
  } else {
    cursor = await tx.store.openCursor()
  }

  let count = 0
  const now = new Date().toISOString()

  while (cursor) {
    const article = cursor.value

    // 应用筛选条件
    const matchesFilter =
      filter === 'all' || !filter
        ? true
        : filter === 'unread'
          ? !article.isRead
          : article.isFavorite

    if (matchesFilter && !article.isRead) {
      await cursor.update({
        ...article,
        isRead: true,
        readAt: article.readAt ?? now,
        updatedAt: now
      })
      count++
    }

    cursor = await cursor.continue()
  }

  await tx.done
  return count
}
