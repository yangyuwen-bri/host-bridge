import { describe, expect, it } from 'vitest'
import {
  buildNarrationAss,
  buildNarrationSrt,
  buildNarrationSubtitleCues,
  getWavDurationMs,
  normalizeSceneDurations,
} from './story-video'

function buildPcm16Wav(durationMs: number, sampleRate = 24000): Buffer {
  const numChannels = 1
  const bitsPerSample = 16
  const bytesPerSample = bitsPerSample / 8
  const numSamples = Math.max(1, Math.round((sampleRate * durationMs) / 1000))
  const dataSize = numSamples * numChannels * bytesPerSample
  const fileSize = 36 + dataSize
  const byteRate = sampleRate * numChannels * bytesPerSample
  const blockAlign = numChannels * bytesPerSample

  const buffer = Buffer.alloc(44 + dataSize)
  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(fileSize, 4)
  buffer.write('WAVE', 8, 'ascii')
  buffer.write('fmt ', 12, 'ascii')
  buffer.writeUInt32LE(16, 16) // PCM chunk size
  buffer.writeUInt16LE(1, 20) // PCM format
  buffer.writeUInt16LE(numChannels, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(byteRate, 28)
  buffer.writeUInt16LE(blockAlign, 32)
  buffer.writeUInt16LE(bitsPerSample, 34)
  buffer.write('data', 36, 'ascii')
  buffer.writeUInt32LE(dataSize, 40)
  return buffer
}

describe('story-video ffmpeg helpers', () => {
  it('parses wav duration from PCM16 header', () => {
    const wav = buildPcm16Wav(57200)
    const duration = getWavDurationMs(wav)
    expect(duration).toBe(57200)
  })

  it('returns null for non-wav buffer', () => {
    const invalid = Buffer.from('not-a-wav')
    expect(getWavDurationMs(invalid)).toBeNull()
  })

  it('normalizes scene durations to audio length with minimum duration', () => {
    const scenes = [
      { id: 1, durationSec: 10 },
      { id: 2, durationSec: 20 },
      { id: 3, durationSec: 10 },
    ]
    const normalized = normalizeSceneDurations(scenes, 80, 3.5)
    expect(normalized).toEqual([20, 40, 20])
  })

  it('uses scene voiceOver length for image timing when all scenes have voiceOver', () => {
    const scenes = [
      { id: 1, durationSec: 10, voiceOver: '短句。' },
      { id: 2, durationSec: 10, voiceOver: '这一段旁白明显更长，会占用更多画面时间。' },
    ]
    const normalized = normalizeSceneDurations(scenes, 30, 3.5)
    expect(normalized[1]).toBeGreaterThan(normalized[0])
    expect(normalized).toEqual([3.913, 26.087])
  })

  it('applies minimum duration when scaled value is too small', () => {
    const scenes = [
      { id: 1, durationSec: 1 },
      { id: 2, durationSec: 1 },
    ]
    const normalized = normalizeSceneDurations(scenes, 2, 3.5)
    expect(normalized).toEqual([3.5, 3.5])
  })

  it('builds subtitle cues from narration text and keeps end aligned to total duration', () => {
    const cues = buildNarrationSubtitleCues('第一段很短。第二段稍微长一点，会多说一点内容。第三段收尾。', 9)
    expect(cues.length).toBeGreaterThanOrEqual(3)
    expect(cues[0].startSec).toBe(0)
    expect(cues[cues.length - 1].endSec).toBe(9)
    expect(cues.every((cue) => cue.endSec > cue.startSec)).toBe(true)
  })

  it('builds srt text from narration', () => {
    const srt = buildNarrationSrt('第一句。第二句。第三句。', 6, 8)
    expect(srt).toContain('1\n00:00:00,000 -->')
    expect(srt).toContain('2\n')
    expect(srt).not.toContain('4\n')
    expect(srt).toContain('第三句。')
  })

  it('builds ass text with wrapped dialogue lines', () => {
    const ass = buildNarrationAss('深夜的蜡烛忽明忽暗，钟先生突然从噩梦中惊醒。', 4, 22, {
      maxCharsPerLine: 10,
      maxLines: 2,
    })
    expect(ass).toContain('[Script Info]')
    expect(ass).toContain('Style: Default,Songti SC,36')
    expect(ass).toContain('Dialogue: 0,0:00:00.00,0:00:04.00,Default')
    expect(ass).toContain('\\N')
  })
})
