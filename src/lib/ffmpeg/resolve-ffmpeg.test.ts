import { describe, expect, it } from 'vitest'
import { selectFfmpegPath } from './resolve-ffmpeg'

describe('resolve ffmpeg helper', () => {
  it('prefers imageio ffmpeg over system ffmpeg when both exist', () => {
    const selected = selectFfmpegPath({
      envPath: null,
      imageioPath: '/imageio/ffmpeg',
      commandPath: '/usr/local/bin/ffmpeg',
    })
    expect(selected).toBe('/imageio/ffmpeg')
  })

  it('prefers explicit env ffmpeg path over discovered binaries', () => {
    const selected = selectFfmpegPath({
      envPath: '/custom/ffmpeg',
      imageioPath: '/imageio/ffmpeg',
      commandPath: '/usr/local/bin/ffmpeg',
    })
    expect(selected).toBe('/custom/ffmpeg')
  })

  it('throws when no ffmpeg candidate is available', () => {
    expect(() => selectFfmpegPath({
      envPath: null,
      imageioPath: null,
      commandPath: null,
    })).toThrowError('Unable to resolve ffmpeg path. Set FFMPEG_BIN or install ffmpeg.')
  })
})
