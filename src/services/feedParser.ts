import type { ParsedFeed, ParsedFeedItem } from '@/types/models'
import { stripHtml } from '@/utils/text'

function getNamespacedText(node: ParentNode, prefix: string, localName: string): string | undefined {
  for (const candidate of node.querySelectorAll('*')) {
    if (candidate.localName === localName && candidate.prefix === prefix) {
      return candidate.textContent?.trim()
    }
  }

  return undefined
}

function getText(node: ParentNode, selectors: string[]): string | undefined {
  for (const selector of selectors) {
    let value: string | undefined

    if (selector.includes(':')) {
      const parts = selector.split(':')
      const prefix = parts[0]
      const localName = parts[1]

      if (prefix && localName) {
        value = getNamespacedText(node, prefix, localName)
      }
    } else {
      value = node.querySelector(selector)?.textContent?.trim()
    }

    if (value) return value
  }

  return undefined
}

function getAttribute(node: ParentNode, selectors: Array<{ selector: string; attr: string }>): string | undefined {
  for (const entry of selectors) {
    const value = node.querySelector(entry.selector)?.getAttribute(entry.attr)?.trim()
    if (value) return value
  }

  return undefined
}

function parseItem(node: Element): ParsedFeedItem | undefined {
  const title = getText(node, ['title']) ?? '未命名文章'
  const link = getText(node, ['link']) ?? getAttribute(node, [{ selector: 'link', attr: 'href' }])

  if (!link) return undefined

  const summary = getText(node, ['description', 'summary'])
  const contentHtml = getText(node, ['content:encoded', 'content', 'summary', 'description']) ?? summary
  const feedItemId = getText(node, ['guid', 'id']) ?? `${title}-${link}`

  return {
    feedItemId,
    title,
    link,
    author: getText(node, ['author', 'dc:creator', 'creator']),
    summary,
    contentHtml,
    contentText: stripHtml(contentHtml),
    publishedAt: getText(node, ['pubDate', 'published', 'updated'])
  }
}

export function parseFeedXml(xmlText: string): ParsedFeed {
  const parser = new DOMParser()
  const doc = parser.parseFromString(xmlText, 'text/xml')
  const root = doc.querySelector('channel, feed, RDF')

  if (!root) {
    throw new Error('无法解析订阅内容')
  }

  const items = [...doc.querySelectorAll('item, entry')]
    .map((item) => parseItem(item))
    .filter((item): item is ParsedFeedItem => Boolean(item))

  return {
    title: getText(root, ['title']) ?? '未命名订阅',
    link: getText(root, ['link']) ?? getAttribute(root, [{ selector: 'link', attr: 'href' }]),
    description: getText(root, ['description', 'subtitle']),
    items
  }
}
