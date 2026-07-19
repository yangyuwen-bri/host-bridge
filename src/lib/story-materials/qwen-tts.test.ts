import { describe, expect, it } from 'vitest'
import {
  buildQwenRealtimeSessionConfig,
  isRealtimeQwenTtsModel,
  wrapPcm16MonoToWav,
} from './qwen-tts'

describe('qwen tts helpers', () => {
  it('detects realtime qwen tts models explicitly', () => {
    expect(isRealtimeQwenTtsModel('qwen3-tts-vc-realtime-2026-01-15')).toBe(true)
    expect(isRealtimeQwenTtsModel('qwen3-tts-instruct-flash-realtime')).toBe(true)
    expect(isRealtimeQwenTtsModel('qwen3-tts-vc-2026-01-22')).toBe(false)
  })

  it('omits unsupported instructions for vc realtime session config', () => {
    expect(
      buildQwenRealtimeSessionConfig({
        model: 'qwen3-tts-vc-realtime-2026-01-15',
        voice: 'voice-1',
        instructions: '中文女声，悬疑口播。',
      }),
    ).toEqual({
      mode: 'commit',
      voice: 'voice-1',
      language_type: 'Chinese',
      response_format: 'pcm',
      sample_rate: 24000,
    })
  })

  it('preserves instructions for instruct realtime session config', () => {
    expect(
      buildQwenRealtimeSessionConfig({
        model: 'qwen3-tts-instruct-flash-realtime',
        voice: 'Cherry',
        instructions: '中文女声，悬疑口播。',
      }),
    ).toEqual({
      mode: 'commit',
      voice: 'Cherry',
      language_type: 'Chinese',
      response_format: 'pcm',
      sample_rate: 24000,
      instructions: '中文女声，悬疑口播。',
      optimize_instructions: true,
    })
  })

  it('wraps pcm16 mono audio into a valid wav header', () => {
    const pcm = Buffer.from([0x01, 0x00, 0xff, 0x7f])
    const wav = wrapPcm16MonoToWav(pcm, 24000)
    expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF')
    expect(wav.subarray(8, 12).toString('ascii')).toBe('WAVE')
    expect(wav.subarray(36, 40).toString('ascii')).toBe('data')
    expect(wav.readUInt32LE(40)).toBe(pcm.length)
    expect(wav.subarray(44)).toEqual(pcm)
  })
})
