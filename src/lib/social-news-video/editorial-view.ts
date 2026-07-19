import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { SocialHotVideoPlan, HotNewsFetchResult } from './types'
import { readLatestEditorialProductionResult, type EditorialProductionResult } from './editorial-result'

export type EditorialSnapshotStatus = 'live' | 'local-snapshot' | 'unavailable'

export interface EditorialHotItem {
  id: string
  source: string
  sourceLabel: string
  rank: number
  title: string
  heat: string
  trend: '上升' | '平稳' | '回落'
  issue: string
  lead: string
  url: string
  fetchedAt: string
}

export interface EditorialRecommendation {
  hotId: string
  storyId: string
  storyTitle: string
  socialIssue: string
  matchReason: string
  matchScore: number | null
  matchEvidence: string
  storyEvidence: string
  comparisonNote: string
  storySourcePath: string
  storyTextCharCount: number
  storySummary: string
  storyAngle: string
  storyCategoryTags: string
  storyRiskTags: string
  storyProductionRecommendation: string
  riskLevel: 'low' | 'medium' | 'high'
  riskNotes: string
  publishTitle: string
  publishBody: string
  hashtags: string[]
}

export interface EditorialSnapshot {
  status: EditorialSnapshotStatus
  generatedAt: string | null
  fetchedAt: string | null
  overallRead: string | null
  hotItems: EditorialHotItem[]
  recommendations: EditorialRecommendation[]
  sourceErrors: Array<{ source: string; message: string }>
  error: string | null
  sourcePath: string | null
  latestResult: EditorialProductionResult | null
}

const SOURCE_LABELS: Record<string, string> = {
  weibo: '微博',
  baidu: '百度',
  toutiao: '头条',
  thepaper: '澎湃',
  zhihu: '知乎',
  douyin: '抖音',
}

function hotId(source: string, rank: number): string {
  return `${source}#${rank}`
}

function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] || source
}

function leadForIssue(issue: string): string {
  return `这件事真正让人停下来想的，不只是结果，而是${issue}。`
}

function recommendationForHot(plan: SocialHotVideoPlan, source: string, rank: number): EditorialRecommendation | null {
  const recommendation = plan.recommendations.find((item) => (
    item.hotNews.item.source === source && item.hotNews.item.rank === rank
  ))
  if (!recommendation) return null

  const modelRecommendation = plan.modelDecision?.recommendations.find((item) => (
    item.hotNewsSource === source && item.hotNewsRank === rank
  ))
  const issue = modelRecommendation?.socialIssue || recommendation.hotNews.themes[0]?.theme.label || '社会议题'
  const matchReason = modelRecommendation?.matchReason
    || recommendation.storyMatch.matchedTags[1]
    || '模型已选入候选，具体匹配理由待补充。'
  const story = recommendation.storyMatch.story
  const deepReview = recommendation.storyMatch.deepReview

  return {
    hotId: hotId(source, rank),
    storyId: recommendation.storyMatch.story.id,
    storyTitle: recommendation.storyMatch.story.titleTrad,
    socialIssue: issue,
    matchReason,
    matchScore: modelRecommendation?.matchScore ?? null,
    matchEvidence: modelRecommendation?.matchEvidence || '',
    storyEvidence: modelRecommendation?.storyEvidence || '',
    comparisonNote: modelRecommendation?.comparisonNote || '',
    storySourcePath: story.sourcePath,
    storyTextCharCount: story.textCharCount,
    storySummary: deepReview?.oneSentenceSummary || story.sourceExcerpt,
    storyAngle: deepReview?.modernNewsAngle || story.modernAngle,
    storyCategoryTags: story.categoryTags,
    storyRiskTags: story.riskTags,
    storyProductionRecommendation: story.productionRecommendation,
    riskLevel: modelRecommendation?.riskLevel || (recommendation.storyMatch.riskHits.length > 0 ? 'medium' : 'low'),
    riskNotes: modelRecommendation?.riskNotes || recommendation.storyMatch.riskHits.join('、') || '保持故事与现实新闻的边界。',
    publishTitle: recommendation.publishCopy.title,
    publishBody: recommendation.publishCopy.body,
    hashtags: recommendation.publishCopy.hashtags,
  }
}

