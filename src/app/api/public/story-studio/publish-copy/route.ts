import { NextRequest, NextResponse } from 'next/server'
import path from 'node:path'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { generatePublishCopyWithDashscope } from '@/lib/social-news-video/publish-copy'
import {
  loadDeepStoryReviews,
  loadFullZbyStoryCatalog,
  loadStoryReviewRecords,
} from '@/lib/social-news-video/story-catalog'
import type { HotNewsItem } from '@/lib/social-news-video/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function requiredString(row: Record<string, unknown>, field: string): string {
  const value = row[field]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ApiError('INVALID_PARAMS', { message: `${field} must be a non-empty string` })
  }
  return value.trim()
}

function requiredNumber(row: Record<string, unknown>, field: string): number {
  const value = row[field]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ApiError('INVALID_PARAMS', { message: `${field} must be a finite number` })
  }
  return value
}

function parseHotNews(value: unknown): HotNewsItem {
  const row = asRecord(value)
  if (!row) throw new ApiError('INVALID_PARAMS', { message: 'hotNews is required' })
  return {
    source: requiredString(row, 'source'),
    rank: requiredNumber(row, 'rank'),
    title: requiredString(row, 'title'),
    url: requiredString(row, 'url'),
    hot: requiredString(row, 'hot'),
    fetchedAt: requiredString(row, 'fetchedAt'),
  }
}

function resolveAliyunApiKey(): string {
  const apiKey = (process.env.ALIYUN_API_KEY || process.env.QWEN_API_KEY || '').trim()
  if (!apiKey) throw new ApiError('MISSING_CONFIG', { message: 'ALIYUN_API_KEY is not configured for the web process' })
  return apiKey
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

export const POST = apiHandler(async (request: NextRequest) => {
  const body = asRecord(await request.json().catch(() => null))
  if (!body) throw new ApiError('INVALID_PARAMS', { message: 'request body must be an object' })
  const storyId = requiredString(body, 'storyId')
  const socialIssue = requiredString(body, 'socialIssue')
  const matchReason = requiredString(body, 'matchReason')
  const hostOpening = typeof body.hostOpening === 'string' ? body.hostOpening.trim() : ''
  const hotNews = parseHotNews(body.hotNews)
  const workspaceRoot = process.cwd()
  const reviewDir = path.join(workspaceRoot, 'materials', 'zhiguai', 'analysis', 'content_ops_review')
  const reviewedStories = loadStoryReviewRecords(path.join(reviewDir, 'zby_sa_ops_review_rule_first_pass.json'))
  const stories = loadFullZbyStoryCatalog(workspaceRoot, reviewedStories)
  const story = stories.find((item) => item.id === storyId)
  if (!story) throw new ApiError('NOT_FOUND', { message: `story not found: ${storyId}` })
  const deepReviews = loadDeepStoryReviews(path.join(reviewDir, 'zby_s_llm_deep_review.json'))
  const result = await withTimeout(
    generatePublishCopyWithDashscope({
      apiKey: resolveAliyunApiKey(),
      model: process.env.SOCIAL_HOT_ANALYSIS_MODEL || 'qwen3-max',
      hotNews,
      socialIssue,
      matchReason,
      story,
      deepReview: deepReviews.get(story.id) || null,
      hostOpening,
    }),
    60000,
    'DASHSCOPE_PUBLISH_COPY_TIMEOUT',
  )

  return NextResponse.json({
    success: true,
    storyId,
    hotId: `${hotNews.source}#${hotNews.rank}`,
    copy: result.copy,
  })
})

