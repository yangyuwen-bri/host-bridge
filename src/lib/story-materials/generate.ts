import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, createWriteStream, type WriteStream } from 'node:fs'
import path from 'node:path'
import { buildAndPersistStoryMaterialsDatabase } from '@/lib/story-materials/db'
import { parseCsvToObjects } from '@/lib/story-materials/csv'
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

export const STORY_GENERATION_MODE = {
  CANONICAL_LONG: 'canonical_long',
} as const

export type StoryGenerationMode = (typeof STORY_GENERATION_MODE)[keyof typeof STORY_GENERATION_MODE]
export type StoryGenerationStatus = 'queued' | 'running' | 'succeeded' | 'failed'

export interface StoryGenerationJob {
  id: string
  storyId: string
  mode: StoryGenerationMode
  modelConfig: StoryGenerationModelConfig | null
  status: StoryGenerationStatus
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  runDir: string
  logFile: string
  releaseFile: string | null
  command: string[]
  error: string | null
  exitCode: number | null
  pid?: number | null
}

interface StoryGenerationStore {
  updatedAt: string
  jobs: StoryGenerationJob[]
}

interface EnqueueStoryGenerationInput {
  workspaceRoot: string
  storyId: string
  hostOpening?: string | null
  mode: StoryGenerationMode
  modelConfig: StoryGenerationModelConfig
}

interface QueryStoryGenerationInput {
  workspaceRoot: string
  storyId?: string | null
  jobId?: string | null
  runningOnly?: boolean
  limit?: number
}

interface ResolvedApiKeys {
  qwenApiKey: string
}

interface ResolvedRuntimeEnv {
  qwenApiKey: string
  env: NodeJS.ProcessEnv
  proxy: RuntimeProxySettings
}

const DEFAULT_LIMIT = 100
const STALE_RUNNING_GRACE_MS = 120_000
const STORY_ID_PATTERN = /^[a-z][a-z0-9]*-v\d{2}-\d{3}$/i
const JOBS_FILENAME = 'story_materials_generate_jobs.json'

class StoryGenerationConflictError extends Error {}

const runtimeStore = globalThis as typeof globalThis & {
  __storyMaterialsGenerateProcesses?: Map<string, ChildProcessWithoutNullStreams>
}

function activeProcessMap(): Map<string, ChildProcessWithoutNullStreams> {
  if (!runtimeStore.__storyMaterialsGenerateProcesses) {
    runtimeStore.__storyMaterialsGenerateProcesses = new Map<string, ChildProcessWithoutNullStreams>()
  }
  return runtimeStore.__storyMaterialsGenerateProcesses
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

function resolveApiKeys(workspaceRoot: string): ResolvedApiKeys {
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
  return { qwenApiKey }
}

function resolveRuntimeEnv(workspaceRoot: string): ResolvedRuntimeEnv {
  const { localEnv, skillEnv } = readWorkspaceEnvFiles(workspaceRoot)
  const keys = resolveApiKeys(workspaceRoot)
  const proxy = resolveProxySettings({
    processEnv: process.env,
    localEnv,
    skillEnv,
  })

  const nextEnv = applyProxyEnv({
    ...process.env,
    QWEN_API_KEY: keys.qwenApiKey,
    ALIYUN_API_KEY: keys.qwenApiKey,
  }, proxy)

  return {
    qwenApiKey: keys.qwenApiKey,
    env: nextEnv,
    proxy,
  }
}

function jobsStorePath(workspaceRoot: string): string {
  return path.join(workspaceRoot, 'materials', 'zhiguai', 'ops', JOBS_FILENAME)
}

export function getStoryGenerationJobsStorePath(workspaceRoot: string): string {
  return jobsStorePath(path.resolve(workspaceRoot))
}

function ensureParentDir(filePath: string): void {
  const parent = path.dirname(filePath)
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true })
}

