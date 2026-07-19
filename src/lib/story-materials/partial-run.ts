import { existsSync } from 'node:fs'
import path from 'node:path'
import { sceneImageCandidates } from '@/lib/ffmpeg/story-video'

export interface StoryNarrationScene {
  id: number
  voiceOver: string
}

export interface StoryImageManifestScene {
  id: number
  charRefs: string[]
}

export interface StoryImageManifestRow {
  sceneId: number
  imagePath: string
  charRefs: string[]
}

export function sceneImageOutputPath(runDir: string, sceneId: number): string {
  return path.join(runDir, 'images', `scene_${String(sceneId).padStart(2, '0')}.png`)
}

export function resolveRequiredSceneImagePath(runDir: string, sceneId: number): string {
  const imagePath = sceneImageCandidates(runDir, sceneId).find((candidate) => existsSync(candidate))
  if (!imagePath) {
    throw new Error(`SCENE_IMAGE_MISSING: ${sceneId}`)
  }
  return imagePath
}

export function listMissingStorySceneIds(runDir: string, sceneIds: number[]): number[] {
  const seen = new Set<number>()
  const missing: number[] = []

  for (const sceneIdRaw of sceneIds) {
    const sceneId = Math.trunc(sceneIdRaw)
    if (!Number.isFinite(sceneIdRaw) || sceneId <= 0) {
      throw new Error(`INVALID_SCENE_ID: ${String(sceneIdRaw)}`)
    }
    if (seen.has(sceneId)) continue
    seen.add(sceneId)
    const hasImage = sceneImageCandidates(runDir, sceneId).some((candidate) => existsSync(candidate))
    if (!hasImage) missing.push(sceneId)
  }

  return missing
}

export function buildStoryNarrationText(scenes: StoryNarrationScene[]): string {
  if (scenes.length === 0) throw new Error('STORY_SCENES_EMPTY')

  const narrationLines = scenes.map((scene) => {
    const voiceOver = scene.voiceOver.trim()
    if (!voiceOver) {
      throw new Error(`SCENE_VOICEOVER_EMPTY: ${scene.id}`)
    }
    return voiceOver
  })

  return narrationLines.join('\n')
}

export function buildStoryImageManifestRows(
  runDir: string,
  scenes: StoryImageManifestScene[],
): StoryImageManifestRow[] {
  if (scenes.length === 0) throw new Error('STORY_SCENES_EMPTY')

  return scenes.map((scene) => ({
    sceneId: scene.id,
    imagePath: resolveRequiredSceneImagePath(runDir, scene.id),
    charRefs: [...scene.charRefs],
  }))
}
