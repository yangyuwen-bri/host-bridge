import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  type WriteStream,
} from 'node:fs'
import path from 'node:path'
import { buildAndPersistStoryMaterialsDatabase, readStoryMaterialsDatabase } from '@/lib/story-materials/db'
import { validateStoryId } from '@/lib/story-materials/generate'
import {
  parseStoryGenerationModelConfig,
  type StoryGenerationModelConfig,
} from '@/lib/story-materials/model-config'
import {
  applyProxyEnv,
  formatProxyLogLine,
  readWorkspaceEnvFiles,
  resolveProxySettings,
  type RuntimeProxySettings,
} from '@/lib/story-materials/runtime-env'
import { sceneImageCandidates } from '@/lib/ffmpeg/story-video'
import { toSimplifiedChinese } from '@/lib/story-runner/chinese-script'

type StoryEditJobStatus = 'queued' | 'running' | 'succeeded' | 'failed'
type StoryVersionSource = 'generated_base' | 'voiceover_edit' | 'scene_image_edit'

interface StoryPlanScene {
  id: number
  summary: string
  voiceOver: string
}

interface StoryPlan {
  title?: string
  scenes: StoryPlanScene[]
}

export interface StoryVersionRecord {
  id: string
  storyId: string
  runDir: string
  parentVersionId: string | null
  source: StoryVersionSource
  createdAt: string
}

interface StoryVersionState {
  storyId: string
  activeVersionId: string
  versions: StoryVersionRecord[]
}

interface StoryVersionStore {
  updatedAt: string
  stories: Record<string, StoryVersionState>
}

export interface StoryEditScene {
  id: number
  summary: string
  voiceOver: string
  imagePath: string | null
}

export interface StoryEditDetail {
  storyId: string
  title: string
  activeRunDir: string
  storyPlanPath: string
  narrationPath: string | null
  videoPath: string | null
  versions: StoryVersionRecord[]
  scenes: StoryEditScene[]
}

export interface StoryVoiceoverEditJob {
  id: string
  storyId: string
  status: StoryEditJobStatus
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  sourceRunDir: string
  outputRunDir: string
  parentVersionId: string
  outputVersionId: string
  logFile: string
  command: string[]
  modelConfig: StoryGenerationModelConfig
  error: string | null
  exitCode: number | null
}

interface StoryVoiceoverEditJobStore {
  updatedAt: string
  jobs: StoryVoiceoverEditJob[]
}

interface EnqueueStoryVoiceoverEditInput {
  workspaceRoot: string
  storyId: string
  scenes: Array<{ id: number; voiceOver: string }>
  modelConfig: StoryGenerationModelConfig
}

interface QueryStoryVoiceoverEditJobsInput {
  workspaceRoot: string
  storyId?: string | null
  jobId?: string | null
  runningOnly?: boolean
  limit?: number
}

interface ResolvedRuntimeEnv {
  qwenApiKey: string
  env: NodeJS.ProcessEnv
  proxy: RuntimeProxySettings
}

const VERSION_STORE_FILENAME = 'story_materials_versions.json'
const EDIT_JOBS_FILENAME = 'story_materials_voiceover_jobs.json'
const PATCHES_DIRNAME = 'story_materials_voiceover_patches'
const STORY_DB_FILENAME = 'story_materials_db.json'
const DEFAULT_LIMIT = 100

class StoryVoiceoverEditConflictError extends Error {}

const runtimeStore = globalThis as typeof globalThis & {
  __storyMaterialsVoiceoverProcesses?: Map<string, ChildProcessWithoutNullStreams>
}

function activeProcessMap(): Map<string, ChildProcessWithoutNullStreams> {
  if (!runtimeStore.__storyMaterialsVoiceoverProcesses) {
    runtimeStore.__storyMaterialsVoiceoverProcesses = new Map<string, ChildProcessWithoutNullStreams>()
  }
  return runtimeStore.__storyMaterialsVoiceoverProcesses
}

function nowIso(): string {
  return new Date().toISOString()
}

