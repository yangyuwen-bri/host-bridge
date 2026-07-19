import { downloadBinaryWithRedirects } from '../story-materials/http-download'
import type { StoryImageAspect } from './story-image-prompts'
import {
  assertStoryImageAspectDimensions,
  readPngDimensions,
  resolveStoryOpenAIImageSize,
} from './story-image-generation'

type StoryOpenAICompatibleImageResponseRow = {
  b64_json?: string | null
  url?: string | null
}

const GPT_IMAGE_REFERENCE_TILE_WIDTH = 768
const GPT_IMAGE_REFERENCE_TILE_HEIGHT = 1024

type SharpFactory = typeof import('sharp')
type SharpModule = SharpFactory & { default?: SharpFactory }

let sharpModulePromise: Promise<SharpFactory> | null = null

async function loadSharp(): Promise<SharpFactory> {
  if (!sharpModulePromise) {
    sharpModulePromise = import('sharp').then((module) => {
      const sharpModule = module as SharpModule
      return sharpModule.default || sharpModule
    })
  }
  return await sharpModulePromise
}

export function shouldForceUrlStoryOpenAICompatibleResponseFormat(model: string): boolean {
  return model.trim() === 'gemini-2.5-flash-image'
}

export function shouldUseSingleBoardReferenceImage(model: string, referenceImageCount: number): boolean {
  return model.trim() === 'gpt-image-1-reference-board' && referenceImageCount > 1
}

export async function composeOpenAICompatibleReferenceBoard(referenceImages: Buffer[]): Promise<Buffer> {
  const sharp = await loadSharp()
  if (referenceImages.length === 0) {
    throw new Error('OPENAI_COMPATIBLE_REFERENCE_BOARD_EMPTY')
  }
  if (referenceImages.length === 1) {
    return await sharp(referenceImages[0]).png().toBuffer()
  }

  const columns = Math.min(2, referenceImages.length)
  const rows = Math.ceil(referenceImages.length / columns)
  const canvasWidth = columns * GPT_IMAGE_REFERENCE_TILE_WIDTH
  const canvasHeight = rows * GPT_IMAGE_REFERENCE_TILE_HEIGHT

  const composites = await Promise.all(referenceImages.map(async (image, index) => {
    const tile = await sharp({
      create: {
        width: GPT_IMAGE_REFERENCE_TILE_WIDTH,
        height: GPT_IMAGE_REFERENCE_TILE_HEIGHT,
        channels: 3,
        background: { r: 22, g: 20, b: 18 },
      },
    })
      .composite([{
        input: await sharp(image)
          .resize(GPT_IMAGE_REFERENCE_TILE_WIDTH, GPT_IMAGE_REFERENCE_TILE_HEIGHT, {
            fit: 'contain',
            position: 'centre',
            background: { r: 22, g: 20, b: 18, alpha: 1 },
          })
          .png()
          .toBuffer(),
      }])
      .png()
      .toBuffer()

    return {
      input: tile,
      left: (index % columns) * GPT_IMAGE_REFERENCE_TILE_WIDTH,
      top: Math.floor(index / columns) * GPT_IMAGE_REFERENCE_TILE_HEIGHT,
    }
  }))

  return await sharp({
    create: {
      width: canvasWidth,
      height: canvasHeight,
      channels: 3,
      background: { r: 22, g: 20, b: 18 },
    },
  })
    .composite(composites)
    .png()
    .toBuffer()
}

function buildOpenAICompatibleImageUrl(baseUrl: string, pathname: string): string {
  return `${baseUrl.replace(/\/+$/u, '')}/v1${pathname}`
}

async function normalizeDownloadedStoryImage(params: {
  data: Buffer
  model: string
  imageAspect: StoryImageAspect
}): Promise<Buffer> {
  if (params.model.trim() === 'gemini-2.5-flash-image' || params.model.trim() === 'gpt-image-1') {
    const dimensions = readPngDimensions(params.data)
    if (!dimensions) {
      throw new Error('OPENAI_COMPATIBLE_STORY_IMAGE_DIMENSION_UNREADABLE')
    }
    assertStoryImageAspectDimensions({
      width: dimensions.width,
      height: dimensions.height,
      imageAspect: params.imageAspect,
    })
    return params.data
  }

  const sharp = await loadSharp()
  const metadata = await sharp(params.data).metadata()
  if (!metadata.width || !metadata.height) {
    throw new Error('OPENAI_COMPATIBLE_STORY_IMAGE_DIMENSION_UNREADABLE')
  }

  try {
    assertStoryImageAspectDimensions({
      width: metadata.width,
      height: metadata.height,
      imageAspect: params.imageAspect,
    })
    return await sharp(params.data).png().toBuffer()
  } catch (error) {
    if (
      params.model.trim() === 'gpt-image-1'
      && params.imageAspect === '16:9'
      && metadata.width > metadata.height
    ) {
      const [targetWidthText, targetHeightText] = resolveStoryOpenAIImageSize(params.imageAspect).split('x')
      const targetWidth = Number.parseInt(targetWidthText, 10)
      const targetHeight = Number.parseInt(targetHeightText, 10)
      if (Number.isFinite(targetWidth) && Number.isFinite(targetHeight)) {
        const blurredBackground = await sharp(params.data)
          .resize(targetWidth, targetHeight, { fit: 'cover', position: 'centre' })
          .blur(18)
          .png()
          .toBuffer()
        const foreground = await sharp(params.data)
          .resize(targetWidth, targetHeight, { fit: 'contain', position: 'centre' })
          .png()
          .toBuffer()
        return await sharp(blurredBackground)
          .composite([{ input: foreground }])
          .png()
          .toBuffer()
      }
    }
    throw error
  }
}

