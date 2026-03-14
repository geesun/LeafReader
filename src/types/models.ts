export interface SubscriptionRecord {
  id: string
  title: string
  feedUrl: string
  siteUrl?: string
  iconUrl?: string
  description?: string
  createdAt: string
  updatedAt: string
  lastFetchedAt?: string
  lastSuccessAt?: string
  lastError?: string
  isPinned: boolean
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
  workerBaseUrl: string
  theme: 'system' | 'light' | 'dark'
  fontSize: number
  readMode: 'simplified' | 'original'
  autoMarkRead: boolean
  listDensity: 'comfortable' | 'compact'
  readContentPreference: 'auto' | 'feed' | 'fulltext'
  autoFetchFullText: 'off' | 'on_open' | 'on_favorite'
  offlineImagePolicy: 'manual' | 'on_open' | 'on_favorite'
}
