import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createStoryReleaseStorage } from './release-storage'
import type { StoryReleaseArtifact } from './release-manifest'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const artifact: StoryReleaseArtifact = {
  kind: 'hard_sub_video',
  fileName: '10_final_story_hardsub.mp4',
  localPath: 'materials/runs/10_final_story_hardsub.mp4',
  objectKey: 'story-releases/2026-07-15/zby-v14-027/10_final_story_hardsub.mp4',
  contentType: 'video/mp4',
  sizeBytes: 5,
  sha256: 'test-sha256',
}

describe('story release storage providers', () => {
  it('keeps local storage explicit and validates the source file', async () => {
    const workspaceRoot = os.tmpdir()
    const directory = path.join(workspaceRoot, `story-storage-${Date.now()}`)
    tempDirectories.push(directory)
    mkdirSync(path.join(directory, 'materials/runs'), { recursive: true })
    writeFileSync(path.join(directory, artifact.localPath), 'video', 'utf8')

    const result = await createStoryReleaseStorage('local').upload({ artifact, workspaceRoot: directory })

    expect(result.provider).toBe('local')
    expect(result.objectKey).toBe(artifact.objectKey)
    expect(result.locator).toBe(artifact.localPath)
  })

  it('fails explicitly when a remote provider is selected without credentials', async () => {
    const storage = createStoryReleaseStorage('google-drive')

    await expect(storage.upload({ artifact, workspaceRoot: os.tmpdir() })).rejects.toThrow('STORY_RELEASE_STORAGE_NOT_CONFIGURED: google-drive')
  })

  it('rejects a local artifact path outside the workspace', async () => {
    const unsafeArtifact: StoryReleaseArtifact = { ...artifact, localPath: '../outside.mp4' }
    const storage = createStoryReleaseStorage('local')

    await expect(storage.upload({ artifact: unsafeArtifact, workspaceRoot: os.tmpdir() })).rejects.toThrow(
      'STORY_RELEASE_PATH_OUTSIDE_WORKSPACE',
    )
  })
})
