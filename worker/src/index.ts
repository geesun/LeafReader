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
const MAX_SUMMARY_CHARS = 24000
const MAX_TRANSLATION_BLOCKS = 32
const MAX_TRANSLATION_BLOCK_CHARS = 1600

interface Env {
  GOOGLE_AI_API_KEY?: string
  AI_SUMMARY_PROVIDER?: string
  VOLCENGINE_ARK_API_KEY?: string
}

interface SummaryRequest {
  title?: string
  url?: string
  content?: string
  length?: 'short' | 'medium' | 'long'
  provider?: 'google' | 'volcengine'
}

interface TranslationRequest {
  title?: string
  url?: string
  blocks?: Array<{ id?: string; text?: string } | string>
  lines?: string[]
  provider?: 'google' | 'volcengine'
}

interface SummaryResult {
  summaryText: string
  model: string
}

interface TranslationResult {
  translatedBlocks: Array<{ id: string; text: string }>
  translatedLines: string[]
  model: string
}

interface TranslationBlock {
  id: string
  text: string
}

function getSummaryLengthInstruction(length: SummaryRequest['length']): string {
  if (length === 'short') {
    return '1. 输出控制在 120 到 180 个汉字左右，内容要完整，不要过短。'
  }

  if (length === 'long') {
    return '1. 输出控制在 320 到 420 个汉字左右，信息要充分，不能只写几句空泛概括。'
  }

  return '1. 输出控制在 220 到 320 个汉字左右，信息要完整，不能明显短于 200 字。'
}

function getSummaryCompressionInstruction(length: SummaryRequest['length']): string {
  if (length === 'short') {
    return '如果初稿偏长，可以压缩，但仍需保留背景、事实和结论，不能只剩一句话。'
  }

  if (length === 'long') {
    return '可以稍微展开背景和结论，但仍然保持紧凑，不要写成长文。'
  }

  return '如果初稿偏长，请压缩到标准摘要长度；如果过短，请补足关键背景和结论。'
}

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

async function summarizeArticle(request: Request, env: Env): Promise<Response> {
  let payload: SummaryRequest

  try {
    payload = await request.json<SummaryRequest>()
  } catch {
    return json({ error: 'INVALID_JSON', message: 'Request body must be valid JSON' }, 400)
  }

  const title = payload.title?.trim() || '未命名文章'
  const url = payload.url?.trim() || ''
  const content = payload.content?.replace(/\s+/g, ' ').trim() || ''
  const length = payload.length ?? 'medium'

  if (!content) {
    return json({ error: 'EMPTY_CONTENT', message: 'Article content is required' }, 400)
  }

  const prompt = [
    '请你用简体中文为下面这篇文章写一段适合阅读器展示的摘要。',
    '要求：',
    getSummaryLengthInstruction(length),
    '2. 忠于原文，不要编造没有出现的信息。',
    '3. 优先提炼背景、核心事实、关键观点和结论。',
    '4. 不要写“本文主要讲了”“以下是摘要”这类套话。',
    '5. 只返回纯文本摘要，不要 Markdown，不要标题。',
    `6. ${getSummaryCompressionInstruction(length)}`,
    '',
    `文章标题：${title}`,
    url ? `文章链接：${url}` : '',
    '文章正文：',
    content.slice(0, MAX_SUMMARY_CHARS)
  ].filter(Boolean).join('\n')

  try {
    const result = await requestSummaryByProvider(prompt, env, payload.provider)

    return json({
      summaryText: result.summaryText,
      model: result.model,
      generatedAt: new Date().toISOString()
    })
  } catch (error) {
    return json(
      {
        error: 'SUMMARY_FAILED',
        message: error instanceof Error ? error.message : 'Unknown summary error'
      },
      502
    )
  }
}

