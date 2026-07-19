import { describe, expect, it } from 'vitest'
import {
  ensureInsideAllowedRoots,
  ensureInsideWorkspacePath,
  parseRangeHeader,
} from './local-file'

describe('story materials local file guard', () => {
  it('allows paths inside workspace', () => {
    const workspaceRoot = '/tmp/workspace'
    const resolved = ensureInsideWorkspacePath(workspaceRoot, '/tmp/workspace/materials/zhibuyu/runs/a.mp4')
    expect(resolved).toBe('/tmp/workspace/materials/zhibuyu/runs/a.mp4')
  })

  it('rejects paths outside workspace', () => {
    const workspaceRoot = '/tmp/workspace'
    expect(() => ensureInsideWorkspacePath(workspaceRoot, '/etc/passwd')).toThrowError('path-outside-workspace')
  })

  it('accepts path under allowed roots and rejects others', () => {
    ensureInsideAllowedRoots('/tmp/workspace/materials/zhibuyu/runs/a.mp4', [
      '/tmp/workspace/materials/zhiguai',
      '/tmp/workspace/materials/zhibuyu/runs',
    ])
    expect(() => ensureInsideAllowedRoots('/tmp/workspace/src/index.ts', [
      '/tmp/workspace/materials/zhiguai',
      '/tmp/workspace/materials/zhibuyu/runs',
    ])).toThrowError('path-not-allowed')
  })
})

describe('parseRangeHeader', () => {
  it('parses explicit range', () => {
    expect(parseRangeHeader('bytes=10-19', 100)).toEqual({ start: 10, end: 19 })
  })

  it('parses open-ended range', () => {
    expect(parseRangeHeader('bytes=90-', 100)).toEqual({ start: 90, end: 99 })
  })

  it('parses suffix range', () => {
    expect(parseRangeHeader('bytes=-10', 100)).toEqual({ start: 90, end: 99 })
  })

  it('returns null for invalid range', () => {
    expect(parseRangeHeader('bytes=200-210', 100)).toBeNull()
    expect(parseRangeHeader('invalid', 100)).toBeNull()
  })
})
