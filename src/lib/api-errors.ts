import { NextRequest, NextResponse } from 'next/server'

export type ApiErrorCode = 'INVALID_PARAMS' | 'NOT_FOUND' | 'CONFLICT' | 'MISSING_CONFIG' | 'EXTERNAL_ERROR' | 'INTERNAL_ERROR'

export class ApiError extends Error {
  readonly code: ApiErrorCode
  readonly details: Record<string, unknown>

  constructor(code: ApiErrorCode, details: Record<string, unknown> = {}) {
    super(typeof details.message === 'string' ? details.message : code)
    this.name = 'ApiError'
    this.code = code
    this.details = details
  }
}

type RouteContext = { params: Promise<Record<string, string | string[] | undefined>> }
type RouteHandler = (request: NextRequest, context: RouteContext) => Promise<Response | NextResponse>

export function apiHandler(handler: RouteHandler): RouteHandler {
  return async (request, context) => {
    try {
      return await handler(request, context)
    } catch (error: unknown) {
      if (error instanceof ApiError) {
        const status = error.code === 'NOT_FOUND' ? 404 : error.code === 'CONFLICT' ? 409 : error.code === 'INTERNAL_ERROR' ? 500 : 400
        return NextResponse.json({ success: false, error: { code: error.code, message: error.message } }, { status })
      }
      const message = error instanceof Error ? error.message : String(error)
      return NextResponse.json({ success: false, error: { code: 'INTERNAL_ERROR', message } }, { status: 500 })
    }
  }
}
