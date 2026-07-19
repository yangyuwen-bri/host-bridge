import path from 'node:path'
import {
  readStoryReleaseManifest,
  writeStoryReleaseManifest,
  type StoryReleaseManifest,
  type StoryReleaseStorageProvider,
} from './release-manifest'
import { createStoryReleaseStorage } from './release-storage'

export interface PublishStoryReleaseInput {
  workspaceRoot: string
  runDir: string
  provider?: StoryReleaseStorageProvider
}

export async function publishStoryRelease(input: PublishStoryReleaseInput): Promise<StoryReleaseManifest> {
  const workspaceRoot = path.resolve(input.workspaceRoot)
  const runDir = path.resolve(workspaceRoot, input.runDir)
  const manifest = readStoryReleaseManifest(runDir)
  if (!manifest) throw new Error(`STORY_RELEASE_MANIFEST_NOT_FOUND: ${runDir}`)

  const provider = createStoryReleaseStorage(input.provider || manifest.storage.provider)
  const artifacts = []
  for (const artifact of manifest.artifacts) {
    const stored = await provider.upload({ artifact, workspaceRoot })
    artifacts.push({ ...artifact, storageLocator: stored.locator })
  }

  const published: StoryReleaseManifest = {
    ...manifest,
    storage: {
      provider: provider.provider,
      state: provider.provider === 'local' ? 'local-only' : 'uploaded',
    },
    artifacts,
  }
  writeStoryReleaseManifest(published, runDir)
  return published
}
