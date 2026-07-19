import {
  extractFirstJsonObject,
  parseSocialHotModelDecision,
  type SocialHotModelDecision,
} from './model-analysis'
import type { DeepStoryReview, HotNewsFetchResult, HotNewsItem, StoryCatalogRecord } from './types'

type DashscopeResponse = {
  code?: unknown
  message?: unknown
  error?: unknown
  choices?: unknown
}

type DashscopeChoice = {
  message?: {
    content?: unknown
  }
}

type RecallCandidate = {
  storyId: string
  hotNewsSource: string
  hotNewsRank: number
  fitScore: number
  semanticCore: string
  storyEvidence: string
}

export type FullCatalogAnalysisOptions = {
  apiKey: string
  model: string
  hotNews: HotNewsFetchResult
  stories: StoryCatalogRecord[]
  deepReviews: Map<string, DeepStoryReview>
  limit: number
  batchSize: number
  producedStoryIds: Set<string>
  fetchImpl?: typeof fetch
}

export type FullCatalogAnalysisResult = {
  decision: SocialHotModelDecision
  rawText: string
  prompt: string
  recallCount: number
  catalogCount: number
}

function compactText(value: string, maxChars: number): string {
  const text = value.replace(/\s+/gu, ' ').trim()
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text
}

function windowText(value: string, maxChars: number): string {
  const text = value.replace(/\s+/gu, ' ').trim()
  if (text.length <= maxChars) return text
  const headChars = Math.floor(maxChars * 0.68)
  const tailChars = maxChars - headChars
  return `${text.slice(0, headChars)} …… ${text.slice(-tailChars)}`
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

function hotNewsForModel(hotNews: HotNewsFetchResult): HotNewsItem[] {
  return [...hotNews.items]
    .sort((left, right) => {
      const sourceDelta = sourcePriority(left.source) - sourcePriority(right.source)
      if (sourceDelta !== 0) return sourceDelta
      return left.rank - right.rank
    })
    .slice(0, 60)
}

function deepReviewFor(story: StoryCatalogRecord, deepReviews: Map<string, DeepStoryReview>): DeepStoryReview | null {
  return deepReviews.get(story.id) || null
}

function storyDossier(story: StoryCatalogRecord, deepReviews: Map<string, DeepStoryReview>, producedStoryIds: Set<string>) {
  const deepReview = deepReviewFor(story, deepReviews)
  return {
    id: story.id,
    title: story.titleTrad,
    catalogStatus: story.priority === '未审阅' ? '原始库未审阅' : '已有运营审阅',
    categoryTags: story.categoryTags || '暂无人工标签，必须依据原文判断',
    riskTags: story.riskTags || '暂无人工风险标签，必须依据原文判断',
    modernAngle: story.modernAngle || '暂无人工现代议题，必须依据原文判断',
    reviewedSummary: compactText(deepReview?.oneSentenceSummary || '', 180),
    reviewedHook: compactText(deepReview?.emotionalHook || '', 140),
    sourceExcerpt: compactText(story.sourceExcerpt, 280),
    textWindow: windowText(story.sourceText, 760),
    alreadyProduced: producedStoryIds.has(story.id),
  }
}

function hotDossier(hotNews: HotNewsItem[]): Array<Pick<HotNewsItem, 'source' | 'rank' | 'title' | 'hot' | 'url'>> {
  return hotNews.map((item) => ({
    source: item.source,
    rank: item.rank,
    title: item.title,
    hot: compactText(item.hot, 160),
    url: item.url,
  }))
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function requiredString(row: Record<string, unknown>, field: string): string {
  const value = row[field]
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`CATALOG_RECALL_FIELD_MISSING: ${field}`)
  return value.trim()
}

function requiredNumber(row: Record<string, unknown>, field: string): number {
  const value = row[field]
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`CATALOG_RECALL_FIELD_INVALID: ${field}`)
  return value
}

function parseRecallResponse(raw: unknown, stories: StoryCatalogRecord[], hotNews: HotNewsFetchResult): RecallCandidate[] {
  const root = asRecord(raw)
  if (!root || !Array.isArray(root.candidates)) throw new Error('CATALOG_RECALL_CANDIDATES_INVALID')
  const storyIds = new Set(stories.map((story) => story.id))
  const hotKeys = new Set(hotNews.items.map((item) => `${item.source}#${item.rank}`))
  return root.candidates.map((item, index) => {
    const row = asRecord(item)
    if (!row) throw new Error(`CATALOG_RECALL_CANDIDATE_INVALID: ${index}`)
    const storyId = requiredString(row, 'storyId')
    const hotNewsSource = requiredString(row, 'hotNewsSource')
    const hotNewsRank = requiredNumber(row, 'hotNewsRank')
    const hotKey = `${hotNewsSource}#${hotNewsRank}`
    if (!storyIds.has(storyId)) throw new Error(`CATALOG_RECALL_UNKNOWN_STORY: ${storyId}`)
    if (!hotKeys.has(hotKey)) throw new Error(`CATALOG_RECALL_UNKNOWN_HOT_NEWS: ${hotKey}`)
    const fitScore = requiredNumber(row, 'fitScore')
    if (fitScore < 0 || fitScore > 100) throw new Error(`CATALOG_RECALL_SCORE_OUT_OF_RANGE: ${storyId}`)
    return {
      storyId,
      hotNewsSource,
      hotNewsRank,
      fitScore,
      semanticCore: requiredString(row, 'semanticCore'),
      storyEvidence: requiredString(row, 'storyEvidence'),
    }
  })
}

