import type { StoryKnowledgeRecord } from '@/lib/story-knowledge/types'
import type { EditorialHotItem } from '@/lib/social-news-video/editorial-view'

export type { EditorialHotItem } from '@/lib/social-news-video/editorial-view'

function compactBridgeText(value: string, maxChars: number): string {
  const text = value.replace(/\s+/gu, ' ').trim()
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text
}

export function buildHostOpening(hot: EditorialHotItem, story: StoryKnowledgeRecord): string {
  const storyAngle = story.deepReview?.modernNewsAngle || story.modernAngle || '一个关于人心与选择的旧故事'
  return `${compactBridgeText(hot.lead, 30)}看到这件事，我想到《子不语》里的《${story.titleSimplified}》。相似的不是结局，而是${compactBridgeText(storyAngle, 24)}。故事发生在……`
}

export function getStorySummary(story: StoryKnowledgeRecord): string {
  return story.deepReview?.oneSentenceSummary || story.sourceExcerpt || story.modernAngle
}

export function getStoryAngle(story: StoryKnowledgeRecord): string {
  return story.deepReview?.modernNewsAngle || story.modernAngle || '等待素材库补充现代议题'
}

export function getStoryRisk(story: StoryKnowledgeRecord): string {
  return story.deepReview?.riskNotes || story.riskTags.join('、') || '暂无特别风险'
}

export function getStoryStatus(story: StoryKnowledgeRecord): string {
  if (story.isGenerated) return '已有成片'
  return story.productionRecommendation
}
