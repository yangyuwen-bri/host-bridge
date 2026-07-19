import { describe, expect, it } from 'vitest'
import {
  assertStoryImageAspect,
  assertStoryImageAspectDimensions,
  buildStoryGoogleImageGenerationConfig,
  readPngDimensions,
  resolveStoryOpenAIImageSize,
  shouldUseOpenAICompatibleStoryImageModel,
} from './story-image-generation'

function createPngBuffer(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(24)
  Buffer.from('89504e470d0a1a0a', 'hex').copy(buffer, 0)
  buffer.writeUInt32BE(13, 8)
  buffer.write('IHDR', 12, 'ascii')
  buffer.writeUInt32BE(width, 16)
  buffer.writeUInt32BE(height, 20)
  return buffer
}

describe('story image generation helpers', () => {
  it('builds google image config with explicit aspect ratio', () => {
    expect(buildStoryGoogleImageGenerationConfig('16:9')).toEqual({
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: { aspectRatio: '16:9' },
    })
    expect(buildStoryGoogleImageGenerationConfig('9:16')).toEqual({
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: { aspectRatio: '9:16' },
    })
  })

  it('reads png dimensions from ihdr bytes', () => {
    expect(readPngDimensions(createPngBuffer(1792, 1024))).toEqual({
      width: 1792,
      height: 1024,
    })
  })

  it('accepts landscape png close to 16:9', () => {
    expect(() => assertStoryImageAspect({
      image: createPngBuffer(1792, 1024),
      imageAspect: '16:9',
    })).not.toThrow()
  })

  it('rejects square png for 16:9 stories', () => {
    expect(() => assertStoryImageAspect({
      image: createPngBuffer(1024, 1024),
      imageAspect: '16:9',
    })).toThrow('STORY_IMAGE_ASPECT_INVALID: expected=16:9 actual=1024x1024')
  })

  it('rejects portrait png for 16:9 stories', () => {
    expect(() => assertStoryImageAspect({
      image: createPngBuffer(1024, 1536),
      imageAspect: '16:9',
    })).toThrow('STORY_IMAGE_ASPECT_INVALID: expected=16:9 actual=1024x1536')
  })

  it('supports dimension-only validation for non-png normalized routes', () => {
    expect(() => assertStoryImageAspectDimensions({
      width: 1792,
      height: 1024,
      imageAspect: '16:9',
    })).not.toThrow()
  })

  it('routes supported openai-compatible image models with landscape size', () => {
    expect(shouldUseOpenAICompatibleStoryImageModel('gemini-2.5-flash-image')).toBe(true)
    expect(shouldUseOpenAICompatibleStoryImageModel('gpt-image-1')).toBe(true)
    expect(shouldUseOpenAICompatibleStoryImageModel('gemini-3.1-flash-image-preview')).toBe(false)
    expect(resolveStoryOpenAIImageSize('16:9')).toBe('1792x1024')
    expect(resolveStoryOpenAIImageSize('9:16')).toBe('1024x1792')
  })
})
