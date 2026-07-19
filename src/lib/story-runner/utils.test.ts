import { describe, expect, it } from 'vitest'
import {
  estimateStoryNarrationTargets,
  extractFirstJsonObject,
  normalizeDurationSeconds,
  splitTextForUtf8ByteLimit,
  toFileSlug,
} from './utils'

describe('story-runner utils', () => {
  it('extracts first top-level JSON object from markdown-wrapped output', () => {
    const raw = '```json\n{"title":"A","scenes":[{"id":1}]}\n```'
    const result = extractFirstJsonObject(raw)
    expect(result.title).toBe('A')
  })

  it('throws when no json object exists', () => {
    expect(() => extractFirstJsonObject('plain text only')).toThrow('JSON object not found')
  })

  it('accepts json5-like model output when strict json parse fails', () => {
    const raw = "{title:'A', scenes:[{id:1,}],}"
    const result = extractFirstJsonObject(raw)
    expect(result.title).toBe('A')
  })

  it('builds deterministic filename slug', () => {
    expect(toFileSlug(' 蔡书生 Full Video!! ')).toBe('蔡书生-full-video')
  })

  it('normalizes invalid duration to fallback and clamps minimum', () => {
    expect(normalizeDurationSeconds(undefined, 9)).toBe(9)
    expect(normalizeDurationSeconds(1.2, 9)).toBe(3.5)
    expect(normalizeDurationSeconds(7.7777, 9)).toBe(7.778)
  })

  it('estimates adaptive narration targets from story length', () => {
    const short = estimateStoryNarrationTargets('短故事'.repeat(20))
    expect(short.sourceCharCount).toBe(60)
    expect(short.targetDurationSec).toBe(60)
    expect(short.targetSceneCount).toBe(6)
    expect(short.perSceneDurationSec).toBe(10)
    expect(short.narrationCharMin).toBeGreaterThanOrEqual(220)
    expect(short.narrationCharMax).toBeGreaterThan(short.narrationCharMin)

    const long = estimateStoryNarrationTargets('长篇故事内容'.repeat(1200))
    expect(long.targetDurationSec).toBe(300)
    expect(long.targetSceneCount).toBe(18)
    expect(long.narrationCharMax).toBeGreaterThan(1200)
    expect(long.perSceneVoiceMaxChars).toBeGreaterThan(long.perSceneVoiceMinChars)
  })

  it('splits text by utf8 byte limit and keeps order', () => {
    const text = '第一段很短。第二段也很短。\n第三段稍微长一点，但还是会被切分。'
    const chunks = splitTextForUtf8ByteLimit(text, 36)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(Buffer.byteLength(chunk, 'utf8')).toBeLessThanOrEqual(36)
    }
    expect(chunks.join('')).toContain('第一段很短。')
    expect(chunks.join('')).toContain('第三段稍微长一点')
  })
})
