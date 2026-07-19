export function isRetriableGoogleTextError(message: string): boolean {
  const normalized = message.trim().toLowerCase()
  if (!normalized) return false
  return normalized.includes('empty text')
    || normalized.includes('429')
    || normalized.includes('负载已饱和')
    || normalized.includes('rate limit')
    || normalized.includes('system_memory_overloaded')
    || normalized.includes('overloaded')
    || normalized.includes('无可用渠道')
    || normalized.includes('distributor')
    || normalized.includes('resource_exhausted')
}

export function computeGoogleTextRetryDelayMs(message: string, attempt: number): number {
  const normalizedAttempt = Number.isFinite(attempt) && attempt > 0 ? attempt : 1
  if (isRetriableGoogleTextError(message)) {
    return Math.min(60_000, 10_000 * normalizedAttempt)
  }
  return 3_000
}
