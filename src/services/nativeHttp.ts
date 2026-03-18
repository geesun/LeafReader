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
import type { ArticleSummaryRequest, ArticleSummaryResult, ArticleTranslationRequest, ArticleTranslationResult, FullTextResult } from '@/types/models'

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

// ---------------------------------------------------------------------------
// AI helpers — prompt builders (mirrors worker/src/index.ts)
// ---------------------------------------------------------------------------

const MAX_SUMMARY_CHARS = 24000
const MAX_TRANSLATION_BLOCKS = 32

function getSummaryLengthInstruction(length: ArticleSummaryRequest['length']): string {
  if (length === 'short') return '1. 输出控制在 120 到 180 个汉字左右，内容要完整，不要过短。'
  if (length === 'long') return '1. 输出控制在 320 到 420 个汉字左右，信息要充分，不能只写几句空泛概括。'
  return '1. 输出控制在 220 到 320 个汉字左右，信息要完整，不能明显短于 200 字。'
}

function getSummaryCompressionInstruction(length: ArticleSummaryRequest['length']): string {
  if (length === 'short') return '如果初稿偏长，可以压缩，但仍需保留背景、事实和结论，不能只剩一句话。'
  if (length === 'long') return '可以稍微展开背景和结论，但仍然保持紧凑，不要写成长文。'
  return '如果初稿偏长，请压缩到标准摘要长度；如果过短，请补足关键背景和结论。'
}

function buildSummaryPrompt(req: ArticleSummaryRequest): string {
  const title = req.title?.trim() || '未命名文章'
  const url = req.url?.trim() || ''
  const content = (req.content ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_SUMMARY_CHARS)
  const length = req.length ?? 'medium'
  return [
    '请你用简体中文为下面这篇文章写一段适合阅读器展示的摘要。',
    '要求：',
    getSummaryLengthInstruction(length),
    '2. 忠于原文，不要编造没有出现的信息。',
    '3. 优先提炼背景、核心事实、关键观点和结论。',
    '4. 不要写"本文主要讲了""以下是摘要"这类套话。',
    '5. 只返回纯文本摘要，不要 Markdown，不要标题。',
    `6. ${getSummaryCompressionInstruction(length)}`,
    '',
    `文章标题：${title}`,
    url ? `文章链接：${url}` : '',
    '文章正文：',
    content
  ].filter(Boolean).join('\n')
}

function buildTranslationPrompt(req: ArticleTranslationRequest): string {
  const title = req.title?.trim() || 'Untitled article'
  const url = req.url?.trim() || ''
  const blocks = (req.blocks ?? []).slice(0, MAX_TRANSLATION_BLOCKS)
  return [
    '请把下面的英文文章按段翻译成自然、准确的简体中文。',
    '要求：',
    '1. 必须严格按照输入段落顺序逐段翻译，不能合并、拆分、遗漏。',
    '2. 只翻译英文正文，不要添加解释、标题、编号或任何额外说明。',
    '3. 保留专有名词、产品名、数字和引用的准确性。',
    '4. 输出必须是 JSON 对象，格式为 {"translatedBlocks":[{"id":"block-1","text":"第1段译文"}]}。',
    '5. 每个 translatedBlocks 项都必须保留输入里的 id，且数量必须与输入 blocks 完全一致。',
    '',
    `文章标题：${title}`,
    url ? `文章链接：${url}` : '',
    '输入 blocks：',
    JSON.stringify({ blocks }, null, 0)
  ].filter(Boolean).join('\n')
}

function extractJsonObject(text: string): string {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('AI did not return JSON content')
  }
  return text.slice(start, end + 1)
}

