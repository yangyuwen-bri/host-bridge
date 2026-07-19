import { existsSync } from 'node:fs'
import path from 'node:path'

export function resolveDefaultHardSubtitleFile(runDir: string): string {
  const assPath = path.join(runDir, '09_subtitles_auto.ass')
  if (existsSync(assPath)) return assPath
  return path.join(runDir, '09_subtitles_auto.srt')
}

export function resolveDefaultSoftSubtitleFile(runDir: string): string {
  return path.join(runDir, '09_subtitles_auto.srt')
}
