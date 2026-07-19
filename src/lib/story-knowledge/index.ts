import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type {
  StoryKnowledgeDatabase,
  StoryKnowledgeDeepReview,
  StoryKnowledgeProductionPriority,
  StoryKnowledgeRecord,
  StoryKnowledgeSummary,
  StoryStudioBrief,
} from './types'

const REVIEW_DIR = path.join('materials', 'zhiguai', 'analysis', 'content_ops_review')
const RULE_FILE = 'zby_sa_ops_review_rule_first_pass.json'
const SHORTLIST_FILE = 'zby_s_priority_shortlist.json'

interface RawRuleReviewFile {
  meta?: unknown
  records?: unknown
}

interface RawRuleRecord {
  id?: unknown
  title_trad?: unknown
  volume?: unknown
  priority?: unknown
  text_char_count?: unknown
  source_path?: unknown
  is_generated?: unknown
  generated_video?: unknown
  category_tags?: unknown
  risk_tags?: unknown
  recommended_column?: unknown
  modern_angle?: unknown
  production_score?: unknown
  production_recommendation?: unknown
  production_difficulty?: unknown
  difficulty_reason?: unknown
  source_excerpt?: unknown
}

interface RawShortlistFile {
  records?: unknown
}

interface RawShortlistRecord extends RawRuleRecord {
  deep?: unknown
}

interface RawDeepReview {
  id?: unknown
  title_simplified?: unknown
  one_sentence_summary?: unknown
  modern_news_angle?: unknown
  main_conflict?: unknown
  emotional_hook?: unknown
  account_column?: unknown
  video_title_angles?: unknown
  risk_notes?: unknown
  visual_notes?: unknown
  production_priority?: unknown
  production_reason?: unknown
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function toStringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function toNumberValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function toBooleanValue(value: unknown): boolean {
  return value === true
}

function splitChineseList(value: unknown): string[] {
  const raw = toStringValue(value)
  if (!raw) return []
  return raw.split('、').map((item) => item.trim()).filter((item) => item.length > 0)
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => toStringValue(item)).filter((item) => item.length > 0)
}

function normalizePriority(value: unknown): StoryKnowledgeProductionPriority {
  const raw = toStringValue(value)
  if (raw === '强烈推荐' || raw === '推荐' || raw === '谨慎' || raw === '暂缓' || raw === '可备选' || raw === '谨慎生产') {
    return raw
  }
  return '可备选'
}

function readJsonFile<T>(filePath: string): T {
  const payload = JSON.parse(readFileSync(filePath, 'utf8')) as unknown
  return payload as T
}

function parseDeepReview(value: unknown): StoryKnowledgeDeepReview | null {
  const raw = toRecord(value) as RawDeepReview | null
  if (!raw) return null
  const id = toStringValue(raw.id)
  if (!id) return null
  return {
    id,
    titleSimplified: toStringValue(raw.title_simplified),
    oneSentenceSummary: toStringValue(raw.one_sentence_summary),
    modernNewsAngle: toStringValue(raw.modern_news_angle),
    mainConflict: toStringValue(raw.main_conflict),
    emotionalHook: toStringValue(raw.emotional_hook),
    accountColumn: toStringValue(raw.account_column),
    videoTitleAngles: toStringArray(raw.video_title_angles),
    riskNotes: toStringValue(raw.risk_notes),
    visualNotes: toStringValue(raw.visual_notes),
    productionPriority: normalizePriority(raw.production_priority),
    productionReason: toStringValue(raw.production_reason),
  }
}

function parseRuleRecord(value: unknown, deepReview: StoryKnowledgeDeepReview | null): StoryKnowledgeRecord | null {
  const raw = toRecord(value) as RawRuleRecord | null
  if (!raw) return null
  const id = toStringValue(raw.id)
  if (!id) return null
  const titleTraditional = toStringValue(raw.title_trad)
  const generatedVideoPath = toStringValue(raw.generated_video)
  return {
    id,
    titleTraditional,
    titleSimplified: deepReview?.titleSimplified || titleTraditional,
    volume: toStringValue(raw.volume),
    priority: toStringValue(raw.priority),
    textCharCount: toNumberValue(raw.text_char_count),
    sourcePath: toStringValue(raw.source_path),
    isGenerated: toBooleanValue(raw.is_generated),
    generatedVideoPath: generatedVideoPath || null,
    categoryTags: splitChineseList(raw.category_tags),
    riskTags: splitChineseList(raw.risk_tags),
    recommendedColumn: toStringValue(raw.recommended_column) || '待分栏',
    modernAngle: toStringValue(raw.modern_angle),
    productionScore: toNumberValue(raw.production_score),
    productionRecommendation: normalizePriority(raw.production_recommendation),
    productionDifficulty: toNumberValue(raw.production_difficulty),
    difficultyReason: toStringValue(raw.difficulty_reason),
    sourceExcerpt: toStringValue(raw.source_excerpt),
    deepReview,
  }
}

