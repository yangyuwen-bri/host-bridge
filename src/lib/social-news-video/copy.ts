import type { SocialHotVideoRecommendation, StoryMatch } from './types'

function storySummary(match: StoryMatch): string {
  if (match.deepReview?.oneSentenceSummary) return match.deepReview.oneSentenceSummary
  const excerpt = match.story.sourceExcerpt.replace(/\s+/gu, '')
  if (excerpt) return `${excerpt.slice(0, 90)}……`
  return match.story.modernAngle || match.story.titleTrad
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))]
}

export function buildVideoAccountCopy(
  match: StoryMatch,
  themeLead: string,
  themeQuestion: string,
  themeHashtags: string[],
): SocialHotVideoRecommendation['publishCopy'] {
  const title = match.story.titleTrad || match.deepReview?.titleSimplified || match.story.id
  const body = [
    themeLead,
    '',
    `《子不语》里也有一桩这样的怪事：${storySummary(match)}`,
    '',
    '古人把这类人心写成鬼事，反而更像一面镜子。',
    '',
    themeQuestion,
  ].join('\n')

  return {
    title,
    body,
    hashtags: unique([
      '#子不语',
      '#志怪故事',
      '#古风悬疑',
      '#古代奇案',
      ...themeHashtags,
    ]),
  }
}