export function buildEditorialSnapshot(input: {
  status: Exclude<EditorialSnapshotStatus, 'unavailable'>
  hotNews: HotNewsFetchResult
  plan: SocialHotVideoPlan
  sourcePath?: string | null
}): EditorialSnapshot {
  const recommendations = input.plan.recommendations
    .map((recommendation) => recommendationForHot(
      input.plan,
      recommendation.hotNews.item.source,
      recommendation.hotNews.item.rank,
    ))
    .filter((recommendation): recommendation is EditorialRecommendation => recommendation !== null)
  const recommendationByHotId = new Map(recommendations.map((recommendation) => [recommendation.hotId, recommendation]))

  return {
    status: input.status,
    generatedAt: input.plan.generatedAt,
    fetchedAt: input.hotNews.fetchedAt,
    overallRead: input.plan.modelDecision?.overallRead || null,
    hotItems: input.hotNews.items.map((item) => {
      const recommendation = recommendationByHotId.get(hotId(item.source, item.rank))
      const issue = recommendation?.socialIssue || '尚未完成议题提炼'
      return {
        id: hotId(item.source, item.rank),
        source: item.source,
        sourceLabel: sourceLabel(item.source),
        rank: item.rank,
        title: item.title,
        heat: item.hot || '—',
        trend: '平稳',
        issue,
        lead: recommendation ? leadForIssue(issue) : '这条热点还没有完成故事匹配，暂不替它下结论。',
        url: item.url,
        fetchedAt: item.fetchedAt,
      }
    }),
    recommendations,
    sourceErrors: input.hotNews.errors,
    error: null,
    sourcePath: input.sourcePath || null,
    latestResult: null,
  }
}

export function unavailableEditorialSnapshot(message: string): EditorialSnapshot {
  return {
    status: 'unavailable',
    generatedAt: null,
    fetchedAt: null,
    overallRead: null,
    hotItems: [],
    recommendations: [],
    sourceErrors: [],
    error: message,
    sourcePath: null,
    latestResult: null,
  }
}

function latestPlanDirectory(workspaceRoot: string): string | null {
  const root = path.join(workspaceRoot, 'materials', 'zibuyu', 'social-hot-plans')
  if (!existsSync(root)) return null
  const directories = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse()
  for (const directory of directories) {
    const candidate = path.join(root, directory)
    if (existsSync(path.join(candidate, '01_hot_news_raw.json')) && existsSync(path.join(candidate, '05_social_hot_video_plan.json'))) {
      return candidate
    }
  }
  return null
}

export function readLatestEditorialSnapshot(workspaceRootInput: string): EditorialSnapshot {
  const workspaceRoot = path.resolve(workspaceRootInput)
  const directory = latestPlanDirectory(workspaceRoot)
  if (!directory) return unavailableEditorialSnapshot('本机没有可读取的热点快照，请先运行一次热点分析。')

  try {
    const hotNews = JSON.parse(readFileSync(path.join(directory, '01_hot_news_raw.json'), 'utf8')) as HotNewsFetchResult
    const plan = JSON.parse(readFileSync(path.join(directory, '05_social_hot_video_plan.json'), 'utf8')) as SocialHotVideoPlan
    if (!Array.isArray(hotNews.items) || !Array.isArray(plan.recommendations)) {
      throw new Error(`LOCAL_EDITORIAL_SNAPSHOT_INVALID: ${directory}`)
    }
    const snapshot = buildEditorialSnapshot({ status: 'local-snapshot', hotNews, plan, sourcePath: directory })
    const latestResult = readLatestEditorialProductionResult(workspaceRoot)
    if (!latestResult) return snapshot

    const snapshotTime = Date.parse(snapshot.generatedAt || snapshot.fetchedAt || '')
    const resultTime = Date.parse(latestResult.updatedAt)
    if (!Number.isFinite(resultTime) || (Number.isFinite(snapshotTime) && resultTime < snapshotTime)) {
      return snapshot
    }

    return {
      ...snapshot,
      generatedAt: latestResult.updatedAt,
      fetchedAt: latestResult.hotItem.fetchedAt,
      hotItems: [
        latestResult.hotItem,
        ...snapshot.hotItems.filter((item) => item.id !== latestResult.hotItem.id),
      ],
      recommendations: [
        latestResult.recommendation,
        ...snapshot.recommendations.filter((item) => item.storyId !== latestResult.storyId),
      ],
      sourcePath: getEditorialProductionResultSourcePath(workspaceRoot),
      latestResult,
    }
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error))
  }
}

function getEditorialProductionResultSourcePath(workspaceRoot: string): string {
  return path.join(workspaceRoot, 'materials', 'zibuyu', 'ops', 'story_studio_latest_result.json')
}
