import { describe, expect, it, vi } from 'vitest'
import { fetchJsonWithTimeout } from './fetch-json'

describe('fetchJsonWithTimeout', () => {
  it('parses json body from a successful response', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true, value: 3 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    const result = await fetchJsonWithTimeout({
      url: 'https://example.com/test',
      init: { method: 'POST', body: '{}' },
      timeoutMs: 1000,
      fetchImpl,
    })

    expect(result.response.status).toBe(200)
    expect(result.data).toEqual({ ok: true, value: 3 })
  })

  it('returns empty object when body is not a json object', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () => new Response('["x"]', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    const result = await fetchJsonWithTimeout({
      url: 'https://example.com/test',
      init: { method: 'GET' },
      timeoutMs: 1000,
      fetchImpl,
    })

    expect(result.data).toEqual({})
  })

  it('aborts a hung body read at the configured timeout', async () => {
    const fetchImpl: typeof fetch = vi.fn(async (_input, init) => {
      const signal = init?.signal
      return {
        status: 200,
        ok: true,
        text: () => new Promise<string>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('body aborted')), { once: true })
        }),
      } as unknown as Response
    })

    await expect(fetchJsonWithTimeout({
      url: 'https://example.com/test',
      init: { method: 'GET' },
      timeoutMs: 10,
      fetchImpl,
    })).rejects.toThrow('request timeout after 10ms')
  })
})
