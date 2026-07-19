import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { DeepStoryReview, StoryCatalogRecord, StoryReviewRecord } from './types'

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function readString(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  return typeof value === 'string' ? value.trim() : ''
}

function readNumber(row: Record<string, unknown>, key: string): number {
  const value = row[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function readJsonFile(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, 'utf8')) as unknown
}

function compactExcerpt(value: string, maxChars: number): string {
  const text = value.replace(/\s+/gu, ' ').trim()
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text
}

export function loadStoryReviewRecords(reviewPath: string): StoryReviewRecord[] {
  const payload = asRecord(readJsonFile(reviewPath))
  const records = payload?.records
  if (!Array.isArray(records)) throw new Error(`STORY_REVIEW_RECORDS_MISSING: ${reviewPath}`)

  return records.map((item, index) => {
    const row = asRecord(item)
    if (!row) throw new Error(`STORY_REVIEW_RECORD_INVALID: ${index}`)
    const id = readString(row, 'id')
    const sourcePath = readString(row, 'source_path')
    if (!id || !sourcePath) throw new Error(`STORY_REVIEW_REQUIRED_FIELD_EMPTY: ${index}`)
    return {
      id,
      titleTrad: readString(row, 'title_trad'),
      priority: readString(row, 'priority'),
      sourcePath,
      categoryTags: readString(row, 'category_tags'),
      riskTags: readString(row, 'risk_tags'),
      modernAngle: readString(row, 'modern_angle'),
      productionScore: readNumber(row, 'production_score'),
      productionRecommendation: readString(row, 'production_recommendation'),
      productionDifficulty: readNumber(row, 'production_difficulty'),
      sourceExcerpt: readString(row, 'source_excerpt'),
      textCharCount: readNumber(row, 'text_char_count'),
    }
  })
}

export function loadFullZbyStoryCatalog(
  workspaceRoot: string,
  reviewRecords: StoryReviewRecord[],
): StoryCatalogRecord[] {
  const storiesRoot = path.join(workspaceRoot, 'materials', 'zhiguai', 'stories')
  if (!existsSync(storiesRoot)) throw new Error(`STORY_CATALOG_ROOT_MISSING: ${storiesRoot}`)

  const reviewedById = new Map(reviewRecords.map((record) => [record.id, record]))
  const entries = readdirSync(storiesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^zby-v\d{2}-\d{3}$/u.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name))

  return entries.map((entry) => {
    const id = entry.name
    const storyDirectory = path.join(storiesRoot, id)
    const sourceFile = path.join(storyDirectory, 'source.txt')
    const metaFile = path.join(storyDirectory, 'meta.json')
    if (!existsSync(sourceFile) || !existsSync(metaFile)) {
      throw new Error(`STORY_CATALOG_ENTRY_INCOMPLETE: ${id}`)
    }
    const sourceText = readFileSync(sourceFile, 'utf8').trim()
    const meta = asRecord(readJsonFile(metaFile))
    if (!meta) throw new Error(`STORY_CATALOG_META_INVALID: ${id}`)
    const reviewed = reviewedById.get(id)
    const title = readString(meta, 'title') || readString(meta, 'story_anchor')
    if (!title) throw new Error(`STORY_CATALOG_TITLE_MISSING: ${id}`)
    if (!sourceText) throw new Error(`STORY_CATALOG_SOURCE_EMPTY: ${id}`)

    return {
      id,
      titleTrad: reviewed?.titleTrad || title,
      priority: reviewed?.priority || '未审阅',
      sourcePath: reviewed?.sourcePath || `stories/${id}/source.txt`,
      categoryTags: reviewed?.categoryTags || '',
      riskTags: reviewed?.riskTags || '',
      modernAngle: reviewed?.modernAngle || '',
      productionScore: reviewed?.productionScore || 0,
      productionRecommendation: reviewed?.productionRecommendation || '可备选',
      productionDifficulty: reviewed?.productionDifficulty || 0,
      sourceExcerpt: reviewed?.sourceExcerpt || compactExcerpt(sourceText, 280),
      textCharCount: reviewed?.textCharCount || sourceText.length,
      sourceText,
    }
  })
}

export function loadDeepStoryReviews(reviewPath: string): Map<string, DeepStoryReview> {
  if (!existsSync(reviewPath)) return new Map()
  const payload = asRecord(readJsonFile(reviewPath))
  const reviews = payload?.reviews
  if (!Array.isArray(reviews)) throw new Error(`DEEP_STORY_REVIEWS_MISSING: ${reviewPath}`)

  return new Map(reviews.map((item, index) => {
    const row = asRecord(item)
    if (!row) throw new Error(`DEEP_STORY_REVIEW_INVALID: ${index}`)
    const id = readString(row, 'id')
    if (!id) throw new Error(`DEEP_STORY_REVIEW_ID_EMPTY: ${index}`)
    const review: DeepStoryReview = {
      id,
      titleSimplified: readString(row, 'title_simplified'),
      oneSentenceSummary: readString(row, 'one_sentence_summary'),
      modernNewsAngle: readString(row, 'modern_news_angle'),
      emotionalHook: readString(row, 'emotional_hook'),
      productionPriority: readString(row, 'production_priority'),
      riskNotes: readString(row, 'risk_notes'),
    }
    return [id, review]
  }))
}

function collectStoryIdsFromReleaseFile(filePath: string): string[] {
  try {
    const payload = asRecord(readJsonFile(filePath))
    const ids = new Set<string>()
    const selector = asRecord(payload?.story_selector)
    const selectorId = selector ? readString(selector, 'story_id') : ''
    if (selectorId) ids.add(selectorId)
    const runs = payload?.runs
    if (Array.isArray(runs)) {
      for (const item of runs) {
        const row = asRecord(item)
        if (!row) continue
        const rowStoryId = readString(row, 'story_id')
        if (rowStoryId) ids.add(rowStoryId)
      }
    }
    return [...ids]
  } catch {
    return []
  }
}

export function collectProducedStoryIds(runsDir: string): Set<string> {
  const produced = new Set<string>()
  if (!existsSync(runsDir)) return produced

  for (const entry of readdirSync(runsDir, { withFileTypes: true })) {
    const match = entry.name.match(/(zby-v\d{2}-\d{3}|lzz-v\d{2}-\d{3}|xzby-v\d{2}-\d{3})/u)
    if (entry.isDirectory() && match) produced.add(match[1])
    if (entry.isFile() && entry.name.endsWith('-release-package.json')) {
      for (const storyId of collectStoryIdsFromReleaseFile(path.join(runsDir, entry.name))) {
        produced.add(storyId)
      }
    }
  }

  return produced
}

export function resolveStorySourceFile(workspaceRoot: string, record: StoryReviewRecord): string {
  const normalized = record.sourcePath.replace(/^\/+/u, '')
  return path.join(workspaceRoot, 'materials', 'zhiguai', normalized)
}
