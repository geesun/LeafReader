import type { ArticleRecord } from '@/types/models'

export function normalizeTimestamp(value?: string): string | undefined {
  if (!value) return undefined

  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) return undefined

  return new Date(Math.min(parsed, Date.now())).toISOString()
}

export function getArticleSortTimestamp(article: Pick<ArticleRecord, 'publishedAt' | 'createdAt'>): number {
  return getSortableTimestamp(article.publishedAt) ?? getSortableTimestamp(article.createdAt) ?? 0
}

export function getArticleDisplayDate(article: Pick<ArticleRecord, 'publishedAt' | 'createdAt'>): string {
  return normalizeTimestamp(article.publishedAt) ?? normalizeTimestamp(article.createdAt) ?? article.createdAt
}

export function compareArticlesByRecency(
  left: Pick<ArticleRecord, 'publishedAt' | 'createdAt'>,
  right: Pick<ArticleRecord, 'publishedAt' | 'createdAt'>
): number {
  return getArticleSortTimestamp(right) - getArticleSortTimestamp(left)
}

export function getSortableTimestamp(value?: string): number | undefined {
  const normalized = normalizeTimestamp(value)
  if (!normalized) return undefined

  return Date.parse(normalized)
}
