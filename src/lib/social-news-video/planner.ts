import path from 'node:path'
import { buildVideoAccountCopy } from './copy'
import { buildRecommendationFromModelDecision, validateModelDecisionReferences, type SocialHotModelDecision } from './model-analysis'
import { resolveStorySourceFile } from './story-catalog'
import type {
  ClassifiedHotNews,
  DeepStoryReview,
  HotNewsFetchResult,
  HotNewsItem,
  SocialHotVideoPlan,
  SocialHotVideoRecommendation,
  SocialNewsTheme,
  StoryMatch,
  StoryReviewRecord,
} from './types'

export const DEFAULT_NEWSNOW_SOURCES = ['weibo', 'baidu', 'toutiao', 'thepaper', 'zhihu', 'douyin'] as const

export const SOCIAL_NEWS_THEMES: SocialNewsTheme[] = [
  {
    id: 'brand_name_borrowing',
    label: '借名号/商标侵权',
    storyTags: ['骗术/财产纠纷', '社会新闻/冤案公案'],
    keywords: ['商标', '侵权', '版权', '抄袭', '擦边', '联名', '山寨', '冒用', '名号', '品牌', '茉莉奶白'],
    storyKeywords: ['官衔', '官銜', '名号', '名號', '体面', '體面', '势利', '勢利', '同姓', '光蓬蓽', '装点', '裝點'],
    copyLead: '人为了体面，能借名号、借招牌、借别人的光。',
    copyQuestion: '你说，人到底是在拜体面，还是在怕没人看见自己？',
    hashtags: ['#商标侵权', '#热点故事'],
  },
  {
    id: 'fraud_property',
    label: '骗术/财产纠纷',
    storyTags: ['骗术/财产纠纷'],
    keywords: ['诈骗', '骗', '盗', '偷', '欠薪', '纠纷', '退款', '赔付', '索赔', '财产', '非法集资', '骗局'],
    storyKeywords: ['骗', '騙', '盗', '盜', '偷', '钱', '錢', '银', '銀', '财', '財', '卖', '賣', '契'],
    copyLead: '有些骗局换了时代，手法变了，人心没变。',
    copyQuestion: '如果你是当事人，会第一眼看穿这场局吗？',
    hashtags: ['#骗局', '#民间故事'],
  },
  {
    id: 'legal_injustice',
    label: '司法/公案',
    storyTags: ['社会新闻/冤案公案'],
    keywords: ['法院', '判决', '开庭', '警方', '通报', '调查', '拘留', '取缔', '案件', '起诉', '审理', '冤案'],
    storyKeywords: ['冤', '案', '官', '狱', '獄', '诉', '訴', '审', '審', '判', '刑'],
    copyLead: '一桩案子最吊人的地方，往往不是结果，而是真相怎么浮出来。',
    copyQuestion: '要是没有这个反转，真相还会被看见吗？',
    hashtags: ['#古代公案', '#社会新闻'],
  },
  {
    id: 'family_ethics',
    label: '家庭/婚恋伦理',
    storyTags: ['婚恋/家庭伦理'],
    keywords: ['夫妻', '丈夫', '妻子', '父母', '家庭纠纷', '结婚纠纷', '离婚', '彩礼', '相亲', '婆婆', '家暴', '出轨'],
    storyKeywords: ['女', '男', '妻', '夫', '嫁', '婚', '妾', '婢', '父', '母', '子'],
    copyLead: '家事最难断，因为每个人都觉得自己委屈。',
    copyQuestion: '这件事里，你会站在哪一边？',
    hashtags: ['#家庭伦理', '#民间故事'],
  },
  {
    id: 'public_accident',
    label: '灾害/事故',
    storyTags: ['灾害/事故'],
    keywords: ['台风', '暴雨', '地震', '洪水', '火灾', '事故', '坍塌', '落水', '救援', '高温'],
    storyKeywords: ['水', '火', '风', '風', '雨', '灾', '災', '船', '病', '疫'],
    copyLead: '人在意外面前有多渺小，古人早就用怪事写过。',
    copyQuestion: '如果换成你，会相信这是巧合，还是报应？',
    hashtags: ['#灾害事故', '#志怪故事'],
  },
]