function priorityWeight(record: StoryKnowledgeRecord): number {
  const reviewedPriority = record.deepReview?.productionPriority || record.productionRecommendation
  if (reviewedPriority === '强烈推荐') return 120
  if (reviewedPriority === '推荐') return 90
  if (reviewedPriority === '可备选') return 60
  if (reviewedPriority === '谨慎' || reviewedPriority === '谨慎生产') return 35
  return 10
}

function compareStoryRecords(a: StoryKnowledgeRecord, b: StoryKnowledgeRecord): number {
  const generatedDelta = Number(a.isGenerated) - Number(b.isGenerated)
  if (generatedDelta !== 0) return generatedDelta
  const priorityDelta = priorityWeight(b) - priorityWeight(a)
  if (priorityDelta !== 0) return priorityDelta
  const scoreDelta = b.productionScore - a.productionScore
  if (scoreDelta !== 0) return scoreDelta
  return a.id.localeCompare(b.id)
}

function buildSummary(records: StoryKnowledgeRecord[]): StoryKnowledgeSummary {
  const byColumn: Record<string, number> = {}
  const byRecommendation: Record<string, number> = {}
  let generatedCount = 0
  for (const record of records) {
    byColumn[record.recommendedColumn] = (byColumn[record.recommendedColumn] || 0) + 1
    const recommendation = record.deepReview?.productionPriority || record.productionRecommendation
    byRecommendation[recommendation] = (byRecommendation[recommendation] || 0) + 1
    if (record.isGenerated) generatedCount += 1
  }
  return {
    totalReviewed: records.length,
    deepReviewed: records.filter((record) => record.deepReview !== null).length,
    generatedCount,
    pendingCount: records.length - generatedCount,
    byColumn,
    byRecommendation,
  }
}

export function readStoryKnowledgeDatabase(workspaceRootInput: string): StoryKnowledgeDatabase {
  const workspaceRoot = path.resolve(workspaceRootInput)
  const reviewDir = path.join(workspaceRoot, REVIEW_DIR)
  const rulePath = path.join(reviewDir, RULE_FILE)
  const shortlistPath = path.join(reviewDir, SHORTLIST_FILE)
  if (!existsSync(rulePath)) throw new Error(`STORY_KNOWLEDGE_RULE_FILE_NOT_FOUND: ${rulePath}`)

  const deepById = new Map<string, StoryKnowledgeDeepReview>()
  if (existsSync(shortlistPath)) {
    const shortlist = readJsonFile<RawShortlistFile>(shortlistPath)
    const shortlistRows = Array.isArray(shortlist.records) ? shortlist.records : []
    for (const row of shortlistRows) {
      const raw = toRecord(row) as RawShortlistRecord | null
      if (!raw) continue
      const deep = parseDeepReview(raw.deep)
      if (deep) deepById.set(deep.id, deep)
    }
  }

  const ruleFile = readJsonFile<RawRuleReviewFile>(rulePath)
  const rows = Array.isArray(ruleFile.records) ? ruleFile.records : []
  const records = rows
    .map((row) => {
      const raw = toRecord(row) as RawRuleRecord | null
      const id = raw ? toStringValue(raw.id) : ''
      return parseRuleRecord(row, id ? deepById.get(id) || null : null)
    })
    .filter((record): record is StoryKnowledgeRecord => record !== null)
    .sort(compareStoryRecords)
  const metaRecord = toRecord(ruleFile.meta)
  const generatedAt = toStringValue(metaRecord?.generated_at) || new Date().toISOString()
  return {
    generatedAt,
    summary: buildSummary(records),
    records,
  }
}

export function buildStoryStudioBrief(workspaceRootInput: string): StoryStudioBrief {
  const db = readStoryKnowledgeDatabase(workspaceRootInput)
  const editorialPicks = db.records.slice(0, 12)
  const heroPick = editorialPicks[0] || null
  const columnNames = Object.entries(db.summary.byColumn)
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name)
  const columns = columnNames.map((name) => ({
    name,
    count: db.summary.byColumn[name] || 0,
    topRecords: db.records.filter((record) => record.recommendedColumn === name).slice(0, 5),
  }))
  return {
    generatedAt: db.generatedAt,
    summary: db.summary,
    heroPick,
    editorialPicks,
    columns,
    generatedShowcase: db.records.filter((record) => record.isGenerated).slice(0, 8),
  }
}
