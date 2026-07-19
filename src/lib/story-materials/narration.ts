export function buildNarrationText(hostOpening: string, storyNarrationText: string): string {
  const storyText = storyNarrationText.trim()
  if (!storyText) throw new Error('NARRATION_FROM_STORY_EMPTY')
  const opening = hostOpening.trim()
  return opening ? `${opening}\n\n${storyText}` : storyText
}