const HIGH_RISK_NEWS_KEYWORDS = [
  '性侵',
  '猥亵',
  '未成年',
  '自杀',
  '坠亡',
  '跳楼',
  '命案',
  '遇害',
  '杀害',
  '尸体',
  '虐童',
  '飞踹',
  '殴打',
  '打人',
  '遇难',
]

const HIGH_RISK_NEWS_PATTERNS = [
  /\d+\s*死/u,
  /\d+\s*人遇难/u,
]

const NON_SOCIAL_NEWS_KEYWORDS = [
  '世界杯',
  '韩国队',
  '主帅',
  '纽约',
  '帝国大厦',
  '全球最美女孩',
  'iPhone',
  '比亚迪',
  'A股',
  '半导体',
  '小鹏',
  '销量',
  '球星',
  '联合国',
  'AI',
  '欧洲',
  '直播事故',
  '影视飓风',
]

const HIGH_RISK_STORY_KEYWORDS = [
  '儿童性侵',
  '自残',
  '低俗',
  '血腥暴力',
]

export type BuildSocialHotVideoPlanOptions = {
  workspaceRoot: string
  outputDir: string
  hotNews: HotNewsFetchResult
  stories: StoryReviewRecord[]
  deepReviews: Map<string, DeepStoryReview>
  producedStoryIds: Set<string>
  limit?: number
  includeProduced?: boolean
  runTimestamp: string
  llmModel: string
  imageModel: string
  ttsModel: string
}

export type BuildSocialHotVideoPlanFromModelOptions = {
  workspaceRoot: string
  outputDir: string
  hotNews: HotNewsFetchResult
  stories: StoryReviewRecord[]
  deepReviews: Map<string, DeepStoryReview>
  modelDecision: SocialHotModelDecision
  limit?: number
  runTimestamp: string
  llmModel: string
  imageModel: string
  ttsModel: string
}

function textForNews(item: HotNewsItem): string {
  return `${item.title} ${item.hot}`.trim()
}

function classifyHotNewsItem(item: HotNewsItem): ClassifiedHotNews | null {
  const text = textForNews(item)
  if (NON_SOCIAL_NEWS_KEYWORDS.some((keyword) => text.includes(keyword))) return null
  const themes = SOCIAL_NEWS_THEMES
    .map((theme) => ({
      theme,
      hits: theme.keywords.filter((keyword) => text.includes(keyword)),
    }))
    .filter((entry) => entry.hits.length > 0)

  if (themes.length === 0) return null

  const riskHits = [
    ...HIGH_RISK_NEWS_KEYWORDS.filter((keyword) => text.includes(keyword)),
    ...HIGH_RISK_NEWS_PATTERNS.filter((pattern) => pattern.test(text)).map((pattern) => pattern.source),
  ]
  const rankScore = Math.max(0, 35 - item.rank)
  const sourceScore = item.source === 'baidu' || item.source === 'weibo' ? 8 : 0
  const themeScore = themes.reduce((sum, entry) => sum + entry.hits.length * 12, 0)

  return {
    item,
    themes,
    riskHits,
    score: rankScore + sourceScore + themeScore - riskHits.length * 80,
  }
}

function normalizeTitle(title: string): string {
  return title.replace(/[^\p{Script=Han}a-zA-Z0-9]/gu, '').toLowerCase()
}

export function classifyHotNews(items: HotNewsItem[]): ClassifiedHotNews[] {
  const bestByTitle = new Map<string, ClassifiedHotNews>()
  for (const item of items) {
    const classified = classifyHotNewsItem(item)
    if (!classified || classified.score <= 0) continue
    const key = normalizeTitle(item.title)
    const existing = bestByTitle.get(key)
    if (!existing || classified.score > existing.score) bestByTitle.set(key, classified)
  }

  return [...bestByTitle.values()].sort((left, right) => right.score - left.score)
}

function storyRiskHits(story: StoryReviewRecord, deepReview: DeepStoryReview | null): string[] {
  const text = `${story.riskTags} ${deepReview?.riskNotes || ''}`
  return HIGH_RISK_STORY_KEYWORDS.filter((keyword) => text.includes(keyword))
}

