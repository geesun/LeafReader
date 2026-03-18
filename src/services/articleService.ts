import DOMPurify from 'dompurify'

import { getDb } from '@/services/db'
import { clearOfflineAssets, removeArticleOffline, saveArticleOffline } from '@/services/offlineService'
import { extractFullText, summarizeArticle, translateArticle } from '@/services/workerClient'
import { isNative, nativeExtractFullText } from '@/services/nativeHttp'
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
  // On Android native, extract full text locally using Readability (no Worker needed).
  const fullText = isNative()
    ? await nativeExtractFullText(article.link)
    : await extractFullText(workerBaseUrl, article.link)
  const updated: ArticleRecord = {
    ...article,
    fullContentHtml: fullText.contentHtml,
    contentText: article.contentText || fullText.textContent,
    contentSource: 'fulltext',
    hasFullContent: true,
    leadImageUrl: fullText.leadImageUrl || article.leadImageUrl,
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

  const result = await summarizeArticle(workerBaseUrl, {
    title: article.title,
    url: article.link,
    content,
    length,
    provider
  })

  const updated: ArticleRecord = {
    ...article,
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

  const result = await translateArticle(workerBaseUrl, {
    title: article.title,
    url: article.link,
    blocks: payloadBlocks,
    provider
  })

  const bilingualBlocks = createBilingualParagraphs(payloadBlocks, result.translatedBlocks)

  if (!bilingualBlocks.length) {
    throw new Error('AI 未返回可用的翻译结果')
  }

  const updated: ArticleRecord = {
    ...article,
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
