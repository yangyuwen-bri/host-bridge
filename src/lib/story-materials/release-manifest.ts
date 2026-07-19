import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export type StoryReleaseArtifactKind =
  | 'master_video'
  | 'hard_sub_video'
  | 'soft_sub_video'
  | 'subtitle_srt'
  | 'subtitle_ass'
  | 'narration_audio'
  | 'narration_text'

export type StoryReleaseStorageProvider = 'local' | 'google-drive' | 'cos' | 'oss' | 'r2'

export type StoryReleaseStorageState = 'local-only' | 'pending-upload' | 'uploaded'

export interface StoryReleaseArtifact {
  kind: StoryReleaseArtifactKind
  fileName: string
  localPath: string
  objectKey: string
  contentType: string
  sizeBytes: number
  sha256: string
  storageLocator?: string
}

export interface StoryReleaseCopy {
  title: string
  body: string
  hashtags: string[]
}

export interface StoryReleaseContext {
  hostOpening?: string
  hotTitle?: string
  socialIssue?: string
  matchReason?: string
  copy?: StoryReleaseCopy
}

export interface StoryReleaseManifest {
  schemaVersion: 1
  releaseId: string
  storyId: string
  storyTitle: string
  generatedAt: string
  runDir: string
  storage: {
    provider: StoryReleaseStorageProvider
    state: StoryReleaseStorageState
  }
  context: StoryReleaseContext
  artifacts: StoryReleaseArtifact[]
}

export interface BuildStoryReleaseManifestInput {
  workspaceRoot: string
  runDir: string
  storyId: string
  storyTitle: string
  generatedAt: string
  storageProvider?: StoryReleaseStorageProvider
  context?: StoryReleaseContext
}

const MANIFEST_FILENAME = '11_story_release_manifest.json'

const ARTIFACT_DEFINITIONS: Array<{
  kind: StoryReleaseArtifactKind
  fileName: string
  contentType: string
}> = [
  { kind: 'master_video', fileName: '08_final_story.mp4', contentType: 'video/mp4' },
  { kind: 'hard_sub_video', fileName: '10_final_story_hardsub.mp4', contentType: 'video/mp4' },
  { kind: 'soft_sub_video', fileName: '10_final_story_softsub.mp4', contentType: 'video/mp4' },
  { kind: 'subtitle_srt', fileName: '09_subtitles_auto.srt', contentType: 'application/x-subrip' },
  { kind: 'subtitle_ass', fileName: '09_subtitles_auto.ass', contentType: 'text/plain' },
  { kind: 'narration_audio', fileName: '05_narration.wav', contentType: 'audio/wav' },
  { kind: 'narration_text', fileName: '06_narration.txt', contentType: 'text/plain' },
]

function sha256(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

function dateKey(generatedAt: string): string {
  const parsed = new Date(generatedAt)
  if (Number.isNaN(parsed.getTime())) throw new Error('STORY_RELEASE_GENERATED_AT_INVALID')
  return parsed.toISOString().slice(0, 10)
}

function relativePath(workspaceRoot: string, filePath: string): string {
  const relative = path.relative(path.resolve(workspaceRoot), path.resolve(filePath))
  if (!relative || relative.startsWith('..')) throw new Error(`STORY_RELEASE_PATH_OUTSIDE_WORKSPACE: ${filePath}`)
  return relative.split(path.sep).join('/')
}

function objectKey(date: string, storyId: string, fileName: string): string {
  return `story-releases/${date}/${storyId}/${fileName}`
}

function buildArtifact(
  workspaceRoot: string,
  runDir: string,
  date: string,
  storyId: string,
  definition: (typeof ARTIFACT_DEFINITIONS)[number],
): StoryReleaseArtifact | null {
  const filePath = path.join(runDir, definition.fileName)
  if (!existsSync(filePath)) return null
  return {
    kind: definition.kind,
    fileName: definition.fileName,
    localPath: relativePath(workspaceRoot, filePath),
    objectKey: objectKey(date, storyId, definition.fileName),
    contentType: definition.contentType,
    sizeBytes: statSync(filePath).size,
    sha256: sha256(filePath),
  }
}

export function storyReleaseManifestPath(runDir: string): string {
  return path.join(path.resolve(runDir), MANIFEST_FILENAME)
}

export function buildStoryReleaseManifest(input: BuildStoryReleaseManifestInput): StoryReleaseManifest {
  const workspaceRoot = path.resolve(input.workspaceRoot)
  const runDir = path.resolve(input.runDir)
  const date = dateKey(input.generatedAt)
  const artifacts = ARTIFACT_DEFINITIONS
    .map((definition) => buildArtifact(workspaceRoot, runDir, date, input.storyId, definition))
    .filter((artifact): artifact is StoryReleaseArtifact => artifact !== null)
  const requiredVideoKinds: StoryReleaseArtifactKind[] = ['master_video', 'hard_sub_video', 'soft_sub_video']
  if (requiredVideoKinds.some((kind) => !artifacts.some((artifact) => artifact.kind === kind))) {
    throw new Error('STORY_RELEASE_REQUIRED_VIDEO_ARTIFACT_MISSING')
  }

  return {
    schemaVersion: 1,
    releaseId: `${date}-${input.storyId}`,
    storyId: input.storyId,
    storyTitle: input.storyTitle,
    generatedAt: input.generatedAt,
    runDir: relativePath(workspaceRoot, runDir),
    storage: {
      provider: input.storageProvider || 'local',
      state: input.storageProvider && input.storageProvider !== 'local' ? 'pending-upload' : 'local-only',
    },
    context: input.context || {},
    artifacts,
  }
}

export function writeStoryReleaseManifest(manifest: StoryReleaseManifest, runDir: string): string {
  const manifestPath = storyReleaseManifestPath(runDir)
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
  return manifestPath
}

export function readStoryReleaseManifest(runDir: string): StoryReleaseManifest | null {
  const manifestPath = storyReleaseManifestPath(runDir)
  if (!existsSync(manifestPath)) return null
  const parsed: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`STORY_RELEASE_MANIFEST_INVALID: ${manifestPath}`)
  }
  return parsed as StoryReleaseManifest
}

export function preferredStoryReleaseVideo(manifest: StoryReleaseManifest): StoryReleaseArtifact {
  const preferredKinds: StoryReleaseArtifactKind[] = ['hard_sub_video', 'master_video', 'soft_sub_video']
  const artifact = preferredKinds
    .map((kind) => manifest.artifacts.find((item) => item.kind === kind))
    .find((item): item is StoryReleaseArtifact => item !== undefined)
  if (!artifact) throw new Error(`STORY_RELEASE_VIDEO_NOT_FOUND: ${manifest.releaseId}`)
  return artifact
}
