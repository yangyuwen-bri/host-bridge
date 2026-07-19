import { describe, expect, it } from 'vitest'
import { buildHostOpening, getStoryAngle, getStoryStatus, getStorySummary, type EditorialHotItem } from './editorial-model'
import type { StoryKnowledgeRecord } from '@/lib/story-knowledge/types'

const hot: EditorialHotItem = {
  id: 'demo-01',
  source: '微博',
  sourceLabel: '微博',
  rank: 1,
  title: '小城夜间救援接力引发讨论',
  heat: '38.6万',
  trend: '上升',
  issue: '互助关系',
  lead: '人在最需要帮助的时候，真正能留下来的，常常不是一句漂亮话。',
  url: 'https://example.com/hot',
  fetchedAt: '2026-07-13T00:00:00.000Z',
}

const story: StoryKnowledgeRecord = {
  id: 'zby-v16-004',
  titleTraditional: '雀報恩',
  titleSimplified: '雀报恩',
  volume: '卷十六',
  priority: 'S',
  textCharCount: 860,
  sourcePath: '/materials/zhiguai/stories/zby-v16-004/source.txt',
  isGenerated: false,
  generatedVideoPath: null,
  categoryTags: ['因果报应'],
  riskTags: [],
  recommendedColumn: '善恶因果',
  modernAngle: '微小善意在关键时刻形成回声',
  productionScore: 92,
  productionRecommendation: '推荐',
  productionDifficulty: 2,
  difficultyReason: '场景清晰',
  sourceExcerpt: '周之庠双目失明后，仍每日喂雀。',
  deepReview: {
    id: 'zby-v16-004',
    titleSimplified: '雀报恩',
    oneSentenceSummary: '一个人长期做的小善事，最后替自己打开了一条生路。',
    modernNewsAngle: '微小善意在关键时刻形成回声',
    mainConflict: '善意是否会被记住',
    emotionalHook: '你以为没有人看见的小事，可能一直被记着。',
    accountColumn: '善恶因果',
    videoTitleAngles: ['小善事会有回声吗'],
    riskNotes: '避免将现实救援事件解释为因果报应。',
    visualNotes: '保持环境叙事，避免过度拟人化。',
    productionPriority: '强烈推荐',
    productionReason: '主题清晰，适合短视频口播。',
  },
}

describe('editorial story studio model', () => {
  it('builds a host bridge from a hot issue to the original story', () => {
    const opening = buildHostOpening(hot, story)

    expect(opening).toContain(hot.lead)
    expect(opening).toContain('《雀报恩》')
    expect(opening).toContain('微小善意在关键时刻形成回声')
    expect(opening).not.toContain('今天热榜')
  })

  it('prefers deep review copy while keeping production state explicit', () => {
    expect(getStorySummary(story)).toBe('一个人长期做的小善事，最后替自己打开了一条生路。')
    expect(getStoryAngle(story)).toBe('微小善意在关键时刻形成回声')
    expect(getStoryStatus(story)).toBe('推荐')
  })
})
