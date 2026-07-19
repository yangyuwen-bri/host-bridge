import path from 'node:path'

export function ensureInsideWorkspacePath(workspaceRoot: string, requestedPath: string): string {
  const resolved = path.resolve(requestedPath)
  const normalizedRoot = workspaceRoot.endsWith(path.sep) ? workspaceRoot : `${workspaceRoot}${path.sep}`
  if (!resolved.startsWith(normalizedRoot) && resolved !== workspaceRoot) {
    throw new Error('path-outside-workspace')
  }
  return resolved
}

export function ensureInsideAllowedRoots(resolvedPath: string, allowedRoots: string[]): void {
  const allowed = allowedRoots.some((root) => {
    const normalizedRoot = root.endsWith(path.sep) ? root : `${root}${path.sep}`
    return resolvedPath.startsWith(normalizedRoot) || resolvedPath === root
  })
  if (!allowed) {
    throw new Error('path-not-allowed')
  }
}

export function parseRangeHeader(rangeHeader: string | null, fileSize: number): { start: number; end: number } | null {
  if (!rangeHeader || !rangeHeader.startsWith('bytes=')) return null
  const [startStr, endStr] = rangeHeader.replace('bytes=', '').split('-')
  const start = startStr ? Number.parseInt(startStr, 10) : Number.NaN
  const end = endStr ? Number.parseInt(endStr, 10) : Number.NaN
  if (Number.isNaN(start) && Number.isNaN(end)) return null
  if (!Number.isNaN(start) && start >= fileSize) return null

  let rangeStart = Number.isNaN(start) ? 0 : Math.max(0, start)
  let rangeEnd = Number.isNaN(end) ? fileSize - 1 : Math.min(fileSize - 1, end)

  if (Number.isNaN(start) && !Number.isNaN(end)) {
    const tailLength = Math.max(0, end)
    rangeStart = Math.max(0, fileSize - tailLength)
    rangeEnd = fileSize - 1
  }
  if (rangeEnd < rangeStart) return null
  return { start: rangeStart, end: rangeEnd }
}