function nowTimestamp(): string {
  const date = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function resolveRuntimeEnv(workspaceRoot: string): ResolvedRuntimeEnv {
  const { localEnv, skillEnv } = readWorkspaceEnvFiles(workspaceRoot)
  const qwenApiKey = (
    process.env.QWEN_API_KEY
    || process.env.ALIYUN_API_KEY
    || localEnv.QWEN_API_KEY
    || localEnv.ALIYUN_API_KEY
    || skillEnv.QWEN_API_KEY
    || skillEnv.ALIYUN_API_KEY
    || ''
  ).trim()
  if (!qwenApiKey) throw new Error('MISSING_QWEN_API_KEY')

  const proxy = resolveProxySettings({
    processEnv: process.env,
    localEnv,
    skillEnv,
  })

  const nextEnv = applyProxyEnv({
    ...process.env,
    QWEN_API_KEY: qwenApiKey,
    ALIYUN_API_KEY: qwenApiKey,
  }, proxy)

  return {
    qwenApiKey,
    env: nextEnv,
    proxy,
  }
}

function versionStorePath(workspaceRoot: string): string {
  return path.join(workspaceRoot, 'materials', 'zhiguai', 'ops', VERSION_STORE_FILENAME)
}

function editJobsStorePath(workspaceRoot: string): string {
  return path.join(workspaceRoot, 'materials', 'zhiguai', 'ops', EDIT_JOBS_FILENAME)
}

function patchesDirPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, 'materials', 'zhiguai', 'ops', PATCHES_DIRNAME)
}

function storyDbPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, 'materials', 'zhiguai', 'ops', STORY_DB_FILENAME)
}

function ensureParentDir(filePath: string): void {
  const parent = path.dirname(filePath)
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true })
}

function readVersionStore(workspaceRoot: string): StoryVersionStore {
  const filePath = versionStorePath(workspaceRoot)
  if (!existsSync(filePath)) {
    return {
      updatedAt: nowIso(),
      stories: {},
    }
  }
  const raw = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<StoryVersionStore>
  const stories = raw.stories && typeof raw.stories === 'object' ? raw.stories as Record<string, StoryVersionState> : {}
  return {
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : nowIso(),
    stories,
  }
}

function writeVersionStore(workspaceRoot: string, store: StoryVersionStore): void {
  const filePath = versionStorePath(workspaceRoot)
  ensureParentDir(filePath)
  const payload: StoryVersionStore = {
    updatedAt: nowIso(),
    stories: store.stories,
  }
  writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8')
}

function readEditJobStore(workspaceRoot: string): StoryVoiceoverEditJobStore {
  const filePath = editJobsStorePath(workspaceRoot)
  if (!existsSync(filePath)) {
    return {
      updatedAt: nowIso(),
      jobs: [],
    }
  }
  const rawValue = JSON.parse(readFileSync(filePath, 'utf8')) as unknown
  const raw = isRecord(rawValue) ? rawValue : {}
  const jobs = Array.isArray(raw.jobs) ? raw.jobs : []
  const parsedJobs = jobs
    .filter((item): item is StoryVoiceoverEditJob => {
      if (!isRecord(item)) return false
      return (
        typeof item.id === 'string'
        && typeof item.storyId === 'string'
        && typeof item.status === 'string'
        && typeof item.sourceRunDir === 'string'
        && typeof item.outputRunDir === 'string'
      )
    })
    .map((item) => {
      const row = item as unknown as StoryVoiceoverEditJob & { modelConfig?: unknown }
      let modelConfig = row.modelConfig
      try {
        modelConfig = parseStoryGenerationModelConfig(row.modelConfig)
      } catch {
        modelConfig = parseStoryGenerationModelConfig({})
      }
      return {
        ...row,
        modelConfig,
      }
    })
  return {
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : nowIso(),
    jobs: parsedJobs,
  }
}

function writeEditJobStore(workspaceRoot: string, store: StoryVoiceoverEditJobStore): void {
  const filePath = editJobsStorePath(workspaceRoot)
  ensureParentDir(filePath)
  const payload: StoryVoiceoverEditJobStore = {
    updatedAt: nowIso(),
    jobs: store.jobs,
  }
  writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8')
}

function updateEditJob(workspaceRoot: string, jobId: string, patch: Partial<StoryVoiceoverEditJob>): StoryVoiceoverEditJob {
  const store = readEditJobStore(workspaceRoot)
  const index = store.jobs.findIndex((item) => item.id === jobId)
  if (index < 0) throw new Error(`JOB_NOT_FOUND: ${jobId}`)
  const updated: StoryVoiceoverEditJob = {
    ...store.jobs[index],
    ...patch,
  }
  store.jobs[index] = updated
  writeEditJobStore(workspaceRoot, store)
  return updated
}