function storySearchText(story: StoryReviewRecord, deepReview: DeepStoryReview | null): string {
  return [
    story.titleTrad,
    story.categoryTags,
    story.modernAngle,
    story.sourceExcerpt,
    deepReview?.titleSimplified || '',
    deepReview?.oneSentenceSummary || '',
    deepReview?.modernNewsAngle || '',
    deepReview?.emotionalHook || '',
  ].join(' ')
}

function matchStoryForHotNews(
  workspaceRoot: string,
  hotNews: ClassifiedHotNews,
  stories: StoryReviewRecord[],
  deepReviews: Map<string, DeepStoryReview>,
  producedStoryIds: Set<string>,
  excludedStoryIds: Set<string>,
  includeProduced: boolean,
): StoryMatch | null {
  const primaryTheme = hotNews.themes[0].theme
  const expectedTags = new Set(primaryTheme.storyTags)
  const storyKeywords = new Set(primaryTheme.storyKeywords)
  const matches = stories
    .map((story) => {
      const deepReview = deepReviews.get(story.id) || null
      const matchedTags = [...expectedTags].filter((tag) => story.categoryTags.includes(tag))
      const searchText = storySearchText(story, deepReview)
      const matchedStoryKeywords = [...storyKeywords].filter((keyword) => searchText.includes(keyword))
      const riskHits = storyRiskHits(story, deepReview)
      const produced = producedStoryIds.has(story.id) || excludedStoryIds.has(story.id)
      const sourceFile = resolveStorySourceFile(workspaceRoot, story)
      const priorityBonus = story.priority === 'S' ? 12 : story.priority === 'A' ? 6 : 0
      const deepBonus = deepReview?.productionPriority === '强烈推荐' ? 10 : 0
      const producedPenalty = produced && !includeProduced ? 500 : 0
      const score = matchedTags.length * 70
        + matchedStoryKeywords.length * 22
        + story.productionScore
        + priorityBonus
        + deepBonus
        - story.productionDifficulty * 8
        - riskHits.length * 45
        - producedPenalty
      return {
        story,
        deepReview,
        sourceFile,
        score,
        matchedTags: [...matchedTags, ...matchedStoryKeywords.map((keyword) => `keyword:${keyword}`)],
        riskHits,
        produced,
      }
    })
    .filter((match) => match.matchedTags.some((tag) => tag.startsWith('keyword:')))
    .filter((match) => match.story.productionRecommendation === '推荐')
    .filter((match) => match.score > 0)
    .sort((left, right) => right.score - left.score)

  return matches[0] || null
}

function slugFromHotNews(item: HotNewsItem): string {
  const ascii = item.title
    .replace(/[^a-zA-Z0-9\u4e00-\u9fa5]+/gu, '-')
    .replace(/^-|-$/gu, '')
  return ascii.slice(0, 40) || item.source
}

function buildGenerationCommand(storyFile: string, outputDir: string, options: BuildSocialHotVideoPlanOptions): string[] {
  return [
    'npm',
    'run',
    'video:run-story-full-aliyun',
    '--',
    '--story-file',
    storyFile,
    '--output-dir',
    outputDir,
    '--llm-model',
    options.llmModel,
    '--image-model',
    options.imageModel,
    '--tts-model',
    options.ttsModel,
  ]
}

function buildRecommendation(
  hotNews: ClassifiedHotNews,
  storyMatch: StoryMatch,
  options: BuildSocialHotVideoPlanOptions,
): SocialHotVideoRecommendation {
  const primaryTheme = hotNews.themes[0].theme
  const outputDir = path.join(
    options.workspaceRoot,
    'materials',
    'zibuyu',
    'runs',
    `${options.runTimestamp}-${storyMatch.story.id}-${slugFromHotNews(hotNews.item)}-aliyun-full`,
  )
  return {
    hotNews,
    storyMatch,
    publishCopy: buildVideoAccountCopy(storyMatch, primaryTheme.copyLead, primaryTheme.copyQuestion, primaryTheme.hashtags),
    generation: {
      storyFile: storyMatch.sourceFile,
      outputDir,
      command: buildGenerationCommand(storyMatch.sourceFile, outputDir, options),
    },
  }
}

