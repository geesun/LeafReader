export function stripHtml(html?: string): string {
  if (!html) return ''
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

export function limitText(value: string, length = 120): string {
  if (value.length <= length) return value
  return `${value.slice(0, length).trim()}...`
}