function findRunningEditJob(store: StoryVoiceoverEditJobStore, storyId: string): StoryVoiceoverEditJob | null {
  const running = store.jobs.find((item) =>
    item.storyId === storyId
    && (item.status === 'queued' || item.status === 'running'))
  return running || null
}

function findActiveVersion(state: StoryVersionState): StoryVersionRecord | null {
  const found = state.versions.find((item) => item.id === state.activeVersionId)
  return found || null
}

function resolveStoryTitle(workspaceRoot: string, storyId: string): string {
  let db = readStoryMaterialsDatabase(storyDbPath(workspaceRoot))
  if (!db) {
    db = buildAndPersistStoryMaterialsDatabase({ workspaceRoot }).database
  }
  const record = db.records.find((item) => item.id === storyId)
  return record?.title || storyId
}

function resolveLatestRunDirFromDb(workspaceRoot: string, storyId: string): string {
  let db = readStoryMaterialsDatabase(storyDbPath(workspaceRoot))
  if (!db) {
    db = buildAndPersistStoryMaterialsDatabase({ workspaceRoot }).database
  }
  const record = db.records.find((item) => item.id === storyId)
  const runDir = record?.latestAsset?.runDir || ''
  if (!runDir || !existsSync(runDir)) {
    throw new Error(`NO_GENERATED_RUN_FOR_STORY: ${storyId}`)
  }
  return runDir
}

function buildVersionId(tag: string): string {
  return `${tag}-${nowTimestamp()}-${Math.random().toString(36).slice(2, 8)}`
}

function ensureStoryVersionState(workspaceRoot: string, storyId: string): StoryVersionState {
  const store = readVersionStore(workspaceRoot)
  const normalizedStoryId = validateStoryId(storyId)
  const nextStories: Record<string, StoryVersionState> = {
    ...store.stories,
  }
  const existing = nextStories[normalizedStoryId]
  const hasActive = !!existing
    && existing.versions.some((item) => item.id === existing.activeVersionId && existsSync(item.runDir))

  if (hasActive && existing) return existing

  const latestRunDir = resolveLatestRunDirFromDb(workspaceRoot, normalizedStoryId)
  const existingMatch = existing?.versions.find((item) => path.resolve(item.runDir) === path.resolve(latestRunDir))
  const nextState: StoryVersionState = existing ? { ...existing } : {
    storyId: normalizedStoryId,
    activeVersionId: '',
    versions: [],
  }

  if (existingMatch) {
    nextState.activeVersionId = existingMatch.id
  } else {
    const baseVersion: StoryVersionRecord = {
      id: buildVersionId('base'),
      storyId: normalizedStoryId,
      runDir: latestRunDir,
      parentVersionId: null,
      source: 'generated_base',
      createdAt: nowIso(),
    }
    nextState.versions = [baseVersion, ...nextState.versions]
    nextState.activeVersionId = baseVersion.id
  }
  nextStories[normalizedStoryId] = nextState
  writeVersionStore(workspaceRoot, {
    updatedAt: nowIso(),
    stories: nextStories,
  })
  return nextState
}

function readStoryPlan(runDir: string): StoryPlan {
  const storyPlanPath = path.join(runDir, '03_story_plan.json')
  if (!existsSync(storyPlanPath)) {
    throw new Error(`STORY_PLAN_NOT_FOUND: ${storyPlanPath}`)
  }
  const parsed = JSON.parse(readFileSync(storyPlanPath, 'utf8')) as {
    title?: unknown
    scenes?: unknown
  }
  const scenesRaw = Array.isArray(parsed.scenes) ? parsed.scenes : []
  const scenes: StoryPlanScene[] = scenesRaw.map((item, index) => {
    const row = item && typeof item === 'object' ? item as Record<string, unknown> : {}
    const idRaw = row.id
    const id = typeof idRaw === 'number' && Number.isFinite(idRaw) ? Math.floor(idRaw) : index + 1
    const summary = typeof row.summary === 'string' ? row.summary.trim() : ''
    const voiceOver = typeof row.voiceOver === 'string' ? row.voiceOver.trim() : ''
    return {
      id,
      summary,
      voiceOver,
    }
  })
  if (scenes.length === 0) {
    throw new Error(`STORY_PLAN_SCENES_EMPTY: ${storyPlanPath}`)
  }
  return {
    title: typeof parsed.title === 'string' ? parsed.title : undefined,
    scenes,
  }
}