export function buildSocialHotVideoPlan(options: BuildSocialHotVideoPlanOptions): SocialHotVideoPlan {
  const classified = classifyHotNews(options.hotNews.items)
  const recommendations: SocialHotVideoRecommendation[] = []
  const usedStoryIds = new Set<string>()

  for (const hotNews of classified) {
    const storyMatch = matchStoryForHotNews(
      options.workspaceRoot,
      hotNews,
      options.stories,
      options.deepReviews,
      options.producedStoryIds,
      usedStoryIds,
      Boolean(options.includeProduced),
    )
    if (!storyMatch) continue
    recommendations.push(buildRecommendation(hotNews, storyMatch, options))
    usedStoryIds.add(storyMatch.story.id)
    if (recommendations.length >= (options.limit ?? 5)) break
  }

  return {
    generatedAt: new Date().toISOString(),
    workspaceRoot: options.workspaceRoot,
    outputDir: options.outputDir,
    sourceErrors: options.hotNews.errors,
    selected: recommendations[0] || null,
    recommendations,
  }
}

export function buildSocialHotVideoPlanFromModelDecision(
  options: BuildSocialHotVideoPlanFromModelOptions,
): SocialHotVideoPlan {
  validateModelDecisionReferences(options.modelDecision, options.hotNews, options.stories)
  const recommendations = options.modelDecision.recommendations
    .filter((recommendation) => recommendation.riskLevel !== 'high')
    .slice(0, options.limit ?? 5)
    .map((recommendation) => buildRecommendationFromModelDecision({
      workspaceRoot: options.workspaceRoot,
      runTimestamp: options.runTimestamp,
      llmModel: options.llmModel,
      imageModel: options.imageModel,
      ttsModel: options.ttsModel,
      hotNews: options.hotNews,
      stories: options.stories,
      deepReviews: options.deepReviews,
      decision: recommendation,
    }))

  return {
    generatedAt: new Date().toISOString(),
    workspaceRoot: options.workspaceRoot,
    outputDir: options.outputDir,
    sourceErrors: options.hotNews.errors,
    modelDecision: options.modelDecision,
    selected: recommendations[0] || null,
    recommendations,
  }
}

export function renderSocialHotVideoPlanMarkdown(plan: SocialHotVideoPlan): string {
  const lines = [
    '# Social Hot Story Video Plan',
    '',
    `Generated: ${plan.generatedAt}`,
    `Workspace: ${plan.workspaceRoot}`,
    '',
  ]

  if (plan.sourceErrors.length > 0) {
    lines.push('## Source Errors', '')
    for (const error of plan.sourceErrors) lines.push(`- ${error.source}: ${error.message}`)
    lines.push('')
  }

  lines.push('## Recommendations', '')
  if (plan.recommendations.length === 0) {
    lines.push('No recommendation passed the filters.')
    return lines.join('\n')
  }

  plan.recommendations.forEach((recommendation, index) => {
    lines.push(`### ${index + 1}. ${recommendation.publishCopy.title}`)
    lines.push('')
    lines.push(`- Hot: [${recommendation.hotNews.item.source}#${recommendation.hotNews.item.rank}] ${recommendation.hotNews.item.title}`)
    lines.push(`- Themes: ${recommendation.hotNews.themes.map((entry) => entry.theme.label).join(', ')}`)
    lines.push(`- Story: ${recommendation.storyMatch.story.id} ${recommendation.storyMatch.story.titleTrad}`)
    lines.push(`- Story file: ${recommendation.generation.storyFile}`)
    lines.push(`- Output dir: ${recommendation.generation.outputDir}`)
    lines.push(`- Command: \`${recommendation.generation.command.join(' ')}\``)
    lines.push('')
    lines.push('Copy:')
    lines.push('')
    lines.push(recommendation.publishCopy.body)
    lines.push('')
    lines.push(recommendation.publishCopy.hashtags.join(' '))
    lines.push('')
  })

  return lines.join('\n')
}
