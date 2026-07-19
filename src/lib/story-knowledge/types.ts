export type StoryKnowledgeProductionPriority = '强烈推荐' | '推荐' | '谨慎' | '暂缓' | '可备选' | '谨慎生产'

export interface StoryKnowledgeDeepReview {
  id: string
  titleSimplified: string
  oneSentenceSummary: string
  modernNewsAngle: string
  mainConflict: string
  emotionalHook: string
  accountColumn: string
  videoTitleAngles: string[]
  riskNotes: string
  visualNotes: string
  productionPriority: StoryKnowledgeProductionPriority
  productionReason: string
}

export interface StoryKnowledgeRecord {
  id: string
  titleTraditional: string
  titleSimplified: string
  volume: string
  priority: string
  textCharCount: number
  sourcePath: string
  isGenerated: boolean
  generatedVideoPath: string | null
  categoryTags: string[]
  riskTags: string[]
  recommendedColumn: string
  modernAngle: string
  productionScore: number
  productionRecommendation: StoryKnowledgeProductionPriority
  productionDifficulty: number
  difficultyReason: string
  sourceExcerpt: string
  deepReview: StoryKnowledgeDeepReview | null
}

export interface StoryKnowledgeSummary {
  totalReviewed: number
  deepReviewed: number
  generatedCount: number
  pendingCount: number
  byColumn: Record<string, number>
  byRecommendation: Record<string, number>
}

export interface StoryKnowledgeDatabase {
  generatedAt: string
  summary: StoryKnowledgeSummary
  records: StoryKnowledgeRecord[]
}

export interface StoryStudioBrief {
  generatedAt: string
  summary: StoryKnowledgeSummary
  heroPick: StoryKnowledgeRecord | null
  editorialPicks: StoryKnowledgeRecord[]
  columns: Array<{
    name: string
    count: number
    topRecords: StoryKnowledgeRecord[]
  }>
  generatedShowcase: StoryKnowledgeRecord[]
}
