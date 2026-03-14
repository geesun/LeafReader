import { getDb } from '@/services/db'
import { fetchAsset, extractFullText, createWorkerUrl } from '@/services/workerClient'
import type { ArticleRecord, FullTextResult, OfflineAssetRecord } from '@/types/models'
import { createId } from '@/utils/id'
import { toAbsoluteUrl } from '@/utils/url'

const OFFLINE_CACHE = 'neoreader-offline-assets'

function normalizeArticleHtml(html: string, baseUrl: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')

  doc.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src')
    if (!src) return
    img.setAttribute('src', toAbsoluteUrl(src, baseUrl))
    img.setAttribute('loading', 'lazy')
  })

  doc.querySelectorAll('a').forEach((anchor) => {
    const href = anchor.getAttribute('href')
    if (!href) return
    anchor.setAttribute('href', toAbsoluteUrl(href, baseUrl))
    anchor.setAttribute('target', '_blank')
    anchor.setAttribute('rel', 'noopener noreferrer')
  })

  return doc.body.innerHTML
}

export function proxyImagesForOnlineReading(html: string, articleLink: string, workerBaseUrl: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')

  doc.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src')
    if (!src) return
    const absolute = toAbsoluteUrl(src, articleLink)
    img.setAttribute('src', createWorkerUrl(workerBaseUrl, 'asset', absolute))
    img.setAttribute('loading', 'lazy')
  })

  doc.querySelectorAll('a').forEach((anchor) => {
    const href = anchor.getAttribute('href')
    if (!href) return
    anchor.setAttribute('href', toAbsoluteUrl(href, articleLink))
    anchor.setAttribute('target', '_blank')
    anchor.setAttribute('rel', 'noopener noreferrer')
  })

  return doc.body.innerHTML
}

function rewriteArticleHtml(html: string, replacements: Map<string, string>): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')

  doc.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src')
    if (!src) return

    const replacement = replacements.get(src)
    if (replacement) {
      img.setAttribute('src', replacement)
    }

    img.setAttribute('loading', 'lazy')
  })

  return doc.body.innerHTML
}

async function ensureContent(article: ArticleRecord, workerBaseUrl: string): Promise<{ article: ArticleRecord; html: string }> {
  if (article.fullContentHtml) {
    return {
      article,
      html: normalizeArticleHtml(article.fullContentHtml, article.link)
    }
  }

  if (article.feedContentHtml) {
    return {
      article,
      html: normalizeArticleHtml(article.feedContentHtml, article.link)
    }
  }

  const fullText: FullTextResult = await extractFullText(workerBaseUrl, article.link)
  const updatedArticle: ArticleRecord = {
    ...article,
    fullContentHtml: fullText.contentHtml,
    contentText: fullText.textContent || article.contentText,
    contentSource: 'fulltext',
    hasFullContent: true,
    leadImageUrl: fullText.leadImageUrl || article.leadImageUrl,
    updatedAt: new Date().toISOString()
  }

  const db = await getDb()
  await db.put('articles', updatedArticle)

  return {
    article: updatedArticle,
    html: normalizeArticleHtml(fullText.contentHtml, fullText.finalUrl || article.link)
  }
}

export async function saveArticleOffline(article: ArticleRecord, workerBaseUrl: string): Promise<ArticleRecord> {
  const db = await getDb()
  const { article: sourceArticle, html } = await ensureContent(article, workerBaseUrl)
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const cache = await caches.open(OFFLINE_CACHE)
  const replacements = new Map<string, string>()

  await removeArticleOffline(sourceArticle)

  for (const img of [...doc.querySelectorAll('img')]) {
    const src = img.getAttribute('src')
    if (!src) continue

    const absolute = toAbsoluteUrl(src, sourceArticle.link)
    const assetId = createId('asset')
    const localPath = `/__offline_asset__/${assetId}`

    try {
      const response = await fetchAsset(workerBaseUrl, absolute)
      await cache.put(localPath, response.clone())

      const assetRecord: OfflineAssetRecord = {
        id: assetId,
        articleId: sourceArticle.id,
        originalUrl: absolute,
        localPath,
        mimeType: response.headers.get('content-type') ?? 'application/octet-stream',
        byteSize: Number(response.headers.get('content-length') ?? 0),
        status: 'success',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }

      await db.put('offline_assets', assetRecord)
      replacements.set(src, localPath)
      replacements.set(absolute, localPath)
    } catch {
      const failedRecord: OfflineAssetRecord = {
        id: assetId,
        articleId: sourceArticle.id,
        originalUrl: absolute,
        localPath,
        mimeType: 'application/octet-stream',
        byteSize: 0,
        status: 'failed',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }

      await db.put('offline_assets', failedRecord)
    }
  }

  const updatedArticle: ArticleRecord = {
    ...sourceArticle,
    offlineContentHtml: rewriteArticleHtml(html, replacements),
    isOfflineSaved: true,
    offlineSavedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }

  await db.put('articles', updatedArticle)
  return updatedArticle
}

export async function removeArticleOffline(article: ArticleRecord): Promise<ArticleRecord> {
  const db = await getDb()
  const cache = await caches.open(OFFLINE_CACHE)
  const assets = await db.getAllFromIndex('offline_assets', 'by-article', article.id)

  for (const asset of assets) {
    await cache.delete(asset.localPath)
    await db.delete('offline_assets', asset.id)
  }

  const updatedArticle: ArticleRecord = {
    ...article,
    offlineContentHtml: undefined,
    isOfflineSaved: false,
    offlineSavedAt: undefined,
    updatedAt: new Date().toISOString()
  }

  await db.put('articles', updatedArticle)
  return updatedArticle
}

export async function clearOfflineAssets(): Promise<void> {
  const db = await getDb()
  const cache = await caches.open(OFFLINE_CACHE)
  const articles = await db.getAll('articles')
  const offlineAssets = await db.getAll('offline_assets')

  for (const asset of offlineAssets) {
    await cache.delete(asset.localPath)
    await db.delete('offline_assets', asset.id)
  }

  const tx = db.transaction('articles', 'readwrite')
  for (const article of articles) {
    await tx.store.put({
      ...article,
      offlineContentHtml: undefined,
      isOfflineSaved: false,
      offlineSavedAt: undefined,
      updatedAt: new Date().toISOString()
    })
  }
  await tx.done
}
