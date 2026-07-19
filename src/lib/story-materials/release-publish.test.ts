import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildStoryReleaseManifest, readStoryReleaseManifest, writeStoryReleaseManifest } from './release-manifest'
import { publishStoryRelease } from './release-publish'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('story release publisher', () => {
  it('records local artifact locators without changing the portable object keys', async () => {
    const workspaceRoot = os.tmpdir()
    const runDir = path.join(workspaceRoot, `story-release-publish-${Date.now()}`)
    tempDirectories.push(runDir)
    mkdirSync(runDir, { recursive: true })
    for (const fileName of ['08_final_story.mp4', '10_final_story_hardsub.mp4', '10_final_story_softsub.mp4']) {
      writeFileSync(path.join(runDir, fileName), fileName, 'utf8')
    }
    const manifest = buildStoryReleaseManifest({
      workspaceRoot,
      runDir,
      storyId: 'zby-v14-027',
      storyTitle: '鬼入人腹',
      generatedAt: '2026-07-15T08:00:00.000Z',
    })
    writeStoryReleaseManifest(manifest, runDir)

    const published = await publishStoryRelease({ workspaceRoot, runDir, provider: 'local' })
    const reloaded = readStoryReleaseManifest(runDir)

    expect(published.storage.provider).toBe('local')
    expect(published.storage.state).toBe('local-only')
    expect(published.artifacts.every((item) => item.storageLocator === item.localPath)).toBe(true)
    expect(reloaded?.artifacts.find((item) => item.kind === 'hard_sub_video')?.objectKey).toBe('story-releases/2026-07-15/zby-v14-027/10_final_story_hardsub.mp4')
  })
})
