import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseCsvToObjects } from './csv'
import type {
  StoryCatalogRecord,
  StoryGeneratedAsset,
  StoryGeneratedEvidenceKind,
  StoryGeneratedSourceKind,
  StoryMaterialRecord,
  StoryMaterialsDatabase,
  StoryMaterialsSummary,
  StoryRecordDataQuality,
} from './types'

interface ReleaseRunPayload {
  run_dir?: unknown
  video?: unknown
  hard_sub_video?: unknown
  soft_sub_video?: unknown
  subtitle?: unknown
  cover?: unknown
  tag?: unknown
}

interface ReleasePayload {
  generated_at?: unknown
  story_source?: unknown
  story_selector?: unknown
  runs?: unknown
}

interface RunSummaryPayload {
  storySource?: unknown
  story_source?: unknown
  output?: unknown
  generatedAt?: unknown
  generated_at?: unknown
}

interface StoryIdEvidence {
  storyId: string
  evidenceKind: StoryGeneratedEvidenceKind
  sourceKind: StoryGeneratedSourceKind
}

interface GeneratedStoryAccumulator {
  storyId: string
  assets: StoryGeneratedAsset[]
  hasReleaseManifest: boolean
  hasRunSummary: boolean
  hasRunDirScan: boolean
  evidence: Set<StoryGeneratedEvidenceKind>
}

interface StoryMaterialsBuildOptions {
  workspaceRoot: string
  catalogPath?: string
  runsDir?: string
  dbPath?: string
}

interface StoryMaterialsBuildResult {
  database: StoryMaterialsDatabase
  persistedTo: string
}

interface RunDirArtifacts {
  mainVideo: string | null
  hardSubVideo: string | null
  softSubVideo: string | null
  subtitle: string | null
  cover: string | null
  videoCandidates: string[]
}

interface BuildGeneratedMapResult {
  map: Map<string, GeneratedStoryAccumulator>
  parseErrors: Array<{ file: string; error: string }>
}

const STORY_ID_REGEX = /([a-z][a-z0-9]*-v\d{2}-\d{3})/i
const RUN_DIR_TIMESTAMP_REGEX = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const next = value.trim()
  return next.length > 0 ? next : null
}

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function nowIso(): string {
  return new Date().toISOString()
}

function defaultCatalogPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, 'materials', 'zhiguai', 'zhiguai_story_catalog_offline.csv')
}

function defaultRunsDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, 'materials', 'zibuyu', 'runs')
}

function defaultDbPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, 'materials', 'zhiguai', 'ops', 'story_materials_db.json')
}

function extractStoryId(raw: string | null): string | null {
  if (!raw) return null
  const match = raw.match(STORY_ID_REGEX)
  return match ? match[1].toLowerCase() : null
}

function extractStoryIdFromFilePath(filePath: string | null): string | null {
  if (!filePath) return null
  const fromBasename = extractStoryId(path.basename(filePath))
  if (fromBasename) return fromBasename
  return extractStoryId(filePath)
}

function parseGeneratedAtFromRunDirName(runDirName: string): string | null {
  const match = runDirName.match(RUN_DIR_TIMESTAMP_REGEX)
  if (!match) return null
  const [, year, month, day, hour, minute, second] = match
  return `${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`
}

function toAbsoluteMaybe(value: string | null, baseDir: string): string | null {
  if (!value) return null
  return path.isAbsolute(value) ? value : path.resolve(baseDir, value)
}

function listReleaseFiles(runsDir: string): string[] {
  if (!existsSync(runsDir)) return []
  return readdirSync(runsDir)
    .filter((name) => name.endsWith('-release-package.json'))
    .map((name) => path.join(runsDir, name))
    .sort((a, b) => a.localeCompare(b))
}

function listRunDirs(runsDir: string): string[] {
  if (!existsSync(runsDir)) return []
  return readdirSync(runsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(runsDir, entry.name))
    .sort((a, b) => a.localeCompare(b))
}

function listRunSummaryFiles(runDirs: string[]): string[] {
  const files: string[] = []
  for (const runDir of runDirs) {
    const summary = path.join(runDir, '00_run_summary.json')
    if (existsSync(summary)) files.push(summary)
  }
  return files.sort((a, b) => a.localeCompare(b))
}

