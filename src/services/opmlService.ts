import type { SubscriptionRecord } from '@/types/models'

export function exportSubscriptionsToOpml(subscriptions: SubscriptionRecord[]): string {
  const body = subscriptions
    .map(
      (subscription) =>
        `    <outline text="${escapeXml(subscription.title)}" title="${escapeXml(subscription.title)}" type="rss" xmlUrl="${escapeXml(subscription.feedUrl)}" htmlUrl="${escapeXml(subscription.siteUrl ?? '')}" />`
    )
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>LeafReader Subscriptions</title>
  </head>
  <body>
${body}
  </body>
</opml>`
}

export function parseOpml(text: string): Array<{ title: string; feedUrl: string; siteUrl?: string }> {
  const doc = new DOMParser().parseFromString(text, 'text/xml')
  return [...doc.querySelectorAll('outline[xmlUrl]')].map((node) => ({
    title: node.getAttribute('title') || node.getAttribute('text') || '未命名订阅',
    feedUrl: node.getAttribute('xmlUrl') || '',
    siteUrl: node.getAttribute('htmlUrl') || undefined
  })).filter((item) => item.feedUrl)
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
