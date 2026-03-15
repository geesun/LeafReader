export function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/$/, '')
}

export function toAbsoluteUrl(input: string, baseUrl: string): string {
  try {
    return new URL(input, baseUrl).toString()
  } catch {
    return input
  }
}

export function getUrlOrigin(input?: string): string | undefined {
  if (!input) return undefined

  try {
    return new URL(input).origin
  } catch {
    return undefined
  }
}

export function getUrlHostname(input?: string): string | undefined {
  if (!input) return undefined

  try {
    return new URL(input).hostname
  } catch {
    return undefined
  }
}

export function shouldUseTextOnlySubscriptionIcon(...inputs: Array<string | undefined>): boolean {
  return inputs.some((input) => {
    const hostname = getUrlHostname(input)
    return Boolean(hostname && /(^|\.)dapenti\.com$/i.test(hostname))
  })
}

export function buildSubscriptionIconCandidates(...inputs: Array<string | undefined>): string[] {
  const candidates: string[] = []
  const seen = new Set<string>()

  const add = (value?: string) => {
    if (!value || seen.has(value)) return
    seen.add(value)
    candidates.push(value)
  }

  for (const input of inputs) {
    const origin = getUrlOrigin(input)
    if (!origin) continue

    add(`${origin}/apple-touch-icon.png`)
    add(`${origin}/favicon.png`)
    add(`${origin}/favicon.ico`)
  }

  const primaryHost = inputs.map((input) => getUrlHostname(input)).find(Boolean)
  if (primaryHost) {
    add(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(primaryHost)}&sz=128`)
  }

  return candidates
}