function parseTranslatedBlocks(text: string): Array<{ id: string; text: string }> {
  const parsed = JSON.parse(extractJsonObject(text)) as {
    translatedBlocks?: unknown
    translatedLines?: unknown
  }

  if (Array.isArray(parsed.translatedBlocks)) {
    const structured = parsed.translatedBlocks
      .map((block) => {
        if (!block || typeof block !== 'object') return undefined
        const b = block as { id?: unknown; text?: unknown }
        const id = typeof b.id === 'string' ? b.id.trim() : ''
        const t = typeof b.text === 'string' ? b.text.trim() : ''
        if (!id || !t) return undefined
        return { id, text: t }
      })
      .filter((b): b is { id: string; text: string } => Boolean(b))
    if (structured.length) return structured
  }

  // Fallback: plain array of strings
  const lines = Array.isArray(parsed.translatedLines) ? parsed.translatedLines : []
  return lines
    .filter((l): l is string => typeof l === 'string' && Boolean(l.trim()))
    .map((l, i) => ({ id: `block-${i + 1}`, text: l.trim() }))
}

async function githubCopilotPost<T>(apiKey: string, messages: Array<{ role: string; content: string }>, temperature: number): Promise<T> {
  const response = await CapacitorHttp.post({
    url: 'https://api.githubcopilot.com/chat/completions',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'Editor-Version': 'vscode/1.85.0',
      'User-Agent': 'GitHubCopilot/1.0'
    },
    data: {
      model: 'gpt-4o',
      messages,
      temperature
    }
  })

  if (response.status < 200 || response.status >= 300) {
    const msg = typeof response.data === 'string'
      ? response.data
      : JSON.stringify(response.data)
    throw new Error(msg || `GitHub Copilot request failed: ${response.status}`)
  }

  return response.data as T
}

/**
 * Call GitHub Copilot API directly from native Android to summarize an article.
 * Mirrors the requestGithubSummary() function in worker/src/index.ts.
 */
export async function nativeSummarizeArticle(
  apiKey: string,
  req: ArticleSummaryRequest
): Promise<ArticleSummaryResult> {
  if (!apiKey) throw new Error('请先在设置中填入 GitHub Copilot API Key')

  const prompt = buildSummaryPrompt(req)

  const result = await githubCopilotPost<{
    choices?: Array<{ message?: { content?: string } }>
    model?: string
  }>(apiKey, [
    { role: 'system', content: '你是人工智能助手。请输出忠于原文、简洁清晰的中文摘要。' },
    { role: 'user', content: prompt }
  ], 0.3)

  const summaryText = result.choices?.[0]?.message?.content?.trim()
  if (!summaryText) throw new Error('GitHub Copilot returned an empty summary')

  return {
    summaryText,
    model: result.model ?? 'gpt-4o',
    generatedAt: new Date().toISOString()
  }
}

/**
 * Call GitHub Copilot API directly from native Android to translate an article.
 * Mirrors the requestGithubTranslation() function in worker/src/index.ts.
 */
export async function nativeTranslateArticle(
  apiKey: string,
  req: ArticleTranslationRequest
): Promise<ArticleTranslationResult> {
  if (!apiKey) throw new Error('请先在设置中填入 GitHub Copilot API Key')

  const prompt = buildTranslationPrompt(req)

  const result = await githubCopilotPost<{
    choices?: Array<{ message?: { content?: string } }>
    model?: string
  }>(apiKey, [
    { role: 'system', content: '你是专业翻译助手。请严格按要求返回 JSON，保持段落数量和顺序一致。' },
    { role: 'user', content: prompt }
  ], 0.2)

  const text = result.choices?.[0]?.message?.content?.trim()
  if (!text) throw new Error('GitHub Copilot returned an empty translation')

  const inputBlocks = (req.blocks ?? []).slice(0, MAX_TRANSLATION_BLOCKS)
  const translatedBlocks = parseTranslatedBlocks(text)

  const inputIds = new Set(inputBlocks.map((b) => b.id))
  const filteredBlocks = translatedBlocks.filter((b) => inputIds.has(b.id))

  if (filteredBlocks.length !== inputBlocks.length) {
    throw new Error('AI returned mismatched translation block count')
  }

  return {
    translatedBlocks: filteredBlocks,
    model: result.model ?? 'gpt-4o',
    generatedAt: new Date().toISOString()
  }
}