function readStore(workspaceRoot: string): StoryGenerationStore {
  const filePath = jobsStorePath(workspaceRoot)
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
    .filter((item): item is StoryGenerationJob => {
      if (!isRecord(item)) return false
      return (
        typeof item.id === 'string'
        && typeof item.storyId === 'string'
        && typeof item.mode === 'string'
        && typeof item.status === 'string'
      )
    })
    .map((item) => {
      const row = item as unknown as StoryGenerationJob & { modelConfig?: unknown }
      let modelConfig: StoryGenerationModelConfig | null = null
      if (row.modelConfig !== null && typeof row.modelConfig !== 'undefined') {
        try {
          modelConfig = parseStoryGenerationModelConfig(row.modelConfig)
        } catch {
          modelConfig = null
        }
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

function writeStore(workspaceRoot: string, store: StoryGenerationStore): void {
  const filePath = jobsStorePath(workspaceRoot)
  ensureParentDir(filePath)
  const payload: StoryGenerationStore = {
    updatedAt: nowIso(),
    jobs: store.jobs,
  }
  writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8')
}

function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function parseExitCodeFromLog(logPath: string): number | null {
  if (!existsSync(logPath)) return null
  const text = readFileSync(logPath, 'utf8')
  const matches = [...text.matchAll(/EXIT code=([^\s]+)/g)]
  const last = matches[matches.length - 1]
  if (!last || !last[1]) return null
  const raw = last[1].trim()
  if (raw === 'null') return null
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : null
}

function hasPipelineDone(runDir: string): boolean {
  const pipelineLog = path.join(runDir, '00_pipeline.log')
  if (!existsSync(pipelineLog)) return false
  const text = readFileSync(pipelineLog, 'utf8')
  return text.includes('pipeline done:')
}

function resolveStaleTerminalPatch(job: StoryGenerationJob): Pick<StoryGenerationJob, 'status' | 'exitCode' | 'error' | 'finishedAt' | 'pid'> {
  const runDir = path.resolve(job.runDir)
  const webLogPath = path.resolve(job.logFile)

  const exitCode = parseExitCodeFromLog(webLogPath)
  if (exitCode === 0) {
    return {
      status: 'succeeded',
      exitCode: 0,
      error: null,
      finishedAt: nowIso(),
      pid: null,
    }
  }
  if (exitCode !== null) {
    return {
      status: 'failed',
      exitCode,
      error: `PROCESS_EXIT_${exitCode}`,
      finishedAt: nowIso(),
      pid: null,
    }
  }
  if (hasPipelineDone(runDir) || existsSync(path.join(runDir, '08_final_story.mp4'))) {
    return {
      status: 'succeeded',
      exitCode: 0,
      error: null,
      finishedAt: nowIso(),
      pid: null,
    }
  }
  return {
    status: 'failed',
    exitCode: null,
    error: 'STALE_PROCESS_NO_PID',
    finishedAt: nowIso(),
    pid: null,
  }
}

function reconcileStaleRunningJobs(workspaceRoot: string): void {
  const store = readStore(workspaceRoot)
  let changed = false
  const nowMs = Date.now()
  const map = activeProcessMap()
  const nextJobs = store.jobs.map((job) => {
    if (job.status !== 'queued' && job.status !== 'running') return job
    if (map.has(job.id)) return job
    if (typeof job.pid === 'number' && isPidAlive(job.pid)) return job

    const baseTime = Date.parse(job.startedAt || job.createdAt || '')
    if (Number.isFinite(baseTime) && (nowMs - baseTime) < STALE_RUNNING_GRACE_MS) {
      return job
    }

    const patch = resolveStaleTerminalPatch(job)
    changed = true
    return {
      ...job,
      ...patch,
    }
  })

  if (!changed) return
  writeStore(workspaceRoot, {
    updatedAt: nowIso(),
    jobs: nextJobs,
  })
  try {
    buildAndPersistStoryMaterialsDatabase({ workspaceRoot })
  } catch {
    // reconcile should not mask original status fix; db refresh failure can be handled by next manual refresh.
  }
}

function updateJob(workspaceRoot: string, jobId: string, patch: Partial<StoryGenerationJob>): StoryGenerationJob {
  const store = readStore(workspaceRoot)
  const index = store.jobs.findIndex((item) => item.id === jobId)
  if (index < 0) throw new Error(`JOB_NOT_FOUND: ${jobId}`)
  const updated: StoryGenerationJob = {
    ...store.jobs[index],
    ...patch,
  }
  store.jobs[index] = updated
  writeStore(workspaceRoot, store)
  return updated
}

function findRunningJobByStory(store: StoryGenerationStore, storyId: string, mode: StoryGenerationMode): StoryGenerationJob | null {
  const running = store.jobs.find((item) =>
    item.storyId === storyId
    && item.mode === mode
    && (item.status === 'queued' || item.status === 'running'))
  return running || null
}

export function resolveStorySourceFile(workspaceRoot: string, storyId: string): string {
  const catalogPath = path.join(workspaceRoot, 'materials', 'zhiguai', 'zhiguai_story_catalog_offline.csv')
  if (!existsSync(catalogPath)) {
    throw new Error(`CATALOG_NOT_FOUND: ${catalogPath}`)
  }
  const csv = readFileSync(catalogPath, 'utf8')
  const rows = parseCsvToObjects(csv)
  const row = rows.find((item) => {
    const id = typeof item.id === 'string' ? item.id.trim() : ''
    return id.toLowerCase() === storyId.toLowerCase()
  })
  if (!row) {
    throw new Error(`STORY_NOT_FOUND: ${storyId}`)
  }
  const localTextPath = typeof row.local_text_path === 'string' ? row.local_text_path.trim() : ''
  const sourceFile = localTextPath
    ? path.resolve(path.dirname(catalogPath), localTextPath)
    : path.resolve(path.dirname(catalogPath), 'stories', storyId, 'source.txt')
  if (!existsSync(sourceFile)) {
    throw new Error(`SOURCE_FILE_NOT_FOUND: ${sourceFile}`)
  }
  return sourceFile
}

export function validateStoryId(storyId: string): string {
  const normalized = storyId.trim().toLowerCase()
  if (!STORY_ID_PATTERN.test(normalized)) {
    throw new Error(`INVALID_STORY_ID: ${storyId}`)
  }
  return normalized
}

export function buildRunDir(workspaceRoot: string, storyId: string, mode: StoryGenerationMode): string {
  if (mode !== STORY_GENERATION_MODE.CANONICAL_LONG) {
    throw new Error(`UNSUPPORTED_MODE: ${mode}`)
  }
  return path.join(workspaceRoot, 'materials', 'zibuyu', 'runs', `${nowTimestamp()}-${storyId}-canonical-full`)
}

export function buildStoryGenerationCommandArgs(params: {
  storyFile: string
  runDir: string
  hostOpening?: string | null
  modelConfig: StoryGenerationModelConfig
}): string[] {
  const args = [
    'run',
    'video:run-story-full-aliyun',
    '--',
    '--story-file',
    params.storyFile,
    '--output-dir',
    params.runDir,
    '--llm-model',
    params.modelConfig.scriptModel,
    '--image-model',
    params.modelConfig.imageModel,
    '--tts-model',
    params.modelConfig.ttsModel,
    '--tts-voice',
    params.modelConfig.ttsVoice,
  ]
  if (params.hostOpening?.trim()) {
    args.push('--host-opening', params.hostOpening.trim())
  }
  return args
}

function spawnJobProcess(params: {
  workspaceRoot: string
  job: StoryGenerationJob
  commandArgs: string[]
  logFile: string
  env: NodeJS.ProcessEnv
  proxy: RuntimeProxySettings
}): ChildProcessWithoutNullStreams {
  ensureParentDir(params.logFile)
  const logStream = createWriteStream(params.logFile, { flags: 'a' })
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
    finalizeJob(params.workspaceRoot, params.job.id, {
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
    const status: StoryGenerationStatus = code === 0 ? 'succeeded' : 'failed'
    const error = code === 0 ? null : `PROCESS_EXIT_${code ?? 'null'}`
    finalizeJob(params.workspaceRoot, params.job.id, {
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

function writeLogLine(stream: WriteStream, message: string): void {
  const lines = message.endsWith('\n') ? message : `${message}\n`
  stream.write(`[${nowIso()}] ${lines}`)
}

function safeCloseLog(stream: WriteStream): void {
  stream.end()
}

function finalizeJob(workspaceRoot: string, jobId: string, patch: Partial<StoryGenerationJob>): void {
  const finalized = updateJob(workspaceRoot, jobId, patch)
  if (patch.status === 'succeeded' || patch.status === 'failed') {
    try {
      buildAndPersistStoryMaterialsDatabase({ workspaceRoot })
    } catch (error) {
      updateJob(workspaceRoot, jobId, {
        status: 'failed',
        finishedAt: finalized.finishedAt || nowIso(),
        error: `DB_REFRESH_FAILED: ${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }
}

export function enqueueStoryGeneration(input: EnqueueStoryGenerationInput): StoryGenerationJob {
  const workspaceRoot = path.resolve(input.workspaceRoot)
  const storyId = validateStoryId(input.storyId)
  const hostOpening = input.hostOpening?.trim() || ''
  if (input.hostOpening !== null && typeof input.hostOpening !== 'undefined' && !hostOpening) {
    throw new Error('HOST_OPENING_REQUIRED')
  }
  if (hostOpening.length > 200) throw new Error('HOST_OPENING_TOO_LONG')
  if (input.mode !== STORY_GENERATION_MODE.CANONICAL_LONG) {
    throw new Error(`UNSUPPORTED_MODE: ${input.mode}`)
  }
  const runtimeEnv = resolveRuntimeEnv(workspaceRoot)

  const store = readStore(workspaceRoot)
  const running = findRunningJobByStory(store, storyId, input.mode)
  if (running) {
    throw new StoryGenerationConflictError(`STORY_ALREADY_RUNNING: ${storyId}`)
  }

  const storyFile = resolveStorySourceFile(workspaceRoot, storyId)
  const runDir = buildRunDir(workspaceRoot, storyId, input.mode)
  const logFile = path.join(runDir, '00_web_generate.log')
  ensureParentDir(logFile)

  const commandArgs = buildStoryGenerationCommandArgs({
    storyFile,
    runDir,
    hostOpening,
    modelConfig: input.modelConfig,
  })

  const job: StoryGenerationJob = {
    id: `${nowTimestamp()}-${storyId}-${Math.random().toString(36).slice(2, 8)}`,
    storyId,
    mode: input.mode,
    modelConfig: input.modelConfig,
    status: 'queued',
    createdAt: nowIso(),
    startedAt: nowIso(),
    finishedAt: null,
    runDir,
    logFile,
    releaseFile: null,
    command: [process.platform === 'win32' ? 'npm.cmd' : 'npm', ...commandArgs],
    error: null,
    exitCode: null,
    pid: null,
  }

  const nextStore: StoryGenerationStore = {
    updatedAt: nowIso(),
    jobs: [job, ...store.jobs],
  }
  writeStore(workspaceRoot, nextStore)

  updateJob(workspaceRoot, job.id, {
    status: 'running',
    startedAt: nowIso(),
  })

  try {
    const processRef = spawnJobProcess({
      workspaceRoot,
      job,
      commandArgs,
      logFile,
      env: runtimeEnv.env,
      proxy: runtimeEnv.proxy,
    })
    updateJob(workspaceRoot, job.id, {
      pid: typeof processRef.pid === 'number' ? processRef.pid : null,
    })
    activeProcessMap().set(job.id, processRef)
  } catch (error) {
    updateJob(workspaceRoot, job.id, {
      status: 'failed',
      finishedAt: nowIso(),
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }

  return getStoryGenerationJob(workspaceRoot, job.id) || job
}

export function queryStoryGenerationJobs(input: QueryStoryGenerationInput): StoryGenerationJob[] {
  const workspaceRoot = path.resolve(input.workspaceRoot)
  reconcileStaleRunningJobs(workspaceRoot)
  const storyId = input.storyId ? validateStoryId(input.storyId) : null
  const store = readStore(workspaceRoot)
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

export function getStoryGenerationJob(workspaceRoot: string, jobId: string): StoryGenerationJob | null {
  const jobs = queryStoryGenerationJobs({
    workspaceRoot,
    jobId,
    limit: 1,
  })
  return jobs[0] || null
}

export function isStoryGenerationConflictError(error: unknown): boolean {
  return error instanceof StoryGenerationConflictError
}
