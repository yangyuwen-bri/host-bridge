import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveDefaultHardSubtitleFile, resolveDefaultSoftSubtitleFile } from './subtitle-artifacts'

function makeTempRunDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'subtitle-artifacts-test-'))
}

describe('subtitle artifact resolution', () => {
  it('prefers ass for hard subtitles when ass exists', () => {
    const runDir = makeTempRunDir()
    try {
      writeFileSync(path.join(runDir, '09_subtitles_auto.ass'), 'ass', 'utf8')
      writeFileSync(path.join(runDir, '09_subtitles_auto.srt'), 'srt', 'utf8')
      expect(resolveDefaultHardSubtitleFile(runDir)).toBe(path.join(runDir, '09_subtitles_auto.ass'))
    } finally {
      rmSync(runDir, { recursive: true, force: true })
    }
  })

  it('falls back to srt for hard subtitles when ass is missing', () => {
    const runDir = makeTempRunDir()
    try {
      writeFileSync(path.join(runDir, '09_subtitles_auto.srt'), 'srt', 'utf8')
      expect(resolveDefaultHardSubtitleFile(runDir)).toBe(path.join(runDir, '09_subtitles_auto.srt'))
    } finally {
      rmSync(runDir, { recursive: true, force: true })
    }
  })

  it('always uses srt for soft subtitles', () => {
    const runDir = makeTempRunDir()
    try {
      mkdirSync(runDir, { recursive: true })
      expect(resolveDefaultSoftSubtitleFile(runDir)).toBe(path.join(runDir, '09_subtitles_auto.srt'))
    } finally {
      rmSync(runDir, { recursive: true, force: true })
    }
  })
})