function pickFirstExisting(runDir: string, regex: RegExp): string | null {
  if (!runDir || !existsSync(runDir)) return null
  const matched = readdirSync(runDir).filter((name) => regex.test(name)).sort((a, b) => a.localeCompare(b))
  if (matched.length === 0) return null
  return path.join(runDir, matched[0])
}

function safeFileSize(filePath: string | null): number {
  if (!filePath || !existsSync(filePath)) return 0
  try {
    return statSync(filePath).size
  } catch {
    return 0
  }
}

function selectUsableDerivedVideoArtifact(baseVideoPath: string | null, candidatePath: string | null): string | null {
  if (!candidatePath || !existsSync(candidatePath)) return null
  const candidateSize = safeFileSize(candidatePath)
  if (candidateSize <= 0) return null

  const baseSize = safeFileSize(baseVideoPath)
  if (baseSize <= 0) return candidatePath

  const minimumExpectedSize = Math.max(256 * 1024, Math.floor(baseSize * 0.15))
  if (candidateSize < minimumExpectedSize) return null
  return candidatePath
}

function scanRunDirArtifacts(runDir: string): RunDirArtifacts {
  if (!runDir || !existsSync(runDir)) {
    return {
      mainVideo: null,
      hardSubVideo: null,
      softSubVideo: null,
      subtitle: null,
      cover: null,
      videoCandidates: [],
    }
  }

  const files = readdirSync(runDir).sort((a, b) => a.localeCompare(b))
  const videoCandidates = files
    .filter((name) => /^08_final_story.*\.mp4$/.test(name))
    .map((name) => path.join(runDir, name))

  const exactCanonical = path.join(runDir, '08_final_story.mp4')
  const mainVideo = existsSync(exactCanonical) ? exactCanonical : (videoCandidates[0] || null)
  const hardSubVideo = selectUsableDerivedVideoArtifact(
    mainVideo,
    pickFirstExisting(runDir, /^10_final_story.*_hardsub\.mp4$/),
  )
  const softSubVideo = selectUsableDerivedVideoArtifact(
    mainVideo,
    pickFirstExisting(runDir, /^10_final_story.*_softsub\.mp4$/),
  )

  return {
    mainVideo,
    hardSubVideo,
    softSubVideo,
    subtitle: pickFirstExisting(runDir, /^09_subtitles.*\.srt$/),
    cover: pickFirstExisting(runDir, /^11_cover.*\.png$/),
    videoCandidates,
  }
}

function generatedAssetCompletenessScore(asset: StoryGeneratedAsset): number {
  let score = 0
  if (asset.videoPath) score += 2
  if (asset.hardSubVideoPath) score += 4
  if (asset.softSubVideoPath) score += 3
  if (asset.subtitlePath) score += 2
  if (asset.coverPath) score += 1
  if (asset.sourceKind === 'release_manifest' || asset.sourceKind === 'release_manifest_legacy') score += 2
  if (asset.sourceKind === 'run_summary') score += 1
  return score
}

function evidencePriority(kind: StoryGeneratedEvidenceKind): number {
  switch (kind) {
    case 'release_selector':
      return 1
    case 'release_story_source':
      return 2
    case 'release_filename':
      return 3
    case 'release_run_dir':
      return 4
    case 'run_summary_story_source':
      return 5
    case 'run_dir_name':
      return 6
    default:
      return 99
  }
}

function chooseBestStoryId(candidates: StoryIdEvidence[]): StoryIdEvidence | null {
  if (candidates.length === 0) return null
  const sorted = [...candidates].sort((a, b) => evidencePriority(a.evidenceKind) - evidencePriority(b.evidenceKind))
  return sorted[0] || null
}

function selectCanonicalRun(runs: ReleaseRunPayload[]): ReleaseRunPayload | null {
  if (runs.length === 0) return null
  const canonical = runs.find((run) => asString(run.tag) === 'canonical')
  return canonical || runs[0]
}

