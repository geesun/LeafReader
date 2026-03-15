import type { ArticleSummaryRequest, ArticleSummaryResult, FullTextResult } from '@/types/models'
import { normalizeBaseUrl } from '@/utils/url'

function ensureBaseUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl)
  if (!normalized) {
    throw new Error('请先在设置中配置 Worker 地址')
  }

  return normalized
}

export function createWorkerUrl(baseUrl: string, path: 'rss' | 'extract' | 'asset', targetUrl: string): string {
  const normalized = ensureBaseUrl(baseUrl)
  return `${normalized}/${path}?url=${encodeURIComponent(targetUrl)}`
}

export function createWorkerEndpointUrl(baseUrl: string, path: 'summarize'): string {
  const normalized = ensureBaseUrl(baseUrl)
  return `${normalized}/${path}`
}

export async function fetchFeedXml(baseUrl: string, feedUrl: string): Promise<string> {
  const response = await fetch(createWorkerUrl(baseUrl, 'rss', feedUrl))
  if (!response.ok) {
    throw new Error(`抓取订阅失败：${response.status}`)
  }

  return response.text()
}

export async function extractFullText(baseUrl: string, articleUrl: string): Promise<FullTextResult> {
  const response = await fetch(createWorkerUrl(baseUrl, 'extract', articleUrl))
  if (!response.ok) {
    throw new Error(`全文提取失败：${response.status}`)
  }

  return response.json() as Promise<FullTextResult>
}

export async function fetchAsset(baseUrl: string, assetUrl: string): Promise<Response> {
  const response = await fetch(createWorkerUrl(baseUrl, 'asset', assetUrl))
  if (!response.ok) {
    throw new Error(`资源下载失败：${response.status}`)
  }

  return response
}

export async function summarizeArticle(baseUrl: string, payload: ArticleSummaryRequest): Promise<ArticleSummaryResult> {
  const response = await fetch(createWorkerEndpointUrl(baseUrl, 'summarize'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  })

  if (!response.ok) {
    let message = `AI 总结失败：${response.status}`

    try {
      const error = await response.json() as { message?: string }
      if (error.message) {
        message = error.message
      }
    } catch {
    }

    throw new Error(message)
  }

  return response.json() as Promise<ArticleSummaryResult>
}
