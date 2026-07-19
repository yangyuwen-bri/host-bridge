export type HotNewsItem = {
  source: string
  rank: number
  title: string
  url: string
  hot: string
  fetchedAt: string
}

export type HotNewsSourceError = {
  source: string
  message: string
}

export type HotNewsFetchResult = {
  fetchedAt: string
  items: HotNewsItem[]
  errors: HotNewsSourceError[]
}

export type SocialNewsTheme = {
  id: string
  label: string
  storyTags: string[]
  keywords: string[]
  storyKeywords: string[]
  copyLead: string
  copyQuestion: string
  hashtags: string[]
}

export type ClassifiedHotNews = {
  item: HotNewsItem
  themes: Array<{
    theme: SocialNewsTheme
    hits: string[]
  }>
  riskHits: string[]
  score: number
}

export type StoryReviewRecord = {
  id: string
  titleTrad: string
  priority: string
  sourcePath: string
  categoryTags: string
  riskTags: string
  modernAngle: string
  productionScore: number
  productionRecommendation: string
  productionDifficulty: number
  sourceExcerpt: string
  textCharCount: number
}

export type StoryCatalogRecord = StoryReviewRecord & {
  sourceText: string
}

export type DeepStoryReview = {
  id: string
  titleSimplified: string
  oneSentenceSummary: string
  modernNewsAngle: string
  emotionalHook: string
  productionPriority: string
  riskNotes: string
}

export type StoryMatch = {
  story: StoryReviewRecord
  deepReview: DeepStoryReview | null
  sourceFile: string
  score: number
  matchedTags: string[]
  riskHits: string[]
  produced: boolean
}

export type SocialHotVideoRecommendation = {
  hotNews: ClassifiedHotNews
  storyMatch: StoryMatch
  publishCopy: {
    title: string
    body: string
    hashtags: string[]
  }
  generation: {
    storyFile: string
    outputDir: string
    command: string[]
  }
}

export type SocialHotVideoPlan = {
  generatedAt: string
  workspaceRoot: string
  outputDir: string
  sourceErrors: HotNewsSourceError[]
  modelDecision?: {
    overallRead: string
    recommendations: Array<{
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
    }>
  }
  selected: SocialHotVideoRecommendation | null
  recommendations: SocialHotVideoRecommendation[]
}
