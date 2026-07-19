import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TTS_MODEL_VC,
  DEFAULT_TTS_VOICE_VC,
  DEFAULT_TTS_VOICE_VD,
  resolveStoryTtsVoicePresets,
  TTS_MODEL_PRESETS,
} from './tts-config'

describe('story materials tts config', () => {
  it('includes vc model in presets and resolves vc voices', () => {
    expect(TTS_MODEL_PRESETS).toContain(DEFAULT_TTS_MODEL_VC)
    expect(resolveStoryTtsVoicePresets(DEFAULT_TTS_MODEL_VC)).toEqual([DEFAULT_TTS_VOICE_VC])
  })

  it('keeps vd voices available when switching back to vd model', () => {
    expect(resolveStoryTtsVoicePresets('qwen3-tts-vd-2026-01-26')).toContain(DEFAULT_TTS_VOICE_VD)
  })

  it('falls back to general voices for non-vd and non-vc models', () => {
    expect(resolveStoryTtsVoicePresets('qwen3-tts-instruct-flash')).toEqual(['Cherry', 'Chelsie', 'Serena', 'Ethan'])
  })
})
