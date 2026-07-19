import type { HotNewsFetchResult, HotNewsItem, HotNewsSourceError } from './types'

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export type FetchNewsNowOptions = {
  sources: string[]
  endpointBase?: string
  fetchImpl?: FetchLike
  timeoutMs?: number
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readOptionalInfo(extra: unknown): string {
  const row = asRecord(extra)
  if (!row) return ''
  return readString(row.info) || readString(row.hover)
}

function parseNewsNowItems(source: string, fetchedAt: string, payload: unknown): HotNewsItem[] {
  const row = asRecord(payload)
  if (!row) throw new Error(`${source} returned non-object json`)
  const items = row.items
  if (!Array.isArray(items)) {
    const message = readString(row.message) || 'missing items'
    throw new Error(`${source} ${message}`)
  }

  return items.map((item, index) => {
    const itemRow = asRecord(item)
    if (!itemRow) throw new Error(`${source} item ${index + 1} is invalid`)
    const title = readString(itemRow.title)
    if (!title) throw new Error(`${source} item ${index + 1} missing title`)
    return {
      source,
      rank: index + 1,
      title,
      url: readString(itemRow.url) || readString(itemRow.mobileUrl),
      hot: readOptionalInfo(itemRow.extra),
      fetchedAt,
    }
  })
}

async function fetchSource(
  fetchImpl: FetchLike,
  endpointBase: string,
  source: string,
  fetchedAt: string,
  timeoutMs: number,
): Promise<HotNewsItem[]> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const url = `${endpointBase.replace(/\/$/u, '')}/api/s?id=${encodeURIComponent(source)}`
    const response = await fetchImpl(url, {
      headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0' },
      signal: controller.signal,
    })
    const contentType = response.headers.get('content-type') || ''
    if (!contentType.includes('application/json')) {
      throw new Error(`${source} returned non-json content-type: ${contentType || 'unknown'}`)
    }
    const payload = await response.json() as unknown
    if (!response.ok) {
      const row = asRecord(payload)
      const message = row ? readString(row.message) || response.statusText : response.statusText
      throw new Error(`${source} http ${response.status}: ${message}`)
    }
    return parseNewsNowItems(source, fetchedAt, payload)
  } finally {
    clearTimeout(timeout)
  }
}

export async function fetchNewsNowHotItems(options: FetchNewsNowOptions): Promise<HotNewsFetchResult> {
  const fetchImpl = options.fetchImpl || fetch
  const endpointBase = options.endpointBase || 'https://newsnow.busiyi.world'
  const timeoutMs = options.timeoutMs ?? 15000
  const fetchedAt = new Date().toISOString()
  const items: HotNewsItem[] = []
  const errors: HotNewsSourceError[] = []

  const results = await Promise.all(options.sources.map(async (source) => {
    try {
      return {
        source,
        fetchedItems: await fetchSource(fetchImpl, endpointBase, source, fetchedAt, timeoutMs),
        error: null,
      }
    } catch (error) {
      return {
        source,
        fetchedItems: [],
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }))

  for (const result of results) {
    items.push(...result.fetchedItems)
    if (result.error) {
      errors.push({
        source: result.source,
        message: result.error,
      })
    }
  }

  if (items.length === 0) {
    throw new Error(`NEWSNOW_ALL_SOURCES_FAILED: ${errors.map((error) => `${error.source}:${error.message}`).join('; ')}`)
  }

  return { fetchedAt, items, errors }
}
