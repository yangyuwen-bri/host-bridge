import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { queryStoryGenerationJobs } from '@/lib/story-materials/generate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function parseTrueFlag(value: string | null): boolean {
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

function parseLimit(value: string | null): number {
  if (!value) return 100
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ApiError('INVALID_PARAMS', { message: 'invalid limit' })
  }
  return Math.min(500, parsed)
}

export const GET = apiHandler(async (request: NextRequest) => {
  const query = request.nextUrl.searchParams
  const storyId = query.get('storyId')
  const jobId = query.get('jobId')
  const runningOnly = parseTrueFlag(query.get('running'))
  const limit = parseLimit(query.get('limit'))

  let jobs = [] as ReturnType<typeof queryStoryGenerationJobs>
  try {
    jobs = queryStoryGenerationJobs({
      workspaceRoot: process.cwd(),
      storyId,
      jobId,
      runningOnly,
      limit,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.startsWith('INVALID_STORY_ID:')) {
      throw new ApiError('INVALID_PARAMS', { message })
    }
    throw error
  }
  return NextResponse.json({
    success: true,
    jobs,
  })
})
