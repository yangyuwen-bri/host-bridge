import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildStoryImageManifestRows,
  buildStoryNarrationText,
  listMissingStorySceneIds,
  resolveRequiredSceneImagePath,
  sceneImageOutputPath,
} from './partial-run'

function makeRunDir(): string {
  const runDir = mkdtempSync(path.join(os.tmpdir(), 'story-partial-run-test-'))
  mkdirSync(path.join(runDir, 'images'), { recursive: true })
  return runDir
}

describe('story partial run helpers', () => {
  it('lists missing scene ids in order and ignores duplicates', () => {
    const runDir = makeRunDir()
    try {
      writeFileSync(path.join(runDir, 'images', 'scene_01.png'), 'a')
      writeFileSync(path.join(runDir, 'images', 'scene_03.webp'), 'b')

      expect(listMissingStorySceneIds(runDir, [1, 2, 3, 4, 4])).toEqual([2, 4])
    } finally {
      rmSync(runDir, { recursive: true, force: true })
    }
  })

  it('builds narration text from ordered scene voiceovers', () => {
    expect(buildStoryNarrationText([
      { id: 1, voiceOver: '  第一段旁白  ' },
      { id: 2, voiceOver: '第二段旁白' },
    ])).toBe('第一段旁白\n第二段旁白')
  })

  it('fails fast when a scene voiceover is empty', () => {
    expect(() => buildStoryNarrationText([
      { id: 1, voiceOver: '正常' },
      { id: 2, voiceOver: '   ' },
    ])).toThrow('SCENE_VOICEOVER_EMPTY: 2')
  })

  it('resolves required scene image paths and builds manifest rows', () => {
    const runDir = makeRunDir()
    try {
      const scene1 = sceneImageOutputPath(runDir, 1)
      const scene2 = path.join(runDir, 'images', 'scene_02.jpg')
      writeFileSync(scene1, 'a')
      writeFileSync(scene2, 'b')

      expect(resolveRequiredSceneImagePath(runDir, 1)).toBe(scene1)
      expect(resolveRequiredSceneImagePath(runDir, 2)).toBe(scene2)
      expect(buildStoryImageManifestRows(runDir, [
        { id: 1, charRefs: ['c1'] },
        { id: 2, charRefs: ['c1', 'c2'] },
      ])).toEqual([
        { sceneId: 1, imagePath: scene1, charRefs: ['c1'] },
        { sceneId: 2, imagePath: scene2, charRefs: ['c1', 'c2'] },
      ])
    } finally {
      rmSync(runDir, { recursive: true, force: true })
    }
  })
})
