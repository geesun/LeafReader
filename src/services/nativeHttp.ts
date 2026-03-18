/**
 * nativeHttp.ts
 *
 * On Android (Capacitor native), browser fetch() is subject to CORS restrictions
 * because it runs inside a WebView. CapacitorHttp bypasses the WebView networking
 * stack and issues requests via the native Android HTTP client, which has no CORS.
 *
 * On web, we fall back to regular fetch() (but the caller should route through
 * the Worker proxy instead, since CORS applies there).
 */

import { Capacitor, CapacitorHttp } from '@capacitor/core'
import { Readability } from '@mozilla/readability'
import type { FullTextResult } from '@/types/models'

export function isNative(): boolean {
  return Capacitor.isNativePlatform()
}

/**
 * Fetch a URL as text using the native HTTP client (Android) or regular fetch (web).
 */
export async function nativeFetchText(url: string): Promise<string> {
  if (isNative()) {
    const response = await CapacitorHttp.get({ url })
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`HTTP ${response.status}`)
    }
    // CapacitorHttp returns data as string when the content-type is text/*
    return typeof response.data === 'string' ? response.data : JSON.stringify(response.data)
  }

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  return response.text()
}

/**
 * Fetch a URL and extract its main article content using Mozilla Readability.
 * Only used on native (Android) — on web this is done server-side by the Worker.
 */
export async function nativeExtractFullText(articleUrl: string): Promise<FullTextResult> {
  const html = await nativeFetchText(articleUrl)

  // linkedom is already in our dependencies and works in non-browser environments.
  // On native the WebView does have a DOM, but DOMParser can't handle cross-origin
  // documents reliably for Readability, so we parse with linkedom instead.
  const { parseHTML } = await import('linkedom')
  const { document } = parseHTML(html)

  // Resolve relative URLs before passing to Readability
  const base = document.createElement('base')
  base.setAttribute('href', articleUrl)
  document.head?.appendChild(base)

  const reader = new Readability(document as unknown as Document)
  const article = reader.parse()

  if (!article) {
    throw new Error('无法提取文章正文')
  }

  // Extract lead image: first <img> inside the article content
  let leadImageUrl: string | undefined
  try {
    const { document: contentDoc } = parseHTML(article.content ?? '')
    const firstImg = contentDoc.querySelector('img')
    const src = firstImg?.getAttribute('src')
    if (src) {
      leadImageUrl = src.startsWith('http') ? src : new URL(src, articleUrl).href
    }
  } catch {
    // ignore lead image extraction errors
  }

  return {
    url: articleUrl,
    finalUrl: articleUrl,
    title: article.title ?? undefined,
    byline: article.byline ?? undefined,
    siteName: article.siteName ?? undefined,
    excerpt: article.excerpt ?? undefined,
    contentHtml: article.content ?? '',
    textContent: article.textContent ?? undefined,
    leadImageUrl
  }
}

/**
 * Fetch a binary asset (image, etc.) natively and return it as a Blob URL.
 * On native we use CapacitorHttp; on web we use fetch (through the worker proxy).
 */
export async function nativeFetchAssetAsBlob(url: string): Promise<Blob> {
  if (isNative()) {
    const response = await CapacitorHttp.get({
      url,
      responseType: 'blob'
    })
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`HTTP ${response.status}`)
    }
    // CapacitorHttp returns blob data as a base64 string when responseType='blob'
    const base64 = response.data as string
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    const contentType = (response.headers['content-type'] ?? response.headers['Content-Type'] ?? 'application/octet-stream') as string
    return new Blob([bytes], { type: contentType })
  }

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  return response.blob()
}
