function fallbackRandomSegment(): string {
  return `${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`
}

export function createId(prefix = 'id'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`
  }

  return `${prefix}_${fallbackRandomSegment()}`
}
