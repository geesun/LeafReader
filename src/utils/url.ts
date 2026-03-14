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
