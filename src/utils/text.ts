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

export function splitTextIntoParagraphBlocks(text: string, maxBlockLength = 700): string[] {
  const normalized = text
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .trim()

  if (!normalized) return []

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((paragraph) => normalizeWhitespace(paragraph.replace(/\n+/g, ' ')))
    .filter(Boolean)

  const blocks: string[] = []

  for (const paragraph of paragraphs) {
    if (paragraph.length <= maxBlockLength) {
      blocks.push(paragraph)
      continue
    }

    const sentences = paragraph
      .split(/(?<=[.!?。！？])\s+/)
      .map((sentence) => normalizeWhitespace(sentence))
      .filter(Boolean)

    if (!sentences.length) {
      blocks.push(paragraph)
      continue
    }

    let current = ''

    for (const sentence of sentences) {
      const next = current ? `${current} ${sentence}` : sentence
      if (next.length > maxBlockLength && current) {
        blocks.push(current)
        current = sentence
      } else {
        current = next
      }
    }

    if (current) {
      blocks.push(current)
    }
  }

  return blocks
}

export function extractParagraphsFromHtml(html?: string): string[] {
  if (!html) return []

  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')
  const blockSelectors = 'p, li, blockquote, pre, h1, h2, h3, h4, h5, h6'
  const blocks = Array.from(doc.body.querySelectorAll(blockSelectors))
    .map((node) => normalizeWhitespace(node.textContent ?? ''))
    .filter(Boolean)

  if (blocks.length) {
    return blocks
  }

  const text = doc.body.textContent ?? doc.documentElement.textContent ?? ''
  return splitTextIntoParagraphBlocks(text)
}

export function compactTranslationBlocks(
  inputBlocks: string[],
  minBlockLength = 220,
  maxBlockLength = 1200,
  maxBlocks = 24
): string[] {
  const blocks = inputBlocks
    .map((block) => normalizeWhitespace(block))
    .filter(Boolean)

  if (!blocks.length) return []

  const merged: string[] = []

  for (const block of blocks) {
    const previous = merged[merged.length - 1]
    if (previous && (previous.length < minBlockLength || block.length < minBlockLength)) {
      const combined = normalizeWhitespace(`${previous} ${block}`)
      if (combined.length <= maxBlockLength) {
        merged[merged.length - 1] = combined
        continue
      }
    }

    merged.push(block)
  }

  while (merged.length > maxBlocks) {
    let bestIndex = 0
    let bestLength = Number.POSITIVE_INFINITY

    for (let index = 0; index < merged.length - 1; index += 1) {
      const combinedLength = `${merged[index]} ${merged[index + 1]}`.length
      if (combinedLength < bestLength) {
        bestLength = combinedLength
        bestIndex = index
      }
    }

    const left = merged[bestIndex]
    const right = merged[bestIndex + 1]
    if (!left || !right) break
    merged.splice(bestIndex, 2, normalizeWhitespace(`${left} ${right}`))
  }

  return merged
}

export function splitTextIntoSentenceLines(text: string): string[] {
  const normalized = normalizeWhitespace(text)
  if (!normalized) return []

  const roughParts = normalized
    .split(/(?<=[.!?。！？])\s+|(?<=[:;])\s+(?=[A-Z])/)
    .map((part) => normalizeWhitespace(part))
    .filter(Boolean)

  const lines: string[] = []

  for (const part of roughParts) {
    if (part.length <= 260) {
      lines.push(part)
      continue
    }

    const clauses = part
      .split(/(?<=[,，])\s+|(?<=\))\s+(?=[A-Z])/)
      .map((clause) => normalizeWhitespace(clause))
      .filter(Boolean)

    if (!clauses.length) {
      lines.push(part)
      continue
    }

    let current = ''

    for (const clause of clauses) {
      const next = current ? `${current} ${clause}` : clause
      if (next.length > 260 && current) {
        lines.push(current)
        current = clause
      } else {
        current = next
      }
    }

    if (current) {
      lines.push(current)
    }
  }

  return lines.filter((line) => line.length >= 2)
}

function splitLineAtBoundary(line: string): [string, string] | undefined {
  const normalized = normalizeWhitespace(line)
  if (normalized.length < 20) return undefined

  const punctuationMatches = [...normalized.matchAll(/[,:;，：；]\s*/g)]
  if (punctuationMatches.length) {
    const midpoint = normalized.length / 2
    const firstMatch = punctuationMatches[0]
    if (!firstMatch) {
      return undefined
    }

    const bestMatch = punctuationMatches.reduce((best, match) => {
      const index = (match.index ?? 0) + match[0].length
      return Math.abs(index - midpoint) < Math.abs(best - midpoint) ? index : best
    }, (firstMatch.index ?? 0) + firstMatch[0].length)

    const left = normalizeWhitespace(normalized.slice(0, bestMatch))
    const right = normalizeWhitespace(normalized.slice(bestMatch))
    if (left && right) {
      return [left, right]
    }
  }

  const words = normalized.split(/\s+/)
  if (words.length >= 6) {
    const middle = Math.ceil(words.length / 2)
    const left = normalizeWhitespace(words.slice(0, middle).join(' '))
    const right = normalizeWhitespace(words.slice(middle).join(' '))
    if (left && right) {
      return [left, right]
    }
  }

  const middle = Math.floor(normalized.length / 2)
  const left = normalizeWhitespace(normalized.slice(0, middle))
  const right = normalizeWhitespace(normalized.slice(middle))
  if (left && right) {
    return [left, right]
  }

  return undefined
}

export function alignDisplayLines(text: string, targetCount: number): string[] {
  const normalized = normalizeWhitespace(text)
  if (!normalized) return []
  if (targetCount <= 1) return [normalized]

  const lines = splitTextIntoSentenceLines(normalized)
  if (!lines.length) return [normalized]

  while (lines.length > targetCount) {
    let bestIndex = 0
    let bestLength = Number.POSITIVE_INFINITY

    for (let index = 0; index < lines.length - 1; index += 1) {
      const mergedLength = `${lines[index]} ${lines[index + 1]}`.length
      if (mergedLength < bestLength) {
        bestLength = mergedLength
        bestIndex = index
      }
    }

    const left = lines[bestIndex]
    const right = lines[bestIndex + 1]
    if (!left || !right) {
      break
    }

    lines.splice(bestIndex, 2, normalizeWhitespace(`${left} ${right}`))
  }

  while (lines.length < targetCount) {
    let splitIndex = -1
    let splitResult: [string, string] | undefined
    let longestLength = 0

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]
      if (!line || line.length <= longestLength) continue
      const candidate = splitLineAtBoundary(line)
      if (!candidate) continue
      splitIndex = index
      splitResult = candidate
      longestLength = line.length
    }

    if (splitIndex === -1 || !splitResult) {
      break
    }

    lines.splice(splitIndex, 1, splitResult[0], splitResult[1])
  }

  return lines
}

export function looksLikeEnglishArticle(text: string): boolean {
  const normalized = normalizeWhitespace(text)
  if (normalized.length < 160) return false

  const letters = normalized.match(/[A-Za-z]/g)?.length ?? 0
  const chinese = normalized.match(/[\u3400-\u9fff]/g)?.length ?? 0
  const words = normalized.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g)?.length ?? 0

  if (words < 40 || letters < 240) return false
  return letters > chinese * 6
}