function getOrCreateAccumulator(map: Map<string, GeneratedStoryAccumulator>, storyId: string): GeneratedStoryAccumulator {
  const existing = map.get(storyId)
  if (existing) return existing
  const created: GeneratedStoryAccumulator = {
    storyId,
    assets: [],
    hasReleaseManifest: false,
    hasRunSummary: false,
    hasRunDirScan: false,
    evidence: new Set<StoryGeneratedEvidenceKind>(),
  }
  map.set(storyId, created)
  return created
}

function addEvidence(
  map: Map<string, GeneratedStoryAccumulator>,
  storyId: string,
  evidenceKind: StoryGeneratedEvidenceKind,
  marker: 'release' | 'summary' | 'run_dir',
): void {
  const acc = getOrCreateAccumulator(map, storyId)
  acc.evidence.add(evidenceKind)
  if (marker === 'release') acc.hasReleaseManifest = true
  if (marker === 'summary') acc.hasRunSummary = true
  if (marker === 'run_dir') acc.hasRunDirScan = true
}

function addAsset(map: Map<string, GeneratedStoryAccumulator>, storyId: string, asset: StoryGeneratedAsset): void {
  const acc = getOrCreateAccumulator(map, storyId)
  const signature = [
    asset.runDir,
    asset.videoPath || '',
    asset.hardSubVideoPath || '',
    asset.softSubVideoPath || '',
    asset.subtitlePath || '',
    asset.coverPath || '',
  ].join('|')
  const hasDuplicate = acc.assets.some((item) => {
    const next = [
      item.runDir,
      item.videoPath || '',
      item.hardSubVideoPath || '',
      item.softSubVideoPath || '',
      item.subtitlePath || '',
      item.coverPath || '',
    ].join('|')
    return next === signature
  })
  if (!hasDuplicate) acc.assets.push(asset)
}

function parseCatalog(catalogPath: string): StoryCatalogRecord[] {
  const content = readFileSync(catalogPath, 'utf8')
  const rows = parseCsvToObjects(content)
  const catalogDir = path.dirname(catalogPath)
  return rows
    .map((row) => {
      const id = asString(row.id) || ''
      const title = asString(row.title) || id
      const localTextPath = asString(row.local_text_path) || ''
      const sourceFilePath = localTextPath
        ? path.resolve(catalogDir, localTextPath)
        : path.resolve(catalogDir, 'stories', id, 'source.txt')
      const aliases = [title, asString(row.story_anchor), asString(row.source_page_title)]
        .filter((item): item is string => !!item && item.length > 0)
        .filter((item, index, arr) => arr.indexOf(item) === index)
      const record: StoryCatalogRecord = {
        id,
        title,
        titleAliases: aliases,
        volume: asString(row.volume) || '未分类',
        priority: asString(row.priority) || '未分级',
        hookType: asString(row.hook_type) || '',
        textCharCount: asNumber(row.text_char_count),
        localTextPath,
        sourceFilePath,
        sourceCatalogPath: catalogPath,
      }
      return record
    })
    .filter((row) => row.id.length > 0)
}

function parseStoryIdFromReleasePayload(releaseFile: string, payload: ReleasePayload): StoryIdEvidence | null {
  const candidates: StoryIdEvidence[] = []
  const selector = asRecord(payload.story_selector)
  const selectorId = extractStoryId(asString(selector?.story_id))
  if (selectorId) {
    candidates.push({
      storyId: selectorId,
      evidenceKind: 'release_selector',
      sourceKind: 'release_manifest',
    })
  }

  const storySourceId = extractStoryIdFromFilePath(asString(payload.story_source))
  if (storySourceId) {
    candidates.push({
      storyId: storySourceId,
      evidenceKind: 'release_story_source',
      sourceKind: 'release_manifest_legacy',
    })
  }

  const filenameId = extractStoryIdFromFilePath(path.basename(releaseFile))
  if (filenameId) {
    candidates.push({
      storyId: filenameId,
      evidenceKind: 'release_filename',
      sourceKind: 'release_manifest_legacy',
    })
  }

  const rawRuns = Array.isArray(payload.runs) ? payload.runs : []
  const normalizedRuns = rawRuns
    .filter((item) => !!item && typeof item === 'object' && !Array.isArray(item))
    .map((item) => item as ReleaseRunPayload)
  for (const run of normalizedRuns) {
    const runDirId = extractStoryIdFromFilePath(asString(run.run_dir))
    if (!runDirId) continue
    candidates.push({
      storyId: runDirId,
      evidenceKind: 'release_run_dir',
      sourceKind: 'release_manifest_legacy',
    })
  }

  return chooseBestStoryId(candidates)
}

