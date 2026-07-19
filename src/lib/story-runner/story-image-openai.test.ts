import { describe, expect, it } from 'vitest'
import {
  composeOpenAICompatibleReferenceBoard,
  generateStoryOpenAICompatibleImageOnce,
  shouldUseSingleBoardReferenceImage,
  shouldForceUrlStoryOpenAICompatibleResponseFormat,
} from './story-image-openai'

function createPngBuffer(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(24)
  Buffer.from('89504e470d0a1a0a', 'hex').copy(buffer, 0)
  buffer.writeUInt32BE(13, 8)
  buffer.write('IHDR', 12, 'ascii')
  buffer.writeUInt32BE(width, 16)
  buffer.writeUInt32BE(height, 20)
  return buffer
}

type SharpFactory = typeof import('sharp')
type SharpModule = SharpFactory & { default?: SharpFactory }

async function loadSharpOrNull(): Promise<SharpFactory | null> {
  try {
    const module = await import('sharp') as SharpModule
    return module.default || module
  } catch {
    return null
  }
}

describe('story openai-compatible image response format', () => {
  it('forces url responses only for gemini image route that requires remote download', () => {
    expect(shouldForceUrlStoryOpenAICompatibleResponseFormat('gemini-2.5-flash-image')).toBe(true)
    expect(shouldForceUrlStoryOpenAICompatibleResponseFormat('gpt-image-1')).toBe(false)
    expect(shouldForceUrlStoryOpenAICompatibleResponseFormat('dall-e-3')).toBe(false)
  })

  it('keeps gpt-image-1 multi-reference edits as multiple image parts', () => {
    expect(shouldUseSingleBoardReferenceImage('gpt-image-1', 2)).toBe(false)
    expect(shouldUseSingleBoardReferenceImage('gpt-image-1', 1)).toBe(false)
    expect(shouldUseSingleBoardReferenceImage('gpt-image-1-reference-board', 2)).toBe(true)
    expect(shouldUseSingleBoardReferenceImage('gemini-2.5-flash-image', 2)).toBe(false)
  })

  it('returns gemini png payload directly without sharp normalization', async () => {
    const source = createPngBuffer(1792, 1024)
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          data: [{ b64_json: source.toString('base64') }],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      )

    try {
      const normalized = await generateStoryOpenAICompatibleImageOnce({
        model: 'gemini-2.5-flash-image',
        prompt: 'test',
        referenceImages: [],
        apiKey: 'test',
        baseUrl: 'https://example.com',
        imageAspect: '16:9',
      })
      expect(normalized.equals(source)).toBe(true)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('returns gpt-image-1 png payload directly without sharp normalization', async () => {
    const source = createPngBuffer(1792, 1024)
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          data: [{ b64_json: source.toString('base64') }],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      )

    try {
      const normalized = await generateStoryOpenAICompatibleImageOnce({
        model: 'gpt-image-1',
        prompt: 'test',
        referenceImages: [],
        apiKey: 'test',
        baseUrl: 'https://example.com',
        imageAspect: '16:9',
      })
      expect(normalized.equals(source)).toBe(true)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('composes multiple reference images into a deterministic board', async () => {
    const sharp = await loadSharpOrNull()
    if (!sharp) return

    const first = await sharp({
      create: {
        width: 600,
        height: 900,
        channels: 3,
        background: { r: 120, g: 80, b: 40 },
      },
    }).png().toBuffer()
    const second = await sharp({
      create: {
        width: 700,
        height: 700,
        channels: 3,
        background: { r: 40, g: 80, b: 140 },
      },
    }).png().toBuffer()

    const board = await composeOpenAICompatibleReferenceBoard([first, second])
    const metadata = await sharp(board).metadata()
    expect(metadata.width).toBe(1536)
    expect(metadata.height).toBe(1024)
  })

  it('normalizes gpt-image-1 landscape output into story-safe near-16:9 canvas', async () => {
    const sharp = await loadSharpOrNull()
    if (!sharp) return

    const source = await sharp({
      create: {
        width: 1536,
        height: 1024,
        channels: 3,
        background: { r: 120, g: 80, b: 40 },
      },
    })
      .png()
      .toBuffer()

    const originalFetch = globalThis.fetch
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          data: [{ b64_json: source.toString('base64') }],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      )

    try {
      const normalized = await generateStoryOpenAICompatibleImageOnce({
        model: 'gpt-image-1',
        prompt: 'test',
        referenceImages: [],
        apiKey: 'test',
        baseUrl: 'https://example.com',
        imageAspect: '16:9',
      })
      const metadata = await sharp(normalized).metadata()
      expect(metadata.width).toBe(1792)
      expect(metadata.height).toBe(1024)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
