import type { FullTextResult } from '@/types/models'
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
