import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolvePreferredStoryVideoPath, resolveStoryVideoArtifacts } from './video-assets'

describe('story video assets', () => {
  it('resolves canonical artifact paths for a run directory', () => {
    const runDir = '/tmp/story-run'
    expect(resolveStoryVideoArtifacts(runDir)).toEqual({
      baseVideoPath: path.join(runDir, '08_final_story.mp4'),
      subtitlePath: path.join(runDir, '09_subtitles_auto.srt'),
      subtitleAssPath: path.join(runDir, '09_subtitles_auto.ass'),
      hardSubVideoPath: path.join(runDir, '10_final_story_hardsub.mp4'),
      softSubVideoPath: path.join(runDir, '10_final_story_softsub.mp4'),
    })
  })

  it('prefers hard subtitle video over base and soft subtitle outputs', () => {
    expect(resolvePreferredStoryVideoPath({
      videoPath: '/tmp/story-run/08_final_story.mp4',
      hardSubVideoPath: '/tmp/story-run/10_final_story_hardsub.mp4',
      softSubVideoPath: '/tmp/story-run/10_final_story_softsub.mp4',
    })).toBe('/tmp/story-run/10_final_story_hardsub.mp4')
  })

  it('falls back to base video then soft subtitle video when needed', () => {
    expect(resolvePreferredStoryVideoPath({
      videoPath: '/tmp/story-run/08_final_story.mp4',
      hardSubVideoPath: null,
      softSubVideoPath: '/tmp/story-run/10_final_story_softsub.mp4',
    })).toBe('/tmp/story-run/08_final_story.mp4')

    expect(resolvePreferredStoryVideoPath({
      videoPath: null,
      hardSubVideoPath: null,
      softSubVideoPath: '/tmp/story-run/10_final_story_softsub.mp4',
    })).toBe('/tmp/story-run/10_final_story_softsub.mp4')
  })
})
