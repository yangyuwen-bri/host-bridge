import { describe, expect, it } from 'vitest'
import { buildNarrationText } from './narration'

describe('story narration', () => {
  it('places the confirmed host opening before the story narration', () => {
    expect(buildNarrationText('主播开场。', '故事正文。')).toBe('主播开场。\n\n故事正文。')
  })

  it('fails when the story narration is empty', () => {
    expect(() => buildNarrationText('主播开场。', '  ')).toThrow('NARRATION_FROM_STORY_EMPTY')
  })
})
