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
import { buildAndPersistStoryMaterialsDatabase } from '@/lib/story-materials/db'
import {
  getStoryEditDetail,
  type StoryVersionRecord,
} from '@/lib/story-materials/edit'
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

type StoryEditJobStatus = 'queued' | 'running' | 'succeeded' | 'failed'
type StoryVersionSource = 'generated_base' | 'voiceover_edit' | 'scene_image_edit'

export interface StorySceneImageEditJob {
  id: string
  storyId: string
  sceneId: number
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

interface StorySceneImageEditJobStore {
  updatedAt: string
  jobs: StorySceneImageEditJob[]
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

interface EnqueueStorySceneImageEditInput {
  workspaceRoot: string
  storyId: string
  sceneId: number
  modelConfig: StoryGenerationModelConfig
}

interface QueryStorySceneImageEditJobsInput {
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

const JOBS_FILENAME = 'story_materials_scene_image_jobs.json'
const VERSION_STORE_FILENAME = 'story_materials_versions.json'
const DEFAULT_LIMIT = 100

class StorySceneImageEditConflictError extends Error {}

const runtimeStore = globalThis as typeof globalThis & {
  __storyMaterialsSceneImageProcesses?: Map<string, ChildProcessWithoutNullStreams>
}

function activeProcessMap(): Map<string, ChildProcessWithoutNullStreams> {
  if (!runtimeStore.__storyMaterialsSceneImageProcesses) {
    runtimeStore.__storyMaterialsSceneImageProcesses = new Map<string, ChildProcessWithoutNullStreams>()
  }
  return runtimeStore.__storyMaterialsSceneImageProcesses
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

function jobsStorePath(workspaceRoot: string): string {
  return path.join(workspaceRoot, 'materials', 'zhiguai', 'ops', JOBS_FILENAME)
}

function versionStorePath(workspaceRoot: string): string {
  return path.join(workspaceRoot, 'materials', 'zhiguai', 'ops', VERSION_STORE_FILENAME)
}

export function getStorySceneImageEditJobsStorePath(workspaceRoot: string): string {
  return jobsStorePath(path.resolve(workspaceRoot))
}

function ensureParentDir(filePath: string): void {
  const parent = path.dirname(filePath)
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true })
}

function readStore(workspaceRoot: string): StorySceneImageEditJobStore {
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
    .filter((item): item is StorySceneImageEditJob => {
      if (!isRecord(item)) return false
      return (
        typeof item.id === 'string'
        && typeof item.storyId === 'string'
        && typeof item.status === 'string'
      )
    })
    .map((item) => {
      const row = item as unknown as StorySceneImageEditJob & { modelConfig?: unknown }
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

function writeStore(workspaceRoot: string, store: StorySceneImageEditJobStore): void {
  const filePath = jobsStorePath(workspaceRoot)
  ensureParentDir(filePath)
  const payload: StorySceneImageEditJobStore = {
    updatedAt: nowIso(),
    jobs: store.jobs,
  }
  writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8')
}

function updateJob(workspaceRoot: string, jobId: string, patch: Partial<StorySceneImageEditJob>): StorySceneImageEditJob {
  const store = readStore(workspaceRoot)
  const index = store.jobs.findIndex((item) => item.id === jobId)
  if (index < 0) throw new Error(`JOB_NOT_FOUND: ${jobId}`)
  const updated: StorySceneImageEditJob = {
    ...store.jobs[index],
    ...patch,
  }
  store.jobs[index] = updated
  writeStore(workspaceRoot, store)
  return updated
}

function findRunningJobByStory(store: StorySceneImageEditJobStore, storyId: string): StorySceneImageEditJob | null {
  const running = store.jobs.find((item) =>
    item.storyId === storyId
    && (item.status === 'queued' || item.status === 'running'))
  return running || null
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

function buildRunDir(workspaceRoot: string, storyId: string, sceneId: number): string {
  return path.join(
    workspaceRoot,
    'materials',
    'zibuyu',
    'runs',
    `${nowTimestamp()}-${storyId}-scene-${String(sceneId).padStart(2, '0')}-image-edit`,
  )
}

function buildVersionId(tag: string): string {
  return `${tag}-${nowTimestamp()}-${Math.random().toString(36).slice(2, 8)}`
}

function toCommandArgs(params: {
  sourceRunDir: string
  outputRunDir: string
  sceneId: number
  modelConfig: StoryGenerationModelConfig
}): string[] {
  return [
    'run',
    'video:regen-story-scene-image',
    '--',
    '--source-run-dir',
    params.sourceRunDir,
    '--output-dir',
    params.outputRunDir,
    '--scene-id',
    String(params.sceneId),
    '--image-model',
    params.modelConfig.imageModel,
  ]
}

function writeLogLine(stream: WriteStream, message: string): void {
  const lines = message.endsWith('\n') ? message : `${message}\n`
  stream.write(`[${nowIso()}] ${lines}`)
}

function safeCloseLog(stream: WriteStream): void {
  stream.end()
}

function registerOutputVersion(workspaceRoot: string, job: StorySceneImageEditJob): void {
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
    source: 'scene_image_edit' as StoryVersionSource,
    createdAt: nowIso(),
  }
  const deduped = state.versions.filter((item) => item.id !== nextVersion.id)
  state.versions = [nextVersion, ...deduped]
  state.activeVersionId = nextVersion.id
  store.stories[job.storyId] = state
  writeVersionStore(workspaceRoot, store)
}

function finalizeJob(workspaceRoot: string, jobId: string, patch: Partial<StorySceneImageEditJob>): void {
  const finalized = updateJob(workspaceRoot, jobId, patch)
  if (patch.status === 'succeeded') {
    registerOutputVersion(workspaceRoot, finalized)
  }
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

function spawnJobProcess(params: {
  workspaceRoot: string
  job: StorySceneImageEditJob
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
    const status: StoryEditJobStatus = code === 0 ? 'succeeded' : 'failed'
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

export function enqueueStorySceneImageEdit(input: EnqueueStorySceneImageEditInput): StorySceneImageEditJob {
  const workspaceRoot = path.resolve(input.workspaceRoot)
  const storyId = validateStoryId(input.storyId)
  if (!Number.isFinite(input.sceneId) || input.sceneId <= 0) {
    throw new Error(`INVALID_SCENE_ID: ${input.sceneId}`)
  }
  const runtimeEnv = resolveRuntimeEnv(workspaceRoot)

  const detail = getStoryEditDetail(workspaceRoot, storyId)
  const sceneExists = detail.scenes.some((scene) => scene.id === input.sceneId)
  if (!sceneExists) {
    throw new Error(`SCENE_NOT_FOUND: ${input.sceneId}`)
  }
  const activeVersion = detail.versions.find((version) => path.resolve(version.runDir) === path.resolve(detail.activeRunDir))
  if (!activeVersion) {
    throw new Error(`ACTIVE_VERSION_NOT_FOUND: ${storyId}`)
  }

  const store = readStore(workspaceRoot)
  const running = findRunningJobByStory(store, storyId)
  if (running) {
    throw new StorySceneImageEditConflictError(`STORY_SCENE_IMAGE_EDIT_ALREADY_RUNNING: ${storyId}`)
  }

  const outputRunDir = buildRunDir(workspaceRoot, storyId, input.sceneId)
  const commandArgs = toCommandArgs({
    sourceRunDir: detail.activeRunDir,
    outputRunDir,
    sceneId: input.sceneId,
    modelConfig: input.modelConfig,
  })

  const job: StorySceneImageEditJob = {
    id: `${nowTimestamp()}-${storyId}-${Math.random().toString(36).slice(2, 8)}`,
    storyId,
    sceneId: input.sceneId,
    status: 'queued',
    createdAt: nowIso(),
    startedAt: nowIso(),
    finishedAt: null,
    sourceRunDir: detail.activeRunDir,
    outputRunDir,
    parentVersionId: activeVersion.id,
    outputVersionId: buildVersionId('img'),
    logFile: path.join(outputRunDir, '00_web_scene_image_edit.log'),
    command: [process.platform === 'win32' ? 'npm.cmd' : 'npm', ...commandArgs],
    modelConfig: input.modelConfig,
    error: null,
    exitCode: null,
  }

  const nextStore: StorySceneImageEditJobStore = {
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
      env: runtimeEnv.env,
      proxy: runtimeEnv.proxy,
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

  return getStorySceneImageEditJob(workspaceRoot, job.id) || job
}

export function queryStorySceneImageEditJobs(input: QueryStorySceneImageEditJobsInput): StorySceneImageEditJob[] {
  const workspaceRoot = path.resolve(input.workspaceRoot)
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

export function getStorySceneImageEditJob(workspaceRoot: string, jobId: string): StorySceneImageEditJob | null {
  const jobs = queryStorySceneImageEditJobs({
    workspaceRoot,
    jobId,
    limit: 1,
  })
  return jobs[0] || null
}

export function isStorySceneImageEditConflictError(error: unknown): boolean {
  return error instanceof StorySceneImageEditConflictError
}
