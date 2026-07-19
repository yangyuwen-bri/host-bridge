import { NextRequest, NextResponse } from 'next/server'
import path from 'node:path'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { buildEditorialSnapshot, readLatestEditorialSnapshot } from '@/lib/social-news-video/editorial-view'
import { analyzeFullStoryCatalogWithDashscope } from '@/lib/social-news-video/full-catalog-analysis'
import { DEFAULT_NEWSNOW_SOURCES, buildSocialHotVideoPlanFromModelDecision } from '@/lib/social-news-video/planner'
import { fetchNewsNowHotItems } from '@/lib/social-news-video/newsnow'
import { persistSocialHotVideoPlan } from '@/lib/social-news-video/plan-store'
import { collectProducedStoryIds, loadDeepStoryReviews, loadFullZbyStoryCatalog, loadStoryReviewRecords } from '@/lib/social-news-video/story-catalog'
import type { HotNewsFetchResult } from '@/lib/social-news-video/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface AnalyzeRequestBody {
  sources?: unknown
  limit?: unknown
  storyCandidateLimit?: unknown
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function timestampForPath(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function parseSources(value: unknown): string[] {
  if (typeof value === 'undefined') return [...DEFAULT_NEWSNOW_SOURCES]
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string' || item.trim().length === 0)) {
    throw new ApiError('INVALID_PARAMS', { message: 'sources must be a non-empty string array' })
  }
  return value.map((item) => item.trim())
}

function parseBoundedInteger(value: unknown, field: string, fallback: number, min: number, max: number): number {
  if (typeof value === 'undefined') return fallback
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new ApiError('INVALID_PARAMS', { message: `${field} must be an integer between ${min} and ${max}` })
  }
  return value
}

function resolveAliyunApiKey(): string {
  const apiKey = (process.env.ALIYUN_API_KEY || process.env.QWEN_API_KEY || '').trim()
  if (!apiKey) throw new ApiError('MISSING_CONFIG', { message: 'ALIYUN_API_KEY is not configured for the web process' })
  return apiKey
}

function readModelInputs(workspaceRoot: string) {
  const reviewDir = path.join(workspaceRoot, 'materials', 'zhiguai', 'analysis', 'content_ops_review')
  const reviewedStories = loadStoryReviewRecords(path.join(reviewDir, 'zby_sa_ops_review_rule_first_pass.json'))
  return {
    stories: loadFullZbyStoryCatalog(workspaceRoot, reviewedStories),
    deepReviews: loadDeepStoryReviews(path.join(reviewDir, 'zby_s_llm_deep_review.json')),
    producedStoryIds: collectProducedStoryIds(path.join(workspaceRoot, 'materials', 'zibuyu', 'runs')),
  }
}

export const GET = apiHandler(async () => {
  const snapshot = readLatestEditorialSnapshot(process.cwd())
  return NextResponse.json({ success: true, snapshot })
})

export const POST = apiHandler(async (request: NextRequest) => {
  const body = (await request.json().catch(() => null)) as AnalyzeRequestBody | null
  const sources = parseSources(body?.sources)
  const limit = parseBoundedInteger(body?.limit, 'limit', 5, 1, 10)
  const storyCandidateLimit = parseBoundedInteger(body?.storyCandidateLimit, 'storyCandidateLimit', 120, 20, 250)
  const workspaceRoot = process.cwd()

  let hotNews
  try {
    hotNews = await withTimeout<HotNewsFetchResult>(
      fetchNewsNowHotItems({ sources, timeoutMs: 10000 }),
      12000,
      'NEWSNOW_REQUEST_TIMEOUT',
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new ApiError('EXTERNAL_ERROR', { message })
  }

  const modelInputs = readModelInputs(workspaceRoot)
  const modelAnalysis = await withTimeout(
    analyzeFullStoryCatalogWithDashscope({
      hotNews,
      ...modelInputs,
      limit,
      batchSize: storyCandidateLimit,
      apiKey: resolveAliyunApiKey(),
      model: process.env.SOCIAL_HOT_ANALYSIS_MODEL || 'qwen3-max',
    }),
    180000,
    'DASHSCOPE_FULL_CATALOG_ANALYSIS_TIMEOUT',
  )
  const runTimestamp = timestampForPath()
  const plan = buildSocialHotVideoPlanFromModelDecision({
    workspaceRoot,
    outputDir: path.join(workspaceRoot, 'materials', 'zibuyu', 'social-hot-plans', runTimestamp),
    hotNews,
    stories: modelInputs.stories,
    deepReviews: modelInputs.deepReviews,
    modelDecision: modelAnalysis.decision,
    limit,
    runTimestamp,
    llmModel: process.env.SOCIAL_HOT_VIDEO_LLM_MODEL || 'deepseek-v4-flash',
    imageModel: process.env.SOCIAL_HOT_VIDEO_IMAGE_MODEL || 'qwen-image-2.0',
    ttsModel: process.env.SOCIAL_HOT_VIDEO_TTS_MODEL || 'qwen3-tts-vd-2026-01-26',
  })
  persistSocialHotVideoPlan({
    directory: path.join(workspaceRoot, 'materials', 'zibuyu', 'social-hot-plans', runTimestamp),
    hotNews,
    analysis: modelAnalysis,
    plan,
  })

  return NextResponse.json({
    success: true,
    snapshot: buildEditorialSnapshot({ status: 'live', hotNews, plan }),
  })
})
