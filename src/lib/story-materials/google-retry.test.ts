import { describe, expect, it } from 'vitest'
import { computeGoogleTextRetryDelayMs, isRetriableGoogleTextError } from './google-retry'

describe('google text retry policy', () => {
  it('treats relay saturation and empty text as retriable upstream conditions', () => {
    expect(isRetriableGoogleTextError('429 当前分组上游负载已饱和')).toBe(true)
    expect(isRetriableGoogleTextError('empty text')).toBe(true)
    expect(isRetriableGoogleTextError('system_memory_overloaded')).toBe(true)
    expect(isRetriableGoogleTextError('分组 *** 下模型 gemini-3-flash-preview 无可用渠道（distributor）')).toBe(true)
    expect(isRetriableGoogleTextError('model_not_found')).toBe(false)
  })

  it('uses longer backoff for transient upstream saturation', () => {
    expect(computeGoogleTextRetryDelayMs('empty text', 1)).toBe(10000)
    expect(computeGoogleTextRetryDelayMs('429 当前分组上游负载已饱和', 3)).toBe(30000)
    expect(computeGoogleTextRetryDelayMs('system_memory_overloaded', 6)).toBe(60000)
    expect(computeGoogleTextRetryDelayMs('model_not_found', 2)).toBe(3000)
  })
})