function readModelText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((part) => {
    if (typeof part === 'string') return part
    if (part && typeof part === 'object' && 'text' in part) {
      const text = (part as { text?: unknown }).text
      return typeof text === 'string' ? text : ''
    }
    return ''
  }).join('')
}

async function askDashscope(prompt: string, options: FullCatalogAnalysisOptions): Promise<{ rawText: string; prompt: string }> {
  const apiKey = options.apiKey.trim()
  if (!apiKey) throw new Error('MISSING_ALIYUN_API_KEY')
  const fetchImpl = options.fetchImpl || fetch
  const response = await fetchImpl('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: options.model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: '你是中文社会议题与古典故事匹配分析器。必须严格输出 JSON。' },
        { role: 'user', content: prompt },
      ],
    }),
  })
  const payload = await response.json().catch(() => ({})) as DashscopeResponse
  const errorObject = payload.error && typeof payload.error === 'object' ? payload.error as { message?: unknown } : null
  const code = typeof payload.code === 'string' ? payload.code : ''
  const message = typeof payload.message === 'string' ? payload.message : ''
  const errorMessage = typeof errorObject?.message === 'string' ? errorObject.message : ''
  if (!response.ok || code || message || errorMessage) {
    throw new Error(`DASHSCOPE_FULL_CATALOG_ANALYSIS_FAILED: ${code || response.status} ${message || errorMessage || response.statusText}`)
  }
  const choices = Array.isArray(payload.choices)
    ? payload.choices.filter((item): item is DashscopeChoice => Boolean(item) && typeof item === 'object')
    : []
  const rawText = readModelText(choices[0]?.message?.content)
  if (!rawText.trim()) throw new Error('DASHSCOPE_FULL_CATALOG_ANALYSIS_EMPTY')
  return { rawText, prompt }
}

function buildRecallPrompt(
  hotNews: HotNewsFetchResult,
  batch: StoryCatalogRecord[],
  deepReviews: Map<string, DeepStoryReview>,
  producedStoryIds: Set<string>,
): string {
  return [
    '你负责第一阶段语义召回。热点和故事不要求关键词重合，必须比较它们背后的具体社会矛盾、人性冲突、制度处境或情绪张力。',
    '请逐条阅读本批次所有故事，不要因为故事有“灾害/事故”等宽泛标签就默认匹配。',
    '只保留真正能用主播自然引出、且不会把现实新闻事实硬套进古代故事的组合。宁可返回空数组。',
    '已生成状态只用于了解排期，不得作为匹配筛选条件。',
    '输出 JSON：{"candidates":[{"storyId":"...","hotNewsSource":"...","hotNewsRank":1,"fitScore":0,"semanticCore":"具体共同议题","storyEvidence":"原文中的人物、行为或冲突证据"}]}。',
    'fitScore 是初筛分数，低于 55 的组合不要输出。每个故事最多输出一个最合适的热点组合。',
    '',
    '热点：',
    JSON.stringify(hotDossier(hotNewsForModel(hotNews)), null, 2),
    '',
    '本批次故事：',
    JSON.stringify(batch.map((story) => storyDossier(story, deepReviews, producedStoryIds)), null, 2),
  ].join('\n')
}

function buildFinalPrompt(
  hotNews: HotNewsFetchResult,
  candidates: RecallCandidate[],
  stories: StoryCatalogRecord[],
  deepReviews: Map<string, DeepStoryReview>,
): string {
  const candidateIds = new Set(candidates.map((candidate) => candidate.storyId))
  const candidateStories = stories
    .filter((story) => candidateIds.has(story.id))
    .map((story) => ({
      ...storyDossier(story, deepReviews, new Set()),
      fullOriginalText: story.sourceText,
      recallEvidence: candidates.filter((candidate) => candidate.storyId === story.id),
    }))
  return [
    '你负责最终选题决策。你已经拿到全库分批召回结果，现在必须重新阅读候选故事的完整原文，并进行横向比较后再决定。',
    '共同点必须落在具体社会议题或人性冲突上，不能只写“都有天罚、都有灾难、都有因果报应、都很震撼”。',
    '必须说明热点中的具体处境证据、故事原文中的具体证据，以及为什么它比其他候选更合适。',
    '如果没有达到真正可讲的匹配强度，recommendations 必须返回空数组，不要为了填满数量硬配。',
    '已生成状态、productionScore、priority 和标签宽窄都不能替代你对完整原文的判断。',
    '只输出 JSON，不要 Markdown。格式：',
    '{"overallRead":"...","recommendations":[{"hotNewsSource":"...","hotNewsRank":1,"hotNewsTitle":"原文标题","socialIssue":"具体社会议题","storyId":"...","matchReason":"具体说明为什么匹配","riskLevel":"low|medium|high","riskNotes":"...","matchScore":0,"matchEvidence":"热点证据","storyEvidence":"故事原文证据","comparisonNote":"相较其他候选为何更合适"}]}',
    `最多输出 ${Math.min(10, Math.max(1, candidates.length))} 个 recommendations。每个故事最多使用一次。matchScore 低于 65 的组合不要输出。`,
    '',
    '热点：',
    JSON.stringify(hotDossier(hotNewsForModel(hotNews)), null, 2),
    '',
    '召回候选及完整原文：',
    JSON.stringify(candidateStories, null, 2),
  ].join('\n')
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = []
  let nextIndex = 0
  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await mapper(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, () => worker()))
  return results
}

