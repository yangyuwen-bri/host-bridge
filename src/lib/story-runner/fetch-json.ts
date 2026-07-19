export type FetchJsonWithTimeoutParams = {
  url: string
  init: RequestInit
  timeoutMs: number
  fetchImpl?: typeof fetch
}

export type FetchJsonWithTimeoutResult = {
  response: Response
  data: Record<string, unknown>
}

function createTimeoutError(timeoutMs: number): Error {
  return new Error(`request timeout after ${Math.round(timeoutMs)}ms`)
}

function parseJsonObject(rawText: string): Record<string, unknown> {
  if (!rawText.trim()) return {}
  const parsed = JSON.parse(rawText) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  return parsed as Record<string, unknown>
}

export async function fetchJsonWithTimeout(
  params: FetchJsonWithTimeoutParams,
): Promise<FetchJsonWithTimeoutResult> {
  const fetchImpl = params.fetchImpl ?? fetch
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(createTimeoutError(params.timeoutMs)), params.timeoutMs)

  try {
    const response = await fetchImpl(params.url, {
      ...params.init,
      signal: controller.signal,
    })
    const rawText = await response.text()
    return {
      response,
      data: parseJsonObject(rawText),
    }
  } catch (error) {
    if (controller.signal.aborted) {
      const reason = controller.signal.reason
      if (reason instanceof Error) throw reason
      throw createTimeoutError(params.timeoutMs)
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}
