function normalizeWhitespace(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim()
}

function extractTextFromHtml(value: string): string {
  const parser = new DOMParser()
  const firstPass = parser.parseFromString(value, 'text/html')
  const firstText = firstPass.body.textContent ?? firstPass.documentElement.textContent ?? ''

  if (!/<\/?[a-z][\s\S]*>/i.test(firstText)) {
    return firstText
  }

  const secondPass = parser.parseFromString(firstText, 'text/html')
  return secondPass.body.textContent ?? secondPass.documentElement.textContent ?? firstText
}

export function stripHtml(html?: string): string {
  if (!html) return ''
  return normalizeWhitespace(extractTextFromHtml(html))
}

export function limitText(value: string, length = 120): string {
  const normalized = normalizeWhitespace(value)
  if (normalized.length <= length) return normalized
  return `${normalized.slice(0, length).trim()}...`
}
