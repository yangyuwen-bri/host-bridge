import { resolveStorySourceFile } from './story-catalog'
import type {
  DeepStoryReview,
  HotNewsFetchResult,
  HotNewsItem,
  SocialHotVideoRecommendation,
  StoryCatalogRecord,
  StoryReviewRecord,
} from './types'

export type ModelStoryCandidate = {
  id: string
  title: string
  priority: string
  categoryTags: string
  riskTags: string
  modernAngle: string
  productionScore: number
  productionDifficulty: number
  summary: string
  emotionalHook: string
  sourceExcerpt: string
  produced: boolean
}

export type SocialHotModelRecommendation = {
  hotNewsSource: string
  hotNewsRank: number
  hotNewsTitle: string
  socialIssue: string
  storyId: string
  matchReason: string
  riskLevel: 'low' | 'medium' | 'high'
  riskNotes: string
  matchScore?: number
  matchEvidence?: string
  storyEvidence?: string
  comparisonNote?: string
  publishTitle?: string
  publishBody?: string
  hashtags?: string[]
}

export type SocialHotModelDecision = {
  overallRead: string
  recommendations: SocialHotModelRecommendation[]
}

export type SocialHotModelAnalysisInput = {
  hotNews: HotNewsFetchResult
  stories: StoryReviewRecord[]
  deepReviews: Map<string, DeepStoryReview>
  producedStoryIds: Set<string>
  includeProduced: boolean
  limit: number
  storyCandidateLimit: number
}

function compactText(value: string, maxChars: number): string {
  const text = value.replace(/\s+/gu, ' ').trim()
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text
}

function deepReviewFor(story: StoryReviewRecord, deepReviews: Map<string, DeepStoryReview>): DeepStoryReview | null {
  return deepReviews.get(story.id) || null
}

export function buildStoryCandidatesForModel(input: SocialHotModelAnalysisInput): ModelStoryCandidate[] {
  return input.stories
    .sort((left, right) => {
      const scoreDelta = right.productionScore - left.productionScore
      if (scoreDelta !== 0) return scoreDelta
      return left.productionDifficulty - right.productionDifficulty
    })
    .slice(0, input.storyCandidateLimit)
    .map((story) => {
      const deepReview = deepReviewFor(story, input.deepReviews)
      return {
        id: story.id,
        title: story.titleTrad || deepReview?.titleSimplified || story.id,
        priority: story.priority,
        categoryTags: story.categoryTags,
        riskTags: story.riskTags,
        modernAngle: story.modernAngle,
        productionScore: story.productionScore,
        productionDifficulty: story.productionDifficulty,
        summary: compactText(deepReview?.oneSentenceSummary || story.modernAngle || story.sourceExcerpt, 160),
        emotionalHook: compactText(deepReview?.emotionalHook || '', 100),
        sourceExcerpt: compactText(story.sourceExcerpt, 220),
        produced: input.producedStoryIds.has(story.id),
      }
    })
}

function topHotNewsForModel(hotNews: HotNewsFetchResult): HotNewsItem[] {
  return [...hotNews.items]
    .sort((left, right) => {
      const sourceDelta = sourcePriority(left.source) - sourcePriority(right.source)
      if (sourceDelta !== 0) return sourceDelta
      return left.rank - right.rank
    })
    .slice(0, 120)
}

function sourcePriority(source: string): number {
  if (source === 'weibo') return 0
  if (source === 'baidu') return 1
  if (source === 'toutiao') return 2
  if (source === 'thepaper') return 3
  if (source === 'douyin') return 4
  if (source === 'zhihu') return 5
  return 9
}

