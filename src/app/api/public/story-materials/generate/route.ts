import { NextRequest, NextResponse } from 'next/server'
import { ApiError, apiHandler } from '@/lib/api-errors'
import {
  STORY_GENERATION_MODE,
  enqueueStoryGeneration,
  isStoryGenerationConflictError,
  type StoryGenerationMode,
} from '@/lib/story-materials/generate'
import {
  parseStoryGenerationModelConfig,
  type StoryGenerationModelConfig,
} from '@/lib/story-materials/model-config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface GenerateRequestBody {
  storyId?: unknown
  hostOpening?: unknown
  mode?: unknown
  modelConfig?: unknown
}

function parseMode(value: unknown): StoryGenerationMode {
  if (typeof value !== 'string' || !value.trim()) return STORY_GENERATION_MODE.CANONICAL_LONG
  const normalized = value.trim()
  if (normalized !== STORY_GENERATION_MODE.CANONICAL_LONG) {
    throw new ApiError('INVALID_PARAMS', { message: `unsupported mode: ${normalized}` })
  }
  return normalized
}

export const POST = apiHandler(async (request: NextRequest) => {
  const body = (await request.json().catch(() => null)) as GenerateRequestBody | null
  if (!body || typeof body !== 'object') {
    throw new ApiError('INVALID_PARAMS', { message: 'request body is required' })
  }
  if (typeof body.storyId !== 'string' || !body.storyId.trim()) {
    throw new ApiError('INVALID_PARAMS', { message: 'storyId is required' })
  }
  if (typeof body.hostOpening !== 'string' || !body.hostOpening.trim()) {
    throw new ApiError('INVALID_PARAMS', { message: 'hostOpening is required' })
  }

  const mode = parseMode(body.mode)
  let modelConfig: StoryGenerationModelConfig
  try {
    modelConfig = parseStoryGenerationModelConfig(body.modelConfig)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new ApiError('INVALID_PARAMS', { message })
  }
  try {
    const job = enqueueStoryGeneration({
      workspaceRoot: process.cwd(),
      storyId: body.storyId,
      hostOpening: body.hostOpening,
      mode,
      modelConfig,
    })
    return NextResponse.json({
      success: true,
      job,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (isStoryGenerationConflictError(error)) {
      throw new ApiError('CONFLICT', { message })
    }
    if (
      message.startsWith('INVALID_STORY_ID:')
      || message.startsWith('UNSUPPORTED_MODE:')
      || message.startsWith('MISSING_QWEN_API_KEY')
      || message.startsWith('HOST_OPENING_REQUIRED')
      || message.startsWith('HOST_OPENING_TOO_LONG')
    ) {
      throw new ApiError('INVALID_PARAMS', { message })
    }
    if (
      message.startsWith('CATALOG_NOT_FOUND:')
      || message.startsWith('STORY_NOT_FOUND:')
      || message.startsWith('SOURCE_FILE_NOT_FOUND:')
    ) {
      throw new ApiError('NOT_FOUND', { message })
    }
    throw error
  }
})
