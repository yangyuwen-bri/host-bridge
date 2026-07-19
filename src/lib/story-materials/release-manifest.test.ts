import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildStoryReleaseManifest,
  preferredStoryReleaseVideo,
  readStoryReleaseManifest,
  writeStoryReleaseManifest,
} from './release-manifest'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('story release manifest', () => {
  it('records portable artifact paths, object keys, sizes, and checksums', () => {
    const workspaceRoot = os.tmpdir()
    const runDir = path.join(workspaceRoot, `story-release-${Date.now()}`)
    tempDirectories.push(runDir)
    mkdirSync(runDir, { recursive: true })
    for (const fileName of ['08_final_story.mp4', '10_final_story_hardsub.mp4', '10_final_story_softsub.mp4', '09_subtitles_auto.srt']) {
      writeFileSync(path.join(runDir, fileName), `asset:${fileName}`, 'utf8')
    }

    const manifest = buildStoryReleaseManifest({
      workspaceRoot,
      runDir,
      storyId: 'zby-v14-027',
      storyTitle: '鬼入人腹',
      generatedAt: '2026-07-15T08:00:00.000Z',
      context: { hotTitle: '测试热点' },
    })
    const manifestPath = writeStoryReleaseManifest(manifest, runDir)
    const loaded = readStoryReleaseManifest(runDir)

    expect(manifest.releaseId).toBe('2026-07-15-zby-v14-027')
    expect(manifest.storage.state).toBe('local-only')
    expect(manifest.artifacts.find((item) => item.kind === 'hard_sub_video')?.objectKey).toBe('story-releases/2026-07-15/zby-v14-027/10_final_story_hardsub.mp4')
    expect(manifest.artifacts.find((item) => item.kind === 'subtitle_srt')?.sizeBytes).toBeGreaterThan(0)
    expect(preferredStoryReleaseVideo(manifest).kind).toBe('hard_sub_video')
    expect(loaded?.context.hotTitle).toBe('测试热点')
    expect(JSON.parse(readFileSync(manifestPath, 'utf8')).schemaVersion).toBe(1)
  })
})