export function buildSocialHotModelPrompt(input: SocialHotModelAnalysisInput): string {
  const hotNews = topHotNewsForModel(input.hotNews).map((item) => ({
    source: item.source,
    rank: item.rank,
    title: item.title,
    hot: compactText(item.hot, 180),
    url: item.url,
  }))
  const stories = buildStoryCandidatesForModel(input)

  return [
    '你是一个中文视频号选题总监，负责从当天中国社会热点中，为《子不语》志怪故事号挑选最适合生产的视频。',
    '',
    '你必须独立完成三件事：',
    '1. 阅读热点数据，挖掘真正适合内容化的社会议题；不要只看关键词，不要机械分类。',
    '2. 阅读素材库候选故事，理解每个故事的人性主题、叙事钩子、风险和可拍性。',
    '3. 选择最适合的热点-故事组合，给出可核查的匹配理由；视频号文案在故事确认后单独生成。',
    '',
    '硬约束：',
    '- 只选择中国社会新闻、民生、司法、消费维权、公共安全、灾害、家庭伦理相关的具体新闻事件；跳过情绪话题、职场段子、娱乐、体育、纯科技、股票、国际政治。',
    '- 跳过涉及未成年人性侵、自杀、坠亡、命案、明确多人死亡、血腥细节的热点。',
    '- 不要为了蹭热点硬配故事；如果关系牵强，宁可少给候选。',
    '- 输出的 storyId 必须来自素材库。',
    '- hotNewsSource、hotNewsRank、hotNewsTitle 必须从热点数据中同一条记录原样复制，不能改写、不能凭印象引用。',
    '- 不要在匹配阶段生成标题、正文或标签；这些内容在故事确认后单独生成。',
    '- 不要把现实新闻事实写进故事内容，不要给现实新闻下定论。',
    '',
    '严格只输出 JSON 对象，不要 Markdown，不要解释。格式：',
    '{',
    '  "overallRead": "一句话概括今天适合做什么方向",',
    '  "recommendations": [',
    '    {',
    '      "hotNewsSource": "weibo",',
    '      "hotNewsRank": 1,',
    '      "hotNewsTitle": "热点标题原文",',
    '      "socialIssue": "你从热点中抽象出的人性/社会议题",',
    '      "storyId": "zby-vxx-xxx",',
    '      "matchReason": "为什么这个故事与该社会议题真正相配",',
    '      "riskLevel": "low|medium|high",',
    '      "riskNotes": "发布风险和规避方式"',
    '    }',
    '  ]',
    '}',
    '',
    `最多输出 ${input.limit} 个 recommendations。`,
    '',
    '热点数据：',
    JSON.stringify(hotNews, null, 2),
    '',
    '素材库候选：',
    JSON.stringify(stories, null, 2),
  ].join('\n')
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function readRequiredString(row: Record<string, unknown>, field: string): string {
  const value = row[field]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`MODEL_DECISION_FIELD_MISSING: ${field}`)
  }
  return value.trim()
}

function readRequiredNumber(row: Record<string, unknown>, field: string): number {
  const value = row[field]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`MODEL_DECISION_FIELD_INVALID: ${field}`)
  }
  return value
}

function readOptionalNumber(row: Record<string, unknown>, field: string): number | undefined {
  const value = row[field]
  if (typeof value === 'undefined') return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`MODEL_DECISION_FIELD_INVALID: ${field}`)
  }
  return value
}

function readOptionalString(row: Record<string, unknown>, field: string): string | undefined {
  const value = row[field]
  if (typeof value === 'undefined') return undefined
  if (typeof value !== 'string') throw new Error(`MODEL_DECISION_FIELD_INVALID: ${field}`)
  return value.trim()
}

function readOptionalHashtags(row: Record<string, unknown>): string[] | undefined {
  const value = row.hashtags
  if (typeof value === 'undefined') return undefined
  if (!Array.isArray(value)) throw new Error('MODEL_DECISION_HASHTAGS_INVALID')
  const hashtags = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
  if (hashtags.length === 0) throw new Error('MODEL_DECISION_HASHTAGS_EMPTY')
  return hashtags
}

function assertPublishBodyHasNoHashtag(body: string): void {
  if (body.includes('#')) {
    throw new Error('MODEL_DECISION_PUBLISH_BODY_CONTAINS_HASHTAG')
  }
}

export function parseSocialHotModelDecision(raw: unknown): SocialHotModelDecision {
  const root = asRecord(raw)
  if (!root) throw new Error('MODEL_DECISION_ROOT_INVALID')
  const recommendationsRaw = root.recommendations
  if (!Array.isArray(recommendationsRaw)) throw new Error('MODEL_DECISION_RECOMMENDATIONS_INVALID')

  return {
    overallRead: readRequiredString(root, 'overallRead'),
    recommendations: recommendationsRaw.map((item, index) => {
      const row = asRecord(item)
      if (!row) throw new Error(`MODEL_DECISION_RECOMMENDATION_INVALID: ${index}`)
      const riskLevel = readRequiredString(row, 'riskLevel')
      if (riskLevel !== 'low' && riskLevel !== 'medium' && riskLevel !== 'high') {
        throw new Error(`MODEL_DECISION_RISK_LEVEL_INVALID: ${riskLevel}`)
      }
      const publishBody = readOptionalString(row, 'publishBody') || ''
      if (publishBody) assertPublishBodyHasNoHashtag(publishBody)
      return {
        hotNewsSource: readRequiredString(row, 'hotNewsSource'),
        hotNewsRank: readRequiredNumber(row, 'hotNewsRank'),
        hotNewsTitle: readRequiredString(row, 'hotNewsTitle'),
        socialIssue: readRequiredString(row, 'socialIssue'),
        storyId: readRequiredString(row, 'storyId'),
        matchReason: readRequiredString(row, 'matchReason'),
        riskLevel,
        riskNotes: readRequiredString(row, 'riskNotes'),
        matchScore: readOptionalNumber(row, 'matchScore'),
        matchEvidence: readOptionalString(row, 'matchEvidence'),
        storyEvidence: readOptionalString(row, 'storyEvidence'),
        comparisonNote: readOptionalString(row, 'comparisonNote'),
        publishTitle: readOptionalString(row, 'publishTitle'),
        publishBody,
        hashtags: readOptionalHashtags(row),
      }
    }),
  }
}

