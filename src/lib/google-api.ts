export const DEFAULT_GOOGLE_BASE_URL = 'https://generativelanguage.googleapis.com'

export function normalizeGoogleBaseUrl(rawValue: string): string {
  const trimmed = rawValue.trim()
  if (!trimmed) return DEFAULT_GOOGLE_BASE_URL
  return trimmed.replace(/\/+$/, '')
}

export function googleModelsEndpoint(baseUrl: string): string {
  return `${normalizeGoogleBaseUrl(baseUrl)}/v1beta/models`
}

export function googleGenerateContentEndpoint(baseUrl: string, model: string): string {
  return `${googleModelsEndpoint(baseUrl)}/${encodeURIComponent(model)}:generateContent`
}

export function resolveGoogleBaseUrl(values: Array<string | undefined>): string {
  for (const value of values) {
    const trimmed = (value || '').trim()
    if (trimmed) return normalizeGoogleBaseUrl(trimmed)
  }
  return DEFAULT_GOOGLE_BASE_URL
}

export function parseGoogleApiKeyList(values: Array<string | undefined>): string[] {
  const keys: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const raw = (value || '').trim()
    if (!raw) continue
    const parts = raw
      .split(/[\r\n,]+/u)
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
    for (const part of parts) {
      if (seen.has(part)) continue
      seen.add(part)
      keys.push(part)
    }
  }
  return keys
}

export function pickGoogleApiKey(keys: string[], zeroBasedAttempt: number, zeroBasedSeed = 0): string {
  if (!Array.isArray(keys) || keys.length === 0) {
    throw new Error('GOOGLE_API_KEY_POOL_EMPTY')
  }
  const normalizedAttempt = Number.isFinite(zeroBasedAttempt) ? Math.max(0, Math.trunc(zeroBasedAttempt)) : 0
  const normalizedSeed = Number.isFinite(zeroBasedSeed) ? Math.max(0, Math.trunc(zeroBasedSeed)) : 0
  const index = (normalizedSeed + normalizedAttempt) % keys.length
  return keys[index]
}
