import { describe, expect, it } from 'vitest'
import { alignTimedSegmentsToCanonicalText, type TimedRecognitionSegment } from './qwen-subtitle-timing'

describe('qwen subtitle timing alignment', () => {
  it('aligns recognized segments back to canonical text', () => {
    const canonicalText = [
      '深夜的蜡烛忽明忽暗，钟先生突然从噩梦中惊醒，他紧紧抓着被角。',
      '对着身旁的邵又房失声痛哭，直言自己的死期已经到了。',
      '在钟先生的描述中，两个狰狞的隶卒将他拖入一片荒凉之地。',
    ].join('\n')

    const segments: TimedRecognitionSegment[] = [
      { index: 1, startSec: 0, endSec: 6.53, text: '深夜的蜡烛忽明忽暗，钟先生突然从噩梦中惊醒，他紧紧抓着被角。' },
      { index: 2, startSec: 6.53, endSec: 9.346, text: '对着身旁的邵幼防失声痛哭。' },
      { index: 3, startSec: 9.346, endSec: 13.362, text: '直言自己的死期已经到了，在钟先生的描述中。' },
      { index: 4, startSec: 13.362, endSec: 17.378, text: '两个狰狞的厉卒将他拖入一片荒凉之地。' },
    ]

    const cues = alignTimedSegmentsToCanonicalText(canonicalText, segments)
    expect(cues).toHaveLength(4)
    expect(cues[1].text).toBe('对着身旁的邵又房失声痛哭')
    expect(cues[2].text).toBe('直言自己的死期已经到了。\n在钟先生的描述中')
    expect(cues[3].text).toBe('两个狰狞的隶卒将他拖入一片荒凉之地')
    expect(cues[0].matchScore).toBeGreaterThan(0.9)
  })

  it('throws when segments are empty', () => {
    expect(() => alignTimedSegmentsToCanonicalText('正文', [])).toThrow('SUBTITLE_ALIGNMENT_FAILED')
  })
})