function findVideoPath(runDir: string): string | null {
  const candidates = [
    path.join(runDir, '10_final_story_hardsub.mp4'),
    path.join(runDir, '08_final_story.mp4'),
    path.join(runDir, '10_final_story_softsub.mp4'),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

export function getStoryEditDetail(workspaceRootInput: string, storyIdInput: string): StoryEditDetail {
  const workspaceRoot = path.resolve(workspaceRootInput)
  const storyId = validateStoryId(storyIdInput)
  const versionState = ensureStoryVersionState(workspaceRoot, storyId)
  const activeVersion = findActiveVersion(versionState)
  if (!activeVersion) {
    throw new Error(`ACTIVE_VERSION_NOT_FOUND: ${storyId}`)
  }
  const runDir = activeVersion.runDir
  if (!existsSync(runDir)) {
    throw new Error(`ACTIVE_RUN_DIR_NOT_FOUND: ${runDir}`)
  }

  const plan = readStoryPlan(runDir)
  const storyPlanPath = path.join(runDir, '03_story_plan.json')
  const narrationPath = path.join(runDir, '06_narration.txt')
  const title = plan.title || resolveStoryTitle(workspaceRoot, storyId)
  const scenes: StoryEditScene[] = plan.scenes.map((scene) => {
    const imagePath = sceneImageCandidates(runDir, scene.id).find((item) => existsSync(item)) || null
    return {
      id: scene.id,
      summary: scene.summary,
      voiceOver: scene.voiceOver,
      imagePath,
    }
  })

  return {
    storyId,
    title,
    activeRunDir: runDir,
    storyPlanPath,
    narrationPath: existsSync(narrationPath) ? narrationPath : null,
    videoPath: findVideoPath(runDir),
    versions: [...versionState.versions].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    scenes,
  }
}

function writeLogLine(stream: WriteStream, message: string): void {
  const lines = message.endsWith('\n') ? message : `${message}\n`
  stream.write(`[${nowIso()}] ${lines}`)
}

function safeCloseLog(stream: WriteStream): void {
  stream.end()
}

function buildEditRunDir(workspaceRoot: string, storyId: string): string {
  return path.join(
    workspaceRoot,
    'materials',
    'zibuyu',
    'runs',
    `${nowTimestamp()}-${storyId}-voiceover-edit`,
  )
}

function toEditCommandArgs(params: {
  sourceRunDir: string
  outputRunDir: string
  voiceoverPatchFile: string
  modelConfig: StoryGenerationModelConfig
}): string[] {
  return [
    'run',
    'video:regen-story-voiceover',
    '--',
    '--source-run-dir',
    params.sourceRunDir,
    '--output-dir',
    params.outputRunDir,
    '--voiceover-json',
    params.voiceoverPatchFile,
    '--tts-model',
    params.modelConfig.ttsModel,
    '--tts-voice',
    params.modelConfig.ttsVoice,
  ]
}

function registerOutputVersion(workspaceRoot: string, job: StoryVoiceoverEditJob): void {
  const store = readVersionStore(workspaceRoot)
  const state = store.stories[job.storyId]
  if (!state) {
    throw new Error(`VERSION_STATE_NOT_FOUND: ${job.storyId}`)
  }
  const nextVersion: StoryVersionRecord = {
    id: job.outputVersionId,
    storyId: job.storyId,
    runDir: job.outputRunDir,
    parentVersionId: job.parentVersionId,
    source: 'voiceover_edit',
    createdAt: nowIso(),
  }
  const deduped = state.versions.filter((item) => item.id !== nextVersion.id)
  state.versions = [nextVersion, ...deduped]
  state.activeVersionId = nextVersion.id
  store.stories[job.storyId] = state
  writeVersionStore(workspaceRoot, store)
}

function finalizeEditJob(workspaceRoot: string, jobId: string, patch: Partial<StoryVoiceoverEditJob>): void {
  const finalized = updateEditJob(workspaceRoot, jobId, patch)
  if (patch.status === 'succeeded') {
    registerOutputVersion(workspaceRoot, finalized)
  }
  if (patch.status === 'succeeded' || patch.status === 'failed') {
    try {
      buildAndPersistStoryMaterialsDatabase({ workspaceRoot })
    } catch (error) {
      updateEditJob(workspaceRoot, jobId, {
        status: 'failed',
        finishedAt: finalized.finishedAt || nowIso(),
        error: `DB_REFRESH_FAILED: ${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }
}

function spawnEditJobProcess(params: {
  workspaceRoot: string
  job: StoryVoiceoverEditJob
  commandArgs: string[]
  env: NodeJS.ProcessEnv
  proxy: RuntimeProxySettings
}): ChildProcessWithoutNullStreams {
  ensureParentDir(params.job.logFile)
  const logStream = createWriteStream(params.job.logFile, { flags: 'a' })
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const child = spawn(npmCommand, params.commandArgs, {
    cwd: params.workspaceRoot,
    env: params.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  child.stdin.end()

  writeLogLine(logStream, `START command=${npmCommand} ${params.commandArgs.join(' ')}`)
  writeLogLine(logStream, formatProxyLogLine(params.proxy))
  child.stdout.on('data', (chunk: Buffer | string) => {
    writeLogLine(logStream, String(chunk))
  })
  child.stderr.on('data', (chunk: Buffer | string) => {
    writeLogLine(logStream, String(chunk))
  })

  child.on('error', (error: Error) => {
    finalizeEditJob(params.workspaceRoot, params.job.id, {
      status: 'failed',
      finishedAt: nowIso(),
      exitCode: null,
      error: error.message,
    })
    writeLogLine(logStream, `ERROR ${error.message}`)
    safeCloseLog(logStream)
    activeProcessMap().delete(params.job.id)
  })

  child.on('close', (code: number | null) => {
    const status: StoryEditJobStatus = code === 0 ? 'succeeded' : 'failed'
    const error = code === 0 ? null : `PROCESS_EXIT_${code ?? 'null'}`
    finalizeEditJob(params.workspaceRoot, params.job.id, {
      status,
      finishedAt: nowIso(),
      exitCode: code,
      error,
    })
    writeLogLine(logStream, `EXIT code=${code}`)
    safeCloseLog(logStream)
    activeProcessMap().delete(params.job.id)
  })

  return child
}

function normalizeScenePatches(
  sourceScenes: StoryEditScene[],
  inputScenes: Array<{ id: number; voiceOver: string }>,
): Array<{ id: number; voiceOver: string }> {
  const sourceIds = new Set(sourceScenes.map((item) => item.id))
  if (inputScenes.length !== sourceScenes.length) {
    throw new Error(`INVALID_SCENE_PATCH_COUNT: expected ${sourceScenes.length}, got ${inputScenes.length}`)
  }
  const patchMap = new Map<number, string>()
  for (const scene of inputScenes) {
    const id = Number(scene.id)
    if (!Number.isFinite(id)) throw new Error(`INVALID_SCENE_ID: ${scene.id}`)
    const voiceOver = typeof scene.voiceOver === 'string' ? normalizeStoryVoiceoverText(scene.voiceOver) : ''
    if (!voiceOver) throw new Error(`EMPTY_VOICEOVER: scene ${id}`)
    if (!sourceIds.has(id)) throw new Error(`UNKNOWN_SCENE_ID: ${id}`)
    if (patchMap.has(id)) throw new Error(`DUPLICATE_SCENE_ID: ${id}`)
    patchMap.set(id, voiceOver)
  }
  return sourceScenes.map((source) => ({
    id: source.id,
    voiceOver: patchMap.get(source.id) || source.voiceOver,
  }))
}

export function normalizeStoryVoiceoverText(input: string): string {
  return toSimplifiedChinese(input.trim())
}

export function enqueueStoryVoiceoverEdit(input: EnqueueStoryVoiceoverEditInput): StoryVoiceoverEditJob {
  const workspaceRoot = path.resolve(input.workspaceRoot)
  const storyId = validateStoryId(input.storyId)
  const runtimeEnv = resolveRuntimeEnv(workspaceRoot)
  const detail = getStoryEditDetail(workspaceRoot, storyId)
  const normalizedScenes = normalizeScenePatches(detail.scenes, input.scenes)

  const store = readEditJobStore(workspaceRoot)
  const running = findRunningEditJob(store, storyId)
  if (running) {
    throw new StoryVoiceoverEditConflictError(`STORY_VOICEOVER_EDIT_ALREADY_RUNNING: ${storyId}`)
  }

  const versionState = ensureStoryVersionState(workspaceRoot, storyId)
  const parentVersion = findActiveVersion(versionState)
  if (!parentVersion) {
    throw new Error(`ACTIVE_VERSION_NOT_FOUND: ${storyId}`)
  }

  const outputRunDir = buildEditRunDir(workspaceRoot, storyId)
  const jobId = `${nowTimestamp()}-${storyId}-${Math.random().toString(36).slice(2, 8)}`
  const outputVersionId = buildVersionId('edit')
  const patchFile = path.join(patchesDirPath(workspaceRoot), `${jobId}.json`)
  ensureParentDir(patchFile)
  writeFileSync(patchFile, JSON.stringify({ scenes: normalizedScenes }, null, 2), 'utf8')

  const commandArgs = toEditCommandArgs({
    sourceRunDir: parentVersion.runDir,
    outputRunDir,
    voiceoverPatchFile: patchFile,
    modelConfig: input.modelConfig,
  })

  const job: StoryVoiceoverEditJob = {
    id: jobId,
    storyId,
    status: 'queued',
    createdAt: nowIso(),
    startedAt: nowIso(),
    finishedAt: null,
    sourceRunDir: parentVersion.runDir,
    outputRunDir,
    parentVersionId: parentVersion.id,
    outputVersionId,
    logFile: path.join(outputRunDir, '00_web_voiceover_edit.log'),
    command: [process.platform === 'win32' ? 'npm.cmd' : 'npm', ...commandArgs],
    modelConfig: input.modelConfig,
    error: null,
    exitCode: null,
  }

  const nextStore: StoryVoiceoverEditJobStore = {
    updatedAt: nowIso(),
    jobs: [job, ...store.jobs],
  }
  writeEditJobStore(workspaceRoot, nextStore)

  updateEditJob(workspaceRoot, job.id, {
    status: 'running',
    startedAt: nowIso(),
  })

  try {
    const processRef = spawnEditJobProcess({
      workspaceRoot,
      job,
      commandArgs,
      env: runtimeEnv.env,
      proxy: runtimeEnv.proxy,
    })
    activeProcessMap().set(job.id, processRef)
  } catch (error) {
    updateEditJob(workspaceRoot, job.id, {
      status: 'failed',
      finishedAt: nowIso(),
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }

  return getStoryVoiceoverEditJob(workspaceRoot, job.id) || job
}

export function queryStoryVoiceoverEditJobs(input: QueryStoryVoiceoverEditJobsInput): StoryVoiceoverEditJob[] {
  const workspaceRoot = path.resolve(input.workspaceRoot)
  const storyId = input.storyId ? validateStoryId(input.storyId) : null
  const store = readEditJobStore(workspaceRoot)
  let jobs = [...store.jobs]
  if (storyId) {
    jobs = jobs.filter((item) => item.storyId === storyId)
  }
  if (input.jobId) {
    jobs = jobs.filter((item) => item.id === input.jobId)
  }
  if (input.runningOnly) {
    jobs = jobs.filter((item) => item.status === 'queued' || item.status === 'running')
  }
  jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const limit = Number.isFinite(input.limit) ? Math.max(1, Math.min(500, input.limit || DEFAULT_LIMIT)) : DEFAULT_LIMIT
  return jobs.slice(0, limit)
}

export function getStoryVoiceoverEditJob(workspaceRoot: string, jobId: string): StoryVoiceoverEditJob | null {
  const jobs = queryStoryVoiceoverEditJobs({
    workspaceRoot,
    jobId,
    limit: 1,
  })
  return jobs[0] || null
}

export function isStoryVoiceoverEditConflictError(error: unknown): boolean {
  return error instanceof StoryVoiceoverEditConflictError
}
