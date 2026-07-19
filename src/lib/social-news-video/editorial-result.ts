import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { EditorialHotItem, EditorialRecommendation } from './editorial-view'

export type EditorialProductionStatus = 'queued' | 'running' | 'succeeded' | 'failed'

export interface EditorialProductionResult {
  updatedAt: string
  jobId: string
  status: EditorialProductionStatus
  storyId: string
  runDir: string
  videoPath: string
  hostOpening: string
  hotItem: EditorialHotItem
  recommendation: EditorialRecommendation
}

const RESULT_FILENAME = 'story_studio_latest_result.json'

function resultPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, 'materials', 'zibuyu', 'ops', RESULT_FILENAME)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isProductionStatus(value: unknown): value is EditorialProductionStatus {
  return value === 'queued' || value === 'running' || value === 'succeeded' || value === 'failed'
}

function isEditorialProductionResult(value: unknown): value is EditorialProductionResult {
  if (!isRecord(value)) return false
  return (
    typeof value.updatedAt === 'string'
    && typeof value.jobId === 'string'
    && isProductionStatus(value.status)
    && typeof value.storyId === 'string'
    && typeof value.runDir === 'string'
    && typeof value.videoPath === 'string'
    && typeof value.hostOpening === 'string'
    && isRecord(value.hotItem)
    && isRecord(value.recommendation)
  )
}

export function getEditorialProductionResultPath(workspaceRoot: string): string {
  return resultPath(path.resolve(workspaceRoot))
}

export function readLatestEditorialProductionResult(workspaceRoot: string): EditorialProductionResult | null {
  const filePath = resultPath(path.resolve(workspaceRoot))
  if (!existsSync(filePath)) return null
  const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'))
  return isEditorialProductionResult(parsed) ? parsed : null
}

export function writeEditorialProductionResult(
  workspaceRoot: string,
  result: EditorialProductionResult,
): EditorialProductionResult {
  const filePath = resultPath(path.resolve(workspaceRoot))
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(result, null, 2), 'utf8')
  return result
}
