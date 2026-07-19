import { NextRequest, NextResponse } from 'next/server'
import path from 'node:path'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { writeEditorialProductionResult, type EditorialProductionStatus } from '@/lib/social-news-video/editorial-result'
import type { EditorialHotItem, EditorialRecommendation } from '@/lib/social-news-video/editorial-view'
import {
  loadDeepStoryReviews,
  loadFullZbyStoryCatalog,
  loadStoryReviewRecords,
} from '@/lib/social-news-video/story-catalog'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface LatestResultBody {
  jobId?: unknown
  status?: unknown
  storyId?: unknown
  runDir?: unknown
  videoPath?: unknown
  hostOpening?: unknown
  hotNews?: unknown
  socialIssue?: unknown
  matchReason?: unknown
  matchScore?: unknown
  matchEvidence?: unknown
  storyEvidence?: unknown
  comparisonNote?: unknown
  riskLevel?: unknown
  riskNotes?: unknown
  copy?: unknown
}

interface CopyBody {
  title?: unknown
  body?: unknown
  hashtags?: unknown
}

interface HotNewsBody {
  source?: unknown
  rank?: unknown
  title?: unknown
  url?: unknown
  hot?: unknown
  fetchedAt?: unknown
}

const SOURCE_LABELS: Record<string, string> = {
  weibo: '微博',
  baidu: '百度',
  toutiao: '头条',
  thepaper: '澎湃',
  zhihu: '知乎',
  douyin: '抖音',
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ApiError('INVALID_PARAMS', { message: `${field} must be a non-empty string` })
  }
  return value.trim()
}

function requiredNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ApiError('INVALID_PARAMS', { message: `${field} must be a finite number` })
  }
  return value
}

function optionalString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function relativeWorkspacePath(workspaceRoot: string, value: string, field: string): string {
  const resolvedRoot = path.resolve(workspaceRoot)
  const resolvedValue = path.resolve(resolvedRoot, value)
  const relative = path.relative(resolvedRoot, resolvedValue)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new ApiError('INVALID_PARAMS', { message: `${field} must be inside the workspace` })
  }
  return relative.split(path.sep).join('/')
}

function parseStatus(value: unknown): EditorialProductionStatus {
  if (value === 'queued' || value === 'running' || value === 'succeeded' || value === 'failed') return value
  throw new ApiError('INVALID_PARAMS', { message: 'status is invalid' })
}

function parseHotNews(value: unknown): HotNewsBody {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError('INVALID_PARAMS', { message: 'hotNews is required' })
  }
  return value as HotNewsBody
}

function parseCopy(value: unknown): { title: string; body: string; hashtags: string[] } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError('INVALID_PARAMS', { message: 'copy is required' })
  }
  const copy = value as CopyBody
  const title = requiredString(copy.title, 'copy.title')
  const body = requiredString(copy.body, 'copy.body')
  if (!Array.isArray(copy.hashtags)) {
    throw new ApiError('INVALID_PARAMS', { message: 'copy.hashtags must be an array' })
  }
  const hashtags = copy.hashtags.map((tag, index) => requiredString(tag, `copy.hashtags[${index}]`))
  if (hashtags.length !== 10 || new Set(hashtags).size !== hashtags.length) {
    throw new ApiError('INVALID_PARAMS', { message: 'copy.hashtags must contain 10 unique tags' })
  }
  return { title, body, hashtags }
}

export const POST = apiHandler(async (request: NextRequest) => {
  const body = (await request.json().catch(() => null)) as LatestResultBody | null
  if (!body || typeof body !== 'object') throw new ApiError('INVALID_PARAMS', { message: 'request body is required' })

  const storyId = requiredString(body.storyId, 'storyId')
  const jobId = requiredString(body.jobId, 'jobId')
  const status = parseStatus(body.status)
  const runDir = requiredString(body.runDir, 'runDir')
  const videoPath = requiredString(body.videoPath, 'videoPath')
  const hostOpening = requiredString(body.hostOpening, 'hostOpening')
  const socialIssue = requiredString(body.socialIssue, 'socialIssue')
  const matchReason = requiredString(body.matchReason, 'matchReason')
  const copy = parseCopy(body.copy)
  const hotNews = parseHotNews(body.hotNews)
  const source = requiredString(hotNews.source, 'hotNews.source')
  const rank = requiredNumber(hotNews.rank, 'hotNews.rank')
  const title = requiredString(hotNews.title, 'hotNews.title')
  const url = requiredString(hotNews.url, 'hotNews.url')
  const heat = requiredString(hotNews.hot, 'hotNews.hot')
  const fetchedAt = requiredString(hotNews.fetchedAt, 'hotNews.fetchedAt')
  const matchScore = typeof body.matchScore === 'number' && Number.isFinite(body.matchScore) ? body.matchScore : null
  const riskLevel = body.riskLevel === 'low' || body.riskLevel === 'medium' || body.riskLevel === 'high' ? body.riskLevel : 'medium'
  const reviewDir = path.join(process.cwd(), 'materials', 'zhiguai', 'analysis', 'content_ops_review')
  const reviewedStories = loadStoryReviewRecords(path.join(reviewDir, 'zby_sa_ops_review_rule_first_pass.json'))
  const stories = loadFullZbyStoryCatalog(process.cwd(), reviewedStories)
  const story = stories.find((item) => item.id === storyId)
  if (!story) throw new ApiError('NOT_FOUND', { message: `story not found: ${storyId}` })
  const deepReview = loadDeepStoryReviews(path.join(reviewDir, 'zby_s_llm_deep_review.json')).get(storyId)

  const hotItem: EditorialHotItem = {
    id: `${source}#${rank}`,
    source,
    sourceLabel: SOURCE_LABELS[source] || source,
    rank,
    title,
    heat,
    trend: '平稳',
    issue: socialIssue,
    lead: `这件事真正让人停下来想的，不只是结果，而是${socialIssue}。`,
    url,
    fetchedAt,
  }
  const recommendation: EditorialRecommendation = {
    hotId: hotItem.id,
    storyId,
    storyTitle: story.titleTrad,
    socialIssue,
    matchReason,
    matchScore,
    matchEvidence: optionalString(body.matchEvidence),
    storyEvidence: optionalString(body.storyEvidence),
    comparisonNote: optionalString(body.comparisonNote),
    storySourcePath: story.sourcePath,
    storyTextCharCount: story.textCharCount,
    storySummary: deepReview?.oneSentenceSummary || story.sourceExcerpt,
    storyAngle: deepReview?.modernNewsAngle || story.modernAngle,
    storyCategoryTags: story.categoryTags,
    storyRiskTags: story.riskTags,
    storyProductionRecommendation: story.productionRecommendation,
    riskLevel,
    riskNotes: optionalString(body.riskNotes) || '保持故事与现实新闻的边界。',
    publishTitle: copy.title,
    publishBody: copy.body,
    hashtags: copy.hashtags,
  }
  const result = writeEditorialProductionResult(process.cwd(), {
    updatedAt: new Date().toISOString(),
    jobId,
    status,
    storyId,
    runDir: relativeWorkspacePath(process.cwd(), runDir, 'runDir'),
    videoPath: relativeWorkspacePath(process.cwd(), videoPath, 'videoPath'),
    hostOpening,
    hotItem,
    recommendation,
  })
  return NextResponse.json({ success: true, result })
})
