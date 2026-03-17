export interface SubscriptionRecord {
  id: string
  title: string
  feedUrl: string
  siteUrl?: string
  iconUrl?: string
  cachedIconDataUrl?: string
  iconLookupFailed?: boolean
  description?: string
  createdAt: string
  updatedAt: string
  lastFetchedAt?: string
  lastSuccessAt?: string
  lastError?: string
  isPinned: boolean
  // After a trim, set to the max publishedAt of the evicted articles for this
  // subscription. Any incoming feed item with publishedAt <= this value will
  // be skipped on the next upsert, preventing re-insertion of trimmed articles.
  oldestKeptPublishedAt?: string
}

export type ArticleContentSource = 'feed' | 'fulltext'

export interface ArticleRecord {
  id: string
  subscriptionId: string
  feedItemId: string
  title: string
  link: string
  author?: string
  summary?: string
  feedContentHtml?: string
  fullContentHtml?: string
  offlineContentHtml?: string
  contentText?: string
  contentSource: ArticleContentSource
  publishedAt?: string
  createdAt: string
  updatedAt: string
  isRead: boolean
  isFavorite: boolean
  readAt?: string
  favoriteAt?: string
  hasFullContent: boolean
  isOfflineSaved: boolean
  offlineSavedAt?: string
  leadImageUrl?: string
  aiSummaryText?: string
  aiSummaryModel?: string
  aiSummaryGeneratedAt?: string
  aiTranslationBlocks?: BilingualParagraph[]
  aiTranslationModel?: string
  aiTranslationGeneratedAt?: string
  aiTranslationFormat?: 'paragraph-v1'
}

export interface BilingualParagraph {
  translatedText: string
  sourceText: string
}

export interface OfflineAssetRecord {
  id: string
  articleId: string
  originalUrl: string
  localPath: string
  mimeType: string
  byteSize: number
  status: 'pending' | 'success' | 'failed'
  createdAt: string
  updatedAt: string
}

export interface FullTextResult {
  url: string
  finalUrl: string
  title?: string
  byline?: string
  siteName?: string
  excerpt?: string
  publishedTime?: string
  lang?: string
  contentHtml: string
  textContent?: string
  leadImageUrl?: string
}

export interface ArticleSummaryResult {
  summaryText: string
  model: string
  generatedAt: string
}

export interface ArticleSummaryRequest {
  title: string
  url: string
  content: string
  length?: SummaryLength
  provider?: SummaryProvider
}

export interface ArticleTranslationRequest {
  title: string
  url: string
  blocks: TranslationBlockPayload[]
  provider?: SummaryProvider
}

export interface ArticleTranslationResult {
  translatedBlocks: TranslationBlockPayload[]
  model: string
  generatedAt: string
}

export interface TranslationBlockPayload {
  id: string
  text: string
}

export type SummaryLength = 'short' | 'medium' | 'long'
export type SummaryProvider = 'google' | 'volcengine' | 'github'

export interface RefreshSummary {
  inserted: number
  successCount: number
  failureCount: number
  failures: Array<{ subscriptionId: string; message: string }>
}

export interface ParsedFeed {
  title: string
  link?: string
  description?: string
  items: ParsedFeedItem[]
}

export interface ParsedFeedItem {
  feedItemId: string
  title: string
  link: string
  author?: string
  summary?: string
  contentHtml?: string
  contentText?: string
  publishedAt?: string
}

export interface AppSettings {
  theme: 'system' | 'light' | 'dark'
  fontSize: number
  summaryLength: SummaryLength
  summaryProvider: SummaryProvider
}