async function translateArticle(request: Request, env: Env): Promise<Response> {
  let payload: TranslationRequest

  try {
    payload = await request.json<TranslationRequest>()
  } catch {
    return json({ error: 'INVALID_JSON', message: 'Request body must be valid JSON' }, 400)
  }

  const title = payload.title?.trim() || 'Untitled article'
  const url = payload.url?.trim() || ''
  const blocks = normalizeTranslationBlocks(payload)
    .slice(0, MAX_TRANSLATION_BLOCKS)

  if (!blocks.length) {
    return json({ error: 'EMPTY_CONTENT', message: 'Article blocks are required' }, 400)
  }

  if (blocks.some((block) => block.text.length > MAX_TRANSLATION_BLOCK_CHARS)) {
    return json({ error: 'BLOCK_TOO_LARGE', message: 'Article block is too long to translate' }, 400)
  }

  const prompt = [
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

  try {
    const result = await requestTranslationByProvider(prompt, env, payload.provider)

    const inputIds = new Set(blocks.map((block) => block.id))
    const filteredBlocks = result.translatedBlocks.filter((block) => inputIds.has(block.id))

    if (filteredBlocks.length !== blocks.length) {
      throw new Error('AI returned mismatched translation block count')
    }

    return json({
      translatedBlocks: filteredBlocks,
      model: result.model,
      generatedAt: new Date().toISOString()
    })
  } catch (error) {
    return json(
      {
        error: 'TRANSLATION_FAILED',
        message: error instanceof Error ? error.message : 'Unknown translation error'
      },
      502
    )
  }
}

function extractJsonObject(text: string): string {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')

  if (start === -1 || end === -1 || end <= start) {
    throw new Error('AI did not return JSON content')
  }

  return text.slice(start, end + 1)
}

function parseTranslationResponse(text: string): string[] {
  const parsed = JSON.parse(extractJsonObject(text)) as { translatedBlocks?: unknown; translatedLines?: unknown }
  const translatedBlocks = Array.isArray(parsed.translatedBlocks) ? parsed.translatedBlocks : parsed.translatedLines

  if (!Array.isArray(translatedBlocks)) {
    throw new Error('AI translation JSON is missing translatedBlocks')
  }

  const normalized = translatedBlocks.map((block) => {
    if (typeof block !== 'string') {
      throw new Error('AI translation block must be a string')
    }

    return block.trim()
  })

  if (normalized.some((block) => !block)) {
    throw new Error('AI translation returned empty block')
  }

  return normalized
}

function normalizeTranslationBlocks(payload: TranslationRequest): TranslationBlock[] {
  const legacyLines = (payload.lines ?? [])
    .map((line, index) => ({
      id: `line-${index + 1}`,
      text: line.replace(/\s+/g, ' ').trim()
    }))
    .filter((line) => Boolean(line.text))

  const rawBlocks = payload.blocks
  if (!rawBlocks?.length) {
    return legacyLines
  }

  return rawBlocks
    .map((block, index) => {
      if (typeof block === 'string') {
        return {
          id: `block-${index + 1}`,
          text: block.replace(/\s+/g, ' ').trim()
        }
      }

      return {
        id: block.id?.trim() || `block-${index + 1}`,
        text: block.text?.replace(/\s+/g, ' ').trim() || ''
      }
    })
    .filter((block) => Boolean(block.text))
}

function parseStructuredTranslationResponse(text: string): TranslationBlock[] {
  const parsed = JSON.parse(extractJsonObject(text)) as {
    translatedBlocks?: unknown
    translatedLines?: unknown
  }

  if (Array.isArray(parsed.translatedBlocks)) {
    const structured = parsed.translatedBlocks
      .map((block) => {
        if (!block || typeof block !== 'object') {
          return undefined
        }

        const candidate = block as { id?: unknown; text?: unknown }
        const id = typeof candidate.id === 'string' ? candidate.id.trim() : ''
        const normalizedText = typeof candidate.text === 'string' ? candidate.text.trim() : ''

        if (!id || !normalizedText) {
          return undefined
        }

        return { id, text: normalizedText }
      })
      .filter((block): block is TranslationBlock => Boolean(block))

    if (structured.length) {
      return structured
    }
  }

  return parseTranslationResponse(text).map((block, index) => ({
    id: `block-${index + 1}`,
    text: block
  }))
}

async function requestGoogleSummary(prompt: string, env: Env): Promise<SummaryResult> {
  if (!env.GOOGLE_AI_API_KEY) {
    throw new Error('GOOGLE_AI_API_KEY is not configured')
  }

  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-goog-api-key': env.GOOGLE_AI_API_KEY
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              text: prompt
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.3
      }
    })
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || `Gemini request failed: ${response.status}`)
  }

  const result = await response.json<{
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>
      }
    }>
  }>()

  const summaryText = result.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('').trim()

  if (!summaryText) {
    throw new Error('Gemini returned an empty summary')
  }

  return {
    summaryText,
    model: 'gemini-flash-latest'
  }
}

