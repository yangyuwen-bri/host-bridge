import { describe, expect, it } from 'vitest'
import {
  buildStoryTtsPreviewFileName,
  generateStoryTtsPreview,
  normalizeStoryTtsPreviewText,
} from './tts-preview'

describe('story materials tts preview', () => {
  it('normalizes preview text to simplified chinese', () => {
    expect(normalizeStoryTtsPreviewText('  漢語與廣東話，陳生見屍體後說這裡太怪了。  ')).toBe(
      '汉语与广东话，陈生见尸体后说这里太怪了。',
    )
  })

  it('builds normalized preview filename', () => {
    const fileName = buildStoryTtsPreviewFileName({
      model: 'QWEN3 TTS/vd-2026-01-26',
      voice: 'Voice A1#中文',
    })
    expect(fileName.endsWith('.wav')).toBe(true)
    expect(fileName).toMatch(/^\d{8}-\d{6}_qwen3-tts-vd-2026-01-26_voice-a1\.wav$/)
  })

  it('fails fast on empty preview text', async () => {
    await expect(generateStoryTtsPreview({
      workspaceRoot: '/tmp',
      text: '   ',
      ttsModel: 'qwen3-tts-vd-2026-01-26',
      ttsVoice: 'qwen-tts-vd-voicea1canon-voice-20260301192739696-97f2',
      ttsInstructions: '中文女声',
    })).rejects.toThrow('EMPTY_PREVIEW_TEXT')
  })

  it('fails fast on empty tts model', async () => {
    await expect(generateStoryTtsPreview({
      workspaceRoot: '/tmp',
      text: 'test',
      ttsModel: '   ',
      ttsVoice: 'qwen-tts-vd-voicea1canon-voice-20260301192739696-97f2',
      ttsInstructions: '中文女声',
    })).rejects.toThrow('EMPTY_TTS_MODEL')
  })

  it('fails fast on empty tts voice', async () => {
    await expect(generateStoryTtsPreview({
      workspaceRoot: '/tmp',
      text: 'test',
      ttsModel: 'qwen3-tts-vd-2026-01-26',
      ttsVoice: '   ',
      ttsInstructions: '中文女声',
    })).rejects.toThrow('EMPTY_TTS_VOICE')
  })
})
