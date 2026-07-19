export interface StoryVideoArtifacts {
  baseVideoPath: string
  subtitlePath: string
  subtitleAssPath: string
  hardSubVideoPath: string
  softSubVideoPath: string
}

export interface StoryVideoAssetCandidate {
  videoPath: string | null
  hardSubVideoPath: string | null
  softSubVideoPath: string | null
}

function joinRunFile(runDir: string, fileName: string): string {
  const trimmed = runDir.endsWith('/') ? runDir.slice(0, -1) : runDir
  return `${trimmed}/${fileName}`
}

export function resolveStoryVideoArtifacts(runDir: string): StoryVideoArtifacts {
  return {
    baseVideoPath: joinRunFile(runDir, '08_final_story.mp4'),
    subtitlePath: joinRunFile(runDir, '09_subtitles_auto.srt'),
    subtitleAssPath: joinRunFile(runDir, '09_subtitles_auto.ass'),
    hardSubVideoPath: joinRunFile(runDir, '10_final_story_hardsub.mp4'),
    softSubVideoPath: joinRunFile(runDir, '10_final_story_softsub.mp4'),
  }
}

export function resolvePreferredStoryVideoPath(candidate: StoryVideoAssetCandidate): string | null {
  return candidate.hardSubVideoPath || candidate.videoPath || candidate.softSubVideoPath || null
}