async function requestVolcengineSummary(prompt: string, env: Env): Promise<SummaryResult> {
  if (!env.VOLCENGINE_ARK_API_KEY) {
    throw new Error('VOLCENGINE_ARK_API_KEY is not configured')
  }

  const response = await fetch('https://ark.cn-beijing.volces.com/api/v3/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.VOLCENGINE_ARK_API_KEY}`
    },
    body: JSON.stringify({
      model: 'doubao-lite-32k-character-250228',
      messages: [
        {
          role: 'system',
          content: '你是人工智能助手。请输出忠于原文、简洁清晰的中文摘要。'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.3,
      max_tokens: 384
    })
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || `Volcengine request failed: ${response.status}`)
  }

  const result = await response.json<{
    choices?: Array<{
      message?: {
        content?: string
      }
    }>
  }>()

  const summaryText = result.choices?.[0]?.message?.content?.trim()

  if (!summaryText) {
    throw new Error('Volcengine returned an empty summary')
  }

  return {
    summaryText,
    model: 'doubao-lite-32k-character-250228'
  }
}

async function requestGoogleTranslation(prompt: string, env: Env): Promise<TranslationResult> {
  if (!env.GOOGLE_AI_API_KEY) {
    throw new Error('GOOGLE_AI_API_KEY is not configured')
  }

  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-goog-api-key': env.GOOGLE_AI_API_KEY
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              text: prompt
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json'
      }
    })
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || `Gemini request failed: ${response.status}`)
  }

  const result = await response.json<{
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>
      }
    }>
  }>()

  const text = result.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('').trim()

  if (!text) {
    throw new Error('Gemini returned an empty translation')
  }

  const translatedBlocks = parseStructuredTranslationResponse(text)

  return {
    translatedBlocks,
    translatedLines: translatedBlocks.map((block) => block.text),
    model: 'gemini-flash-latest'
  }
}

async function requestVolcengineTranslation(prompt: string, env: Env): Promise<TranslationResult> {
  if (!env.VOLCENGINE_ARK_API_KEY) {
    throw new Error('VOLCENGINE_ARK_API_KEY is not configured')
  }

  const response = await fetch('https://ark.cn-beijing.volces.com/api/v3/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.VOLCENGINE_ARK_API_KEY}`
    },
    body: JSON.stringify({
      model: 'doubao-lite-32k-character-250228',
      messages: [
        {
          role: 'system',
          content: '你是专业翻译助手。请严格按要求返回 JSON，保持段落数量和顺序一致。'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.2,
      max_tokens: 4096,
      response_format: {
        type: 'json_object'
      }
    })
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || `Volcengine request failed: ${response.status}`)
  }

  const result = await response.json<{
    choices?: Array<{
      message?: {
        content?: string
      }
    }>
  }>()

  const text = result.choices?.[0]?.message?.content?.trim()

  if (!text) {
    throw new Error('Volcengine returned an empty translation')
  }

  const translatedBlocks = parseStructuredTranslationResponse(text)

  return {
    translatedBlocks,
    translatedLines: translatedBlocks.map((block) => block.text),
    model: 'doubao-lite-32k-character-250228'
  }
}

async function requestSummaryByProvider(prompt: string, env: Env, providerOverride?: SummaryRequest['provider']): Promise<SummaryResult> {
  const provider = providerOverride?.trim().toLowerCase() || env.AI_SUMMARY_PROVIDER?.trim().toLowerCase() || 'google'

  if (provider === 'volcengine') {
    return requestVolcengineSummary(prompt, env)
  }

  return requestGoogleSummary(prompt, env)
}

async function requestTranslationByProvider(
  prompt: string,
  env: Env,
  providerOverride?: TranslationRequest['provider']
): Promise<TranslationResult> {
  const provider = providerOverride?.trim().toLowerCase() || env.AI_SUMMARY_PROVIDER?.trim().toLowerCase() || 'google'

  if (provider === 'volcengine') {
    return requestVolcengineTranslation(prompt, env)
  }

  return requestGoogleTranslation(prompt, env)
}

async function proxyRequest(targetUrl: URL, maxBytes: number): Promise<Response> {
  const response = await fetch(targetUrl.toString(), {
    redirect: 'follow',
    headers: {
      'User-Agent': 'NeoReaderWorker/1.0'
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
      'User-Agent': 'NeoReaderWorker/1.0'
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
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: CORS_HEADERS
      })
    }

    const url = new URL(request.url)

    if (request.method === 'POST' && url.pathname === '/summarize') {
      return summarizeArticle(request, env)
    }

    if (request.method === 'POST' && url.pathname === '/translate') {
      return translateArticle(request, env)
    }

    if (request.method !== 'GET') {
      return json({ error: 'METHOD_NOT_ALLOWED' }, 405)
    }

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

      return json({ ok: true, service: 'neoreader-worker' })
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