function deduplicateRecallCandidates(candidates: RecallCandidate[], limit: number): RecallCandidate[] {
  const bestByPair = new Map<string, RecallCandidate>()
  for (const candidate of candidates) {
    const key = `${candidate.hotNewsSource}#${candidate.hotNewsRank}#${candidate.storyId}`
    const existing = bestByPair.get(key)
    if (!existing || candidate.fitScore > existing.fitScore) bestByPair.set(key, candidate)
  }
  return [...bestByPair.values()]
    .sort((left, right) => right.fitScore - left.fitScore)
    .slice(0, Math.max(12, limit * 4))
}

export async function analyzeFullStoryCatalogWithDashscope(
  options: FullCatalogAnalysisOptions,
): Promise<FullCatalogAnalysisResult> {
  if (options.stories.length === 0) throw new Error('FULL_STORY_CATALOG_EMPTY')
  const batchSize = Math.max(1, options.batchSize)
  const batches: StoryCatalogRecord[][] = []
  for (let index = 0; index < options.stories.length; index += batchSize) {
    batches.push(options.stories.slice(index, index + batchSize))
  }
  const recallResults = await mapWithConcurrency(batches, 3, async (batch) => {
    const request = await askDashscope(buildRecallPrompt(options.hotNews, batch, options.deepReviews, options.producedStoryIds), options)
    return {
      ...request,
      candidates: parseRecallResponse(extractFirstJsonObject(request.rawText), options.stories, options.hotNews),
    }
  })
  const recallCandidates = deduplicateRecallCandidates(
    recallResults.flatMap((result) => result.candidates),
    options.limit,
  )
  if (recallCandidates.length === 0) {
    return {
      decision: { overallRead: '全量素材库已检索，但今天的热点没有达到可自然转述的故事匹配强度。', recommendations: [] },
      rawText: recallResults.map((result) => result.rawText).join('\n'),
      prompt: recallResults.map((result) => result.prompt).join('\n---BATCH---\n'),
      recallCount: 0,
      catalogCount: options.stories.length,
    }
  }

  const finalPrompt = buildFinalPrompt(options.hotNews, recallCandidates, options.stories, options.deepReviews)
  const finalRequest = await askDashscope(finalPrompt, options)
  const decision = parseSocialHotModelDecision(extractFirstJsonObject(finalRequest.rawText))
  const recalledStoryIds = new Set(recallCandidates.map((candidate) => candidate.storyId))
  const recalledPairs = new Set(recallCandidates.map((candidate) => `${candidate.hotNewsSource}#${candidate.hotNewsRank}#${candidate.storyId}`))
  const selectedStoryIds = new Set<string>()
  for (const recommendation of decision.recommendations) {
    if (!recalledStoryIds.has(recommendation.storyId)) throw new Error(`FULL_CATALOG_FINAL_STORY_NOT_RECALLED: ${recommendation.storyId}`)
    const pairKey = `${recommendation.hotNewsSource}#${recommendation.hotNewsRank}#${recommendation.storyId}`
    if (!recalledPairs.has(pairKey)) throw new Error(`FULL_CATALOG_FINAL_PAIR_NOT_RECALLED: ${pairKey}`)
    if (selectedStoryIds.has(recommendation.storyId)) throw new Error(`FULL_CATALOG_DUPLICATE_STORY: ${recommendation.storyId}`)
    selectedStoryIds.add(recommendation.storyId)
    const selectedStory = options.stories.find((story) => story.id === recommendation.storyId)
    if (!selectedStory) throw new Error(`FULL_CATALOG_FINAL_STORY_MISSING: ${recommendation.storyId}`)
    if (typeof recommendation.matchScore !== 'number') throw new Error(`FULL_CATALOG_MATCH_SCORE_MISSING: ${recommendation.storyId}`)
    if (recommendation.matchScore < 65) throw new Error(`FULL_CATALOG_MATCH_SCORE_TOO_LOW: ${recommendation.storyId}`)
    if (!recommendation.matchEvidence || !recommendation.storyEvidence || !recommendation.comparisonNote) {
      throw new Error(`FULL_CATALOG_MATCH_EVIDENCE_MISSING: ${recommendation.storyId}`)
    }
  }
  return {
    decision,
    rawText: finalRequest.rawText,
    prompt: finalPrompt,
    recallCount: recallCandidates.length,
    catalogCount: options.stories.length,
  }
}