function parseReleaseFilesIntoMap(map: Map<string, GeneratedStoryAccumulator>, releaseFiles: string[]): Array<{ file: string; error: string }> {
  const parseErrors: Array<{ file: string; error: string }> = []

  for (const releaseFile of releaseFiles) {
    try {
      const payload = JSON.parse(readFileSync(releaseFile, 'utf8')) as ReleasePayload
      const storyIdEvidence = parseStoryIdFromReleasePayload(releaseFile, payload)
      if (!storyIdEvidence) continue

      addEvidence(map, storyIdEvidence.storyId, storyIdEvidence.evidenceKind, 'release')

      const generatedAt = asString(payload.generated_at)
      const rawRuns = Array.isArray(payload.runs) ? payload.runs : []
      const runs = rawRuns
        .filter((item) => !!item && typeof item === 'object' && !Array.isArray(item))
        .map((item) => item as ReleaseRunPayload)
      const picked = selectCanonicalRun(runs)
      if (!picked) continue

      const releaseDir = path.dirname(releaseFile)
      const runDir = toAbsoluteMaybe(asString(picked.run_dir), releaseDir) || ''
      const inferred = scanRunDirArtifacts(runDir)
      const videoPath = toAbsoluteMaybe(asString(picked.video), releaseDir) || inferred.mainVideo
      const hardSubVideoPath = toAbsoluteMaybe(asString(picked.hard_sub_video), releaseDir) || inferred.hardSubVideo
      const softSubVideoPath = toAbsoluteMaybe(asString(picked.soft_sub_video), releaseDir) || inferred.softSubVideo
      const subtitlePath = toAbsoluteMaybe(asString(picked.subtitle), releaseDir) || inferred.subtitle
      const coverPath = toAbsoluteMaybe(asString(picked.cover), releaseDir) || inferred.cover

      if (!runDir && !videoPath && !hardSubVideoPath && !softSubVideoPath && !subtitlePath && !coverPath) continue

      addAsset(map, storyIdEvidence.storyId, {
        releaseFile,
        generatedAt,
        runDir,
        videoPath,
        hardSubVideoPath,
        softSubVideoPath,
        subtitlePath,
        coverPath,
        sourceKind: storyIdEvidence.sourceKind,
        evidenceKind: storyIdEvidence.evidenceKind,
      })
    } catch (error) {
      parseErrors.push({
        file: releaseFile,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return parseErrors
}

function parseRunSummaryFilesIntoMap(
  map: Map<string, GeneratedStoryAccumulator>,
  summaryFiles: string[],
): Array<{ file: string; error: string }> {
  const parseErrors: Array<{ file: string; error: string }> = []

  for (const summaryFile of summaryFiles) {
    try {
      const payload = JSON.parse(readFileSync(summaryFile, 'utf8')) as RunSummaryPayload
      const output = asRecord(payload.output)
      const summaryDir = path.dirname(summaryFile)
      const runDir = toAbsoluteMaybe(asString(output?.runDir) || asString(output?.run_dir), summaryDir) || summaryDir
      const storySource = asString(payload.storySource) || asString(payload.story_source)
      const sourceStoryId = extractStoryIdFromFilePath(storySource)
      const runDirStoryId = extractStoryId(path.basename(runDir))
      const storyId = sourceStoryId || runDirStoryId
      if (!storyId) continue

      const evidenceKind: StoryGeneratedEvidenceKind = sourceStoryId ? 'run_summary_story_source' : 'run_dir_name'
      addEvidence(map, storyId, evidenceKind, 'summary')

      const generatedAt = asString(payload.generatedAt) || asString(payload.generated_at) || parseGeneratedAtFromRunDirName(path.basename(runDir))
      const inferred = scanRunDirArtifacts(runDir)
      const videoPath = toAbsoluteMaybe(asString(output?.video), summaryDir) || inferred.mainVideo
      const hardSubVideoPath = toAbsoluteMaybe(asString(output?.hard_sub_video), summaryDir) || inferred.hardSubVideo
      const softSubVideoPath = toAbsoluteMaybe(asString(output?.soft_sub_video), summaryDir) || inferred.softSubVideo
      const subtitlePath = toAbsoluteMaybe(asString(output?.subtitle), summaryDir) || inferred.subtitle
      const coverPath = toAbsoluteMaybe(asString(output?.cover), summaryDir) || inferred.cover

      if (!runDir && !videoPath && !hardSubVideoPath && !softSubVideoPath && !subtitlePath && !coverPath) continue

      addAsset(map, storyId, {
        releaseFile: summaryFile,
        generatedAt,
        runDir,
        videoPath,
        hardSubVideoPath,
        softSubVideoPath,
        subtitlePath,
        coverPath,
        sourceKind: 'run_summary',
        evidenceKind,
      })
    } catch (error) {
      parseErrors.push({
        file: summaryFile,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return parseErrors
}

function parseRunDirScanIntoMap(map: Map<string, GeneratedStoryAccumulator>, runDirs: string[]): void {
  for (const runDir of runDirs) {
    const storyId = extractStoryId(path.basename(runDir))
    if (!storyId) continue

    addEvidence(map, storyId, 'run_dir_name', 'run_dir')
    const inferred = scanRunDirArtifacts(runDir)
    if (!inferred.mainVideo) continue

    addAsset(map, storyId, {
      releaseFile: runDir,
      generatedAt: parseGeneratedAtFromRunDirName(path.basename(runDir)),
      runDir,
      videoPath: inferred.mainVideo,
      hardSubVideoPath: inferred.hardSubVideo,
      softSubVideoPath: inferred.softSubVideo,
      subtitlePath: inferred.subtitle,
      coverPath: inferred.cover,
      sourceKind: 'run_dir_scan',
      evidenceKind: 'run_dir_name',
    })
  }
}

function sortByGeneratedAtDesc(assets: StoryGeneratedAsset[]): StoryGeneratedAsset[] {
  return [...assets].sort((a, b) => {
    const completenessDelta = generatedAssetCompletenessScore(b) - generatedAssetCompletenessScore(a)
    if (completenessDelta !== 0) return completenessDelta
    const ta = a.generatedAt ? Date.parse(a.generatedAt) : 0
    const tb = b.generatedAt ? Date.parse(b.generatedAt) : 0
    if (ta !== tb) return tb - ta
    if (a.runDir !== b.runDir) return b.runDir.localeCompare(a.runDir)
    return b.releaseFile.localeCompare(a.releaseFile)
  })
}

function buildGeneratedMap(runsDir: string): BuildGeneratedMapResult {
  const map = new Map<string, GeneratedStoryAccumulator>()
  const parseErrors: Array<{ file: string; error: string }> = []

  const runDirs = listRunDirs(runsDir)
  const releaseFiles = listReleaseFiles(runsDir)
  const summaryFiles = listRunSummaryFiles(runDirs)

  parseErrors.push(...parseReleaseFilesIntoMap(map, releaseFiles))
  parseErrors.push(...parseRunSummaryFilesIntoMap(map, summaryFiles))
  parseRunDirScanIntoMap(map, runDirs)

  return { map, parseErrors }
}

function buildSummary(records: StoryMaterialRecord[]): StoryMaterialsSummary {
  const byPriority: Record<string, number> = {}
  const byVolume: Record<string, number> = {}
  let generatedStories = 0

  for (const record of records) {
    if (record.isGenerated) generatedStories += 1
    byPriority[record.priority] = (byPriority[record.priority] || 0) + 1
    byVolume[record.volume] = (byVolume[record.volume] || 0) + 1
  }
  return {
    totalStories: records.length,
    generatedStories,
    pendingStories: records.length - generatedStories,
    byPriority,
    byVolume,
  }
}

function evaluateDataQuality(acc: GeneratedStoryAccumulator | undefined, isGenerated: boolean): StoryRecordDataQuality {
  if (!acc) return 'pending'
  if (acc.hasReleaseManifest && !acc.hasRunSummary && !isGenerated) return 'manifest-only'
  if (!acc.hasReleaseManifest && acc.hasRunSummary) return 'legacy-run'
  if (!acc.hasReleaseManifest && !acc.hasRunSummary && acc.hasRunDirScan) return 'orphan-run'
  if (!isGenerated) return 'pending'
  if (acc.hasReleaseManifest && !acc.hasRunSummary) return 'manifest-only'
  if (acc.hasReleaseManifest && acc.hasRunSummary) return 'clean'
  if (!acc.hasReleaseManifest && acc.hasRunSummary) return 'legacy-run'
  if (!acc.hasReleaseManifest && acc.hasRunDirScan) return 'orphan-run'
  return 'pending'
}

function uniqueOrdered(values: Array<string | null>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of values) {
    if (!item) continue
    if (seen.has(item)) continue
    seen.add(item)
    out.push(item)
  }
  return out
}

export function buildStoryMaterialsDatabaseFromData(params: {
  workspaceRoot: string
  catalogPath: string
  runsDir: string
  dbPath: string
  catalogRecords: StoryCatalogRecord[]
  generatedMap: Map<string, GeneratedStoryAccumulator>
  parseErrors: Array<{ file: string; error: string }>
}): StoryMaterialsDatabase {
  const records: StoryMaterialRecord[] = params.catalogRecords.map((catalogRecord) => {
    const generated = params.generatedMap.get(catalogRecord.id)
    const sortedAssets = generated ? sortByGeneratedAtDesc(generated.assets) : []
    const sortedGeneratedAssets = sortedAssets.filter((asset) => !!asset.videoPath)
    const latestAsset = sortedGeneratedAssets[0] || sortedAssets[0] || null
    const videoCandidates = uniqueOrdered(sortedAssets.map((asset) => asset.videoPath))
    const generatedEvidence = generated
      ? [...generated.evidence].sort((a, b) => evidencePriority(a) - evidencePriority(b))
      : []
    const isGenerated = sortedGeneratedAssets.length > 0

    return {
      ...catalogRecord,
      isGenerated,
      generatedCount: sortedGeneratedAssets.length,
      latestGeneratedAt: latestAsset?.generatedAt || null,
      latestAsset,
      hasReleaseManifest: generated?.hasReleaseManifest || false,
      hasRunSummary: generated?.hasRunSummary || false,
      generatedEvidence,
      videoCandidates,
      dataQuality: evaluateDataQuality(generated, isGenerated),
    }
  })

  records.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority.localeCompare(b.priority)
    if (a.volume !== b.volume) return a.volume.localeCompare(b.volume)
    return a.id.localeCompare(b.id)
  })

  return {
    generatedAt: nowIso(),
    workspaceRoot: params.workspaceRoot,
    catalogPath: params.catalogPath,
    runsDir: params.runsDir,
    dbPath: params.dbPath,
    summary: buildSummary(records),
    records,
    parseErrors: params.parseErrors,
  }
}

export function buildAndPersistStoryMaterialsDatabase(options: StoryMaterialsBuildOptions): StoryMaterialsBuildResult {
  const workspaceRoot = path.resolve(options.workspaceRoot)
  const catalogPath = path.resolve(options.catalogPath || defaultCatalogPath(workspaceRoot))
  const runsDir = path.resolve(options.runsDir || defaultRunsDir(workspaceRoot))
  const dbPath = path.resolve(options.dbPath || defaultDbPath(workspaceRoot))

  const catalogRecords = parseCatalog(catalogPath)
  const { map, parseErrors } = buildGeneratedMap(runsDir)
  const database = buildStoryMaterialsDatabaseFromData({
    workspaceRoot,
    catalogPath,
    runsDir,
    dbPath,
    catalogRecords,
    generatedMap: map,
    parseErrors,
  })

  const dbDir = path.dirname(dbPath)
  if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true })
  writeFileSync(dbPath, JSON.stringify(database, null, 2), 'utf8')
  return { database, persistedTo: dbPath }
}

export function readStoryMaterialsDatabase(dbPath: string): StoryMaterialsDatabase | null {
  const abs = path.resolve(dbPath)
  if (!existsSync(abs)) return null
  const content = readFileSync(abs, 'utf8')
  return JSON.parse(content) as StoryMaterialsDatabase
}
