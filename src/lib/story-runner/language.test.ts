import { describe, expect, it } from 'vitest'
import { containsLatinLetters } from './language'

describe('containsLatinLetters', () => {
  it('returns false for pure Chinese text', () => {
    expect(containsLatinLetters('夜半书生借宿古寺，忽闻梁上低泣。')).toBe(false)
  })

  it('returns true when mixed with English', () => {
    expect(containsLatinLetters('杨继盛与DeityJiaoShan在殿前相见。')).toBe(true)
  })

  it('returns false for digits and punctuation only', () => {
    expect(containsLatinLetters('第12幕：时长90秒；16:9。')).toBe(false)
  })
})
