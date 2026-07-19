import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { StoryReleaseArtifact, StoryReleaseStorageProvider } from './release-manifest'

export interface StoryReleaseUploadInput {
  artifact: StoryReleaseArtifact
  workspaceRoot: string
}

export interface StoryReleaseStoredObject {
  provider: StoryReleaseStorageProvider
  objectKey: string
  locator: string
}

export interface StoryReleaseStorage {
  readonly provider: StoryReleaseStorageProvider
  upload(input: StoryReleaseUploadInput): Promise<StoryReleaseStoredObject>
  playbackLocator(objectKey: string): Promise<string>
}

function resolveWorkspaceFile(workspaceRoot: string, relativePath: string): string {
  const root = path.resolve(workspaceRoot)
  const filePath = path.resolve(root, relativePath)
  const relative = path.relative(root, filePath)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`STORY_RELEASE_PATH_OUTSIDE_WORKSPACE: ${relativePath}`)
  }
  return filePath
}

class LocalStoryReleaseStorage implements StoryReleaseStorage {
  readonly provider = 'local' as const

  async upload(input: StoryReleaseUploadInput): Promise<StoryReleaseStoredObject> {
    const filePath = resolveWorkspaceFile(input.workspaceRoot, input.artifact.localPath)
    await readFile(filePath)
    return {
      provider: this.provider,
      objectKey: input.artifact.objectKey,
      locator: input.artifact.localPath,
    }
  }

  async playbackLocator(objectKey: string): Promise<string> {
    return objectKey
  }
}

class UnconfiguredStoryReleaseStorage implements StoryReleaseStorage {
  readonly provider: Exclude<StoryReleaseStorageProvider, 'local'>

  constructor(provider: Exclude<StoryReleaseStorageProvider, 'local'>) {
    this.provider = provider
  }

  async upload(input: StoryReleaseUploadInput): Promise<StoryReleaseStoredObject> {
    void input
    throw new Error(`STORY_RELEASE_STORAGE_NOT_CONFIGURED: ${this.provider}`)
  }

  async playbackLocator(objectKey: string): Promise<string> {
    void objectKey
    throw new Error(`STORY_RELEASE_STORAGE_NOT_CONFIGURED: ${this.provider}`)
  }
}

export function createStoryReleaseStorage(provider?: StoryReleaseStorageProvider): StoryReleaseStorage {
  const selected = provider || (process.env.STORY_RELEASE_STORAGE_PROVIDER as StoryReleaseStorageProvider | undefined) || 'local'
  if (selected === 'local') return new LocalStoryReleaseStorage()
  if (selected === 'google-drive' || selected === 'cos' || selected === 'oss' || selected === 'r2') {
    return new UnconfiguredStoryReleaseStorage(selected)
  }
  throw new Error(`STORY_RELEASE_STORAGE_PROVIDER_INVALID: ${selected}`)
}