export function extractFirstJsonObject(text: string): unknown {
  const start = text.indexOf('{')
  if (start < 0) throw new Error('MODEL_JSON_OBJECT_NOT_FOUND')
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (ch === '\\') {
      escaped = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (ch === '{') depth += 1
    if (ch === '}') {
      depth -= 1
      if (depth === 0) {
        return JSON.parse(text.slice(start, i + 1)) as unknown
      }
    }
  }
  throw new Error('MODEL_JSON_OBJECT_UNCLOSED')
}

export function validateModelDecisionReferences(
  decision: SocialHotModelDecision,
  hotNews: HotNewsFetchResult,
  stories: StoryReviewRecord[],
): void {
  const storyIds = new Set(stories.map((story) => story.id))
  const hotByKey = new Map(hotNews.items.map((item) => [`${item.source}#${item.rank}`, item]))
  for (const recommendation of decision.recommendations) {
    if (!storyIds.has(recommendation.storyId)) {
      throw new Error(`MODEL_DECISION_UNKNOWN_STORY_ID: ${recommendation.storyId}`)
    }
    const hotKey = `${recommendation.hotNewsSource}#${recommendation.hotNewsRank}`
    const hotNewsItem = hotByKey.get(hotKey)
    if (!hotNewsItem) {
      throw new Error(`MODEL_DECISION_UNKNOWN_HOT_NEWS: ${hotKey}`)
    }
    if (hotNewsItem.title !== recommendation.hotNewsTitle) {
      throw new Error(`MODEL_DECISION_HOT_NEWS_TITLE_MISMATCH: ${hotKey}`)
    }
  }
}

export function buildRecommendationFromModelDecision(params: {
  workspaceRoot: string
  runTimestamp: string
  llmModel: string
  imageModel: string
  ttsModel: string
  hotNews: HotNewsFetchResult
  stories: Array<StoryReviewRecord | StoryCatalogRecord>
  deepReviews: Map<string, DeepStoryReview>
  decision: SocialHotModelRecommendation
}): SocialHotVideoRecommendation {
  const hotNewsItem = params.hotNews.items.find((item) => (
    item.source === params.decision.hotNewsSource && item.rank === params.decision.hotNewsRank
  ))
  if (!hotNewsItem) throw new Error(`MODEL_DECISION_HOT_NEWS_NOT_FOUND: ${params.decision.hotNewsSource}#${params.decision.hotNewsRank}`)

  const story = params.stories.find((item) => item.id === params.decision.storyId)
  if (!story) throw new Error(`MODEL_DECISION_STORY_NOT_FOUND: ${params.decision.storyId}`)
  const deepReview = params.deepReviews.get(story.id) || null
  const sourceFile = resolveStorySourceFile(params.workspaceRoot, story)
  const outputDir = `${params.workspaceRoot}/materials/zibuyu/runs/${params.runTimestamp}-${story.id}-${slugFromTitle(hotNewsItem.title)}-aliyun-full`
  return {
    hotNews: {
      item: hotNewsItem,
      themes: [{
        theme: {
          id: 'model_selected',
          label: params.decision.socialIssue,
          storyTags: [],
          keywords: [],
          storyKeywords: [],
          copyLead: '',
          copyQuestion: '',
          hashtags: [],
        },
        hits: [],
      }],
      riskHits: params.decision.riskLevel === 'high' ? [params.decision.riskNotes] : [],
      score: 0,
    },
      storyMatch: {
      story,
      deepReview,
      sourceFile,
      score: params.decision.matchScore || 0,
      matchedTags: [
        params.decision.socialIssue,
        params.decision.matchReason,
        params.decision.matchEvidence || '',
        params.decision.storyEvidence || '',
      ].filter((value) => value.length > 0),
      riskHits: params.decision.riskLevel === 'high' ? [params.decision.riskNotes] : [],
      produced: false,
    },
    publishCopy: {
      title: params.decision.publishTitle || story.titleTrad,
      body: params.decision.publishBody || '',
      hashtags: params.decision.hashtags || [],
    },
    generation: {
      storyFile: sourceFile,
      outputDir,
      command: [
        'npm',
        'run',
        'video:run-story-full-aliyun',
        '--',
        '--story-file',
        sourceFile,
        '--output-dir',
        outputDir,
        '--llm-model',
        params.llmModel,
        '--image-model',
        params.imageModel,
        '--tts-model',
        params.ttsModel,
      ],
    },
  }
}

function slugFromTitle(title: string): string {
  const slug = title
    .replace(/[^a-zA-Z0-9\u4e00-\u9fa5]+/gu, '-')
    .replace(/^-|-$/gu, '')
    .slice(0, 40)
  return slug || 'hot-news'
}
