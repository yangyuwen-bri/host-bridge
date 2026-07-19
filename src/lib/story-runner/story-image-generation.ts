import type { StoryImageAspect } from './story-image-prompts'

type StoryGoogleImageGenerationConfig = {
  responseModalities: ['TEXT', 'IMAGE']
  imageConfig: {
    aspectRatio: StoryImageAspect
  }
}

type PngDimensions = {
  width: number
  height: number
}

const PNG_SIGNATURE = '89504e470d0a1a0a'
const TARGET_ASPECT_RATIO: Record<StoryImageAspect, number> = {
  '16:9': 16 / 9,
  '9:16': 9 / 16,
}
const ASPECT_RATIO_TOLERANCE = 0.08
export type StoryOpenAIImageSize = '1792x1024' | '1024x1792'

export function buildStoryGoogleImageGenerationConfig(
  imageAspect: StoryImageAspect,
): StoryGoogleImageGenerationConfig {
  return {
    responseModalities: ['TEXT', 'IMAGE'],
    imageConfig: {
      aspectRatio: imageAspect,
    },
  }
}

export function readPngDimensions(buffer: Buffer): PngDimensions | null {
  if (buffer.length < 24) return null
  if (buffer.subarray(0, 8).toString('hex') !== PNG_SIGNATURE) return null
  if (buffer.subarray(12, 16).toString('ascii') !== 'IHDR') return null

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  }
}

export function assertStoryImageAspectDimensions(params: {
  width: number
  height: number
  imageAspect: StoryImageAspect
}): void {
  if (params.width <= 0 || params.height <= 0) {
    throw new Error(
      `STORY_IMAGE_DIMENSION_INVALID: width=${params.width} height=${params.height}`,
    )
  }

  const actualRatio = params.width / params.height
  const targetRatio = TARGET_ASPECT_RATIO[params.imageAspect]
  if (Math.abs(actualRatio - targetRatio) > ASPECT_RATIO_TOLERANCE) {
    throw new Error(
      `STORY_IMAGE_ASPECT_INVALID: expected=${params.imageAspect} actual=${params.width}x${params.height}`,
    )
  }
}

export function assertStoryImageAspect(params: {
  image: Buffer
  imageAspect: StoryImageAspect
}): void {
  const dimensions = readPngDimensions(params.image)
  if (!dimensions) {
    throw new Error('STORY_IMAGE_DIMENSION_UNREADABLE: expected PNG payload with IHDR dimensions')
  }
  assertStoryImageAspectDimensions({
    width: dimensions.width,
    height: dimensions.height,
    imageAspect: params.imageAspect,
  })
}

export function shouldUseOpenAICompatibleStoryImageModel(model: string): boolean {
  const normalized = model.trim()
  return normalized === 'gemini-2.5-flash-image' || normalized === 'gpt-image-1'
}

export function resolveStoryOpenAIImageSize(
  imageAspect: StoryImageAspect,
): StoryOpenAIImageSize {
  return imageAspect === '9:16' ? '1024x1792' : '1792x1024'
}
