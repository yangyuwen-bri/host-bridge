import { NextRequest } from 'next/server'
import { createReadStream, promises as fsp } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { apiHandler, ApiError } from '@/lib/api-errors'
import {
  ensureInsideAllowedRoots,
  ensureInsideWorkspacePath,
  parseRangeHeader,
} from '@/lib/story-materials/local-file'

function contentTypeByExt(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.mp4') return 'video/mp4'
  if (ext === '.wav') return 'audio/wav'
  if (ext === '.srt') return 'text/plain; charset=utf-8'
  if (ext === '.txt') return 'text/plain; charset=utf-8'
  if (ext === '.log') return 'text/plain; charset=utf-8'
  if (ext === '.json') return 'application/json; charset=utf-8'
  if (ext === '.png') return 'image/png'
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  return 'application/octet-stream'
}

export const GET = apiHandler(async (request: NextRequest) => {
  const requestedPath = request.nextUrl.searchParams.get('path')
  if (!requestedPath) {
    throw new ApiError('INVALID_PARAMS')
  }

  const workspaceRoot = process.cwd()
  let filePath: string
  try {
    filePath = ensureInsideWorkspacePath(workspaceRoot, requestedPath)
    ensureInsideAllowedRoots(filePath, [
      path.join(workspaceRoot, 'materials', 'zhiguai'),
      path.join(workspaceRoot, 'materials', 'zibuyu', 'runs'),
    ])
  } catch {
    throw new ApiError('INVALID_PARAMS')
  }

  const stat = await fsp.stat(filePath).catch(() => null)
  if (!stat || !stat.isFile()) {
    throw new ApiError('NOT_FOUND')
  }

  const type = contentTypeByExt(filePath)
  const range = parseRangeHeader(request.headers.get('range'), stat.size)
  if (range) {
    const stream = createReadStream(filePath, { start: range.start, end: range.end })
    const webStream = Readable.toWeb(stream) as ReadableStream<Uint8Array>
    const length = range.end - range.start + 1
    return new Response(webStream, {
      status: 206,
      headers: {
        'Content-Type': type,
        'Content-Length': String(length),
        'Content-Range': `bytes ${range.start}-${range.end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
      },
    })
  }

  const stream = createReadStream(filePath)
  const webStream = Readable.toWeb(stream) as ReadableStream<Uint8Array>
  return new Response(webStream, {
    status: 200,
    headers: {
      'Content-Type': type,
      'Content-Length': String(stat.size),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    },
  })
})
