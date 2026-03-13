import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization'
}

const PRIVATE_HOSTS = ['localhost', '127.0.0.1']
const MAX_XML_BYTES = 3 * 1024 * 1024
const MAX_HTML_BYTES = 5 * 1024 * 1024
const MAX_ASSET_BYTES = 10 * 1024 * 1024

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...CORS_HEADERS
    }
  })
}

function withCors(headers: Headers): Headers {
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    headers.set(key, value)
  }

  return headers
}

function isPrivateTarget(url: URL): boolean {
  if (PRIVATE_HOSTS.includes(url.hostname)) return true
  return /^(10\.|127\.|169\.254\.|172\.(1[6-9]|2\d|3[0-1])\.|192\.168\.)/.test(url.hostname)
}

function assertRemoteUrl(rawUrl: string | null): URL {
  if (!rawUrl) {
    throw new Error('Missing url query parameter')
  }

  const parsed = new URL(rawUrl)
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only http and https URLs are allowed')
  }
  if (isPrivateTarget(parsed)) {
    throw new Error('Private network targets are blocked')
  }

  return parsed
}

function assertContentLength(response: Response, maxBytes: number): void {
  const contentLength = Number(response.headers.get('content-length') ?? 0)
  if (contentLength && contentLength > maxBytes) {
    throw new Error(`Response too large: ${contentLength}`)
  }
}

function normalizeContentUrls(html: string, baseUrl: string): { html: string; leadImageUrl?: string } {
  const { document } = parseHTML(html)

  document.querySelectorAll('img').forEach((img: Element) => {
    const src = img.getAttribute('src')
    if (!src) return
    img.setAttribute('src', new URL(src, baseUrl).toString())
    img.setAttribute('loading', 'lazy')
  })

  document.querySelectorAll('a').forEach((anchor: Element) => {
    const href = anchor.getAttribute('href')
    if (!href) return
    anchor.setAttribute('href', new URL(href, baseUrl).toString())
    anchor.setAttribute('target', '_blank')
    anchor.setAttribute('rel', 'noopener noreferrer')
  })

  const leadImageUrl = document.querySelector('img')?.getAttribute('src') ?? undefined

  return {
    html: document.body.innerHTML,
    leadImageUrl
  }
}

async function proxyRequest(targetUrl: URL, maxBytes: number): Promise<Response> {
  const response = await fetch(targetUrl.toString(), {
    redirect: 'follow',
    headers: {
      'User-Agent': 'LeafReaderWorker/1.0'
    }
  })

  assertContentLength(response, maxBytes)

  const headers = withCors(new Headers(response.headers))
  return new Response(response.body, {
    status: response.status,
    headers
  })
}

async function extractArticle(targetUrl: URL): Promise<Response> {
  const response = await fetch(targetUrl.toString(), {
    redirect: 'follow',
    headers: {
      'User-Agent': 'LeafReaderWorker/1.0'
    }
  })

  if (!response.ok) {
    return json({ error: 'FETCH_FAILED', message: `Failed with ${response.status}` }, response.status)
  }

  assertContentLength(response, MAX_HTML_BYTES)

  const html = await response.text()
  const finalUrl = response.url || targetUrl.toString()
  const { document } = parseHTML(html)
  const reader = new Readability(document, {
    keepClasses: false
  })
  const article = reader.parse()

  if (!article?.content) {
    return json({ error: 'EXTRACT_FAILED', message: 'Unable to extract article body' }, 422)
  }

  const normalized = normalizeContentUrls(article.content, finalUrl)

  return json({
    url: targetUrl.toString(),
    finalUrl,
    title: article.title,
    byline: article.byline,
    siteName: article.siteName,
    excerpt: article.excerpt,
    publishedTime: article.publishedTime,
    lang: article.lang,
    contentHtml: normalized.html,
    textContent: article.textContent,
    leadImageUrl: normalized.leadImageUrl
  })
}

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: CORS_HEADERS
      })
    }

    if (request.method !== 'GET') {
      return json({ error: 'METHOD_NOT_ALLOWED' }, 405)
    }

    const url = new URL(request.url)

    try {
      if (url.pathname === '/rss') {
        return proxyRequest(assertRemoteUrl(url.searchParams.get('url')), MAX_XML_BYTES)
      }

      if (url.pathname === '/asset') {
        return proxyRequest(assertRemoteUrl(url.searchParams.get('url')), MAX_ASSET_BYTES)
      }

      if (url.pathname === '/extract') {
        return extractArticle(assertRemoteUrl(url.searchParams.get('url')))
      }

      return json({ ok: true, service: 'leafreader-worker' })
    } catch (error) {
      return json(
        {
          error: 'BAD_REQUEST',
          message: error instanceof Error ? error.message : 'Unknown error'
        },
        400
      )
    }
  }
}