function extractImageResponseRow(value: unknown): StoryOpenAICompatibleImageResponseRow | null {
  if (!Array.isArray(value)) return null
  const first = value[0]
  if (!first || typeof first !== 'object') return null
  const row = first as Record<string, unknown>
  return {
    b64_json: typeof row.b64_json === 'string' ? row.b64_json : null,
    url: typeof row.url === 'string' ? row.url : null,
  }
}

export async function generateStoryOpenAICompatibleImageOnce(params: {
  model: string
  prompt: string
  referenceImages: Buffer[]
  apiKey: string
  baseUrl: string
  imageAspect: StoryImageAspect
}): Promise<Buffer> {
  const size = resolveStoryOpenAIImageSize(params.imageAspect)
  const forceUrlResponseFormat = shouldForceUrlStoryOpenAICompatibleResponseFormat(params.model)
  let payload: Record<string, unknown>
  if (params.referenceImages.length > 0) {
    const preparedReferenceImages = shouldUseSingleBoardReferenceImage(params.model, params.referenceImages.length)
      ? [await composeOpenAICompatibleReferenceBoard(params.referenceImages)]
      : params.referenceImages
    const formData = new FormData()
    formData.append('model', params.model)
    formData.append('prompt', params.prompt)
    formData.append('size', size)
    if (forceUrlResponseFormat) {
      formData.append('response_format', 'url')
    }
    preparedReferenceImages.forEach((image, index) => {
      formData.append(
        'image',
        new Blob([new Uint8Array(image)], { type: 'image/png' }),
        `reference-${index + 1}.png`,
      )
    })
    const response = await fetch(buildOpenAICompatibleImageUrl(params.baseUrl, '/images/edits'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
      },
      body: formData,
    })
    payload = await response.json().catch(() => ({})) as Record<string, unknown>
    if (!response.ok) {
      const errorMessage = extractOpenAICompatibleImageError(payload, response.status)
      throw new Error(errorMessage)
    }
  } else {
    const response = await fetch(buildOpenAICompatibleImageUrl(params.baseUrl, '/images/generations'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: params.model,
        prompt: params.prompt,
        size,
        ...(forceUrlResponseFormat ? { response_format: 'url' } : {}),
      }),
    })
    payload = await response.json().catch(() => ({})) as Record<string, unknown>
    if (!response.ok) {
      const errorMessage = extractOpenAICompatibleImageError(payload, response.status)
      throw new Error(errorMessage)
    }
  }

  const row = extractImageResponseRow(payload.data)
  if (row?.b64_json && row.b64_json.trim().length > 0) {
    return await normalizeDownloadedStoryImage({
      data: Buffer.from(row.b64_json, 'base64'),
      model: params.model,
      imageAspect: params.imageAspect,
    })
  }

  if (row?.url && row.url.trim().length > 0) {
    const data = await downloadBinaryWithRedirects({
      url: row.url,
      timeoutMs: 240_000,
    })
    return await normalizeDownloadedStoryImage({
      data,
      model: params.model,
      imageAspect: params.imageAspect,
    })
  }

  throw new Error('OPENAI_COMPATIBLE_STORY_IMAGE_EMPTY')
}

function extractOpenAICompatibleImageError(payload: Record<string, unknown>, status: number): string {
  const errorValue = payload.error
  if (errorValue && typeof errorValue === 'object') {
    const row = errorValue as Record<string, unknown>
    const code = typeof row.code === 'string' || typeof row.code === 'number' ? String(row.code) : ''
    const message = typeof row.message === 'string' ? row.message : ''
    if (code || message) {
      return `${code} ${message}`.trim()
    }
  }
  return `HTTP ${status}`
}
