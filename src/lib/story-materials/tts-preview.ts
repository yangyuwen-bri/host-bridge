import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { toSimplifiedChinese } from '@/lib/story-runner/chinese-script'
import { generateQwenTtsAudio } from '@/lib/story-materials/qwen-tts'

interface GenerateStoryTtsPreviewInput {
  workspaceRoot: string
  text: string
  ttsModel: string
  ttsVoice: string
  ttsInstructions: string
}

export interface StoryTtsPreviewResult {
  filePath: string
  sourceUrl: string
  chunkCount: number
  generatedAt: string
  model: string
  voice: string
  text: string
}

const SKILL_ENV_FILE = '/Users/gsdata/.codex/skills/story-video-dialect-release/.env.local'
const LOCAL_ENV_FILE = '.env.local'
const PREVIEW_DIRNAME = 'tts_previews'
const PREVIEW_META_SUFFIX = '.meta.json'

function nowIso(): string {
  return new Date().toISOString()
}

function nowTimestamp(): string {
  const date = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function parseEnvFile(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) return {}
  const raw = readFileSync(filePath, 'utf8')
  const rows = raw.split('\n')
  const out: Record<string, string> = {}
  for (const row of rows) {
    const line = row.trim()
    if (!line || line.startsWith('#')) continue
    const idx = line.indexOf('=')
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim()
    const value = line.slice(idx + 1).trim()
    if (!key) continue
    out[key] = value
  }
  return out
}

function resolveQwenApiKey(workspaceRoot: string): string {
  const localEnv = parseEnvFile(path.join(workspaceRoot, LOCAL_ENV_FILE))
  const skillEnv = parseEnvFile(SKILL_ENV_FILE)
  const apiKey = (
    process.env.QWEN_API_KEY
    || process.env.ALIYUN_API_KEY
    || localEnv.QWEN_API_KEY
    || localEnv.ALIYUN_API_KEY
    || skillEnv.QWEN_API_KEY
    || skillEnv.ALIYUN_API_KEY
    || ''
  ).trim()
  if (!apiKey) throw new Error('MISSING_QWEN_API_KEY')
  return apiKey
}

async function qwenTts(params: {
  text: string
  apiKey: string
  model: string
  voice: string
  instructions: string
}): Promise<{ wav: Buffer; sourceUrl: string; chunkCount: number }> {
  return generateQwenTtsAudio({
    text: params.text,
    apiKey: params.apiKey,
    model: params.model,
    voice: params.voice,
    instructions: params.instructions,
    requestTimeoutMs: 60_000,
  })
}

function sanitizeForFilename(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-')
  const compacted = normalized.replace(/-+/g, '-').replace(/^-|-$/g, '')
  return compacted || 'preview'
}

export function buildStoryTtsPreviewFileName(params: { model: string; voice: string }): string {
  const modelSlug = sanitizeForFilename(params.model).slice(0, 32)
  const voiceSlug = sanitizeForFilename(params.voice).slice(0, 48)
  return `${nowTimestamp()}_${modelSlug}_${voiceSlug}.wav`
}

export function normalizeStoryTtsPreviewText(text: string): string {
  return toSimplifiedChinese(text.trim())
}

export async function generateStoryTtsPreview(input: GenerateStoryTtsPreviewInput): Promise<StoryTtsPreviewResult> {
  const workspaceRoot = path.resolve(input.workspaceRoot)
  const text = normalizeStoryTtsPreviewText(input.text)
  if (!text) throw new Error('EMPTY_PREVIEW_TEXT')
  if (!input.ttsModel.trim()) throw new Error('EMPTY_TTS_MODEL')
  if (!input.ttsVoice.trim()) throw new Error('EMPTY_TTS_VOICE')

  const previewDir = path.join(workspaceRoot, 'materials', 'zhiguai', 'ops', PREVIEW_DIRNAME)
  if (!existsSync(previewDir)) mkdirSync(previewDir, { recursive: true })
  const fileName = buildStoryTtsPreviewFileName({ model: input.ttsModel, voice: input.ttsVoice })
  const filePath = path.join(previewDir, fileName)
  const apiKey = resolveQwenApiKey(workspaceRoot)

  const tts = await qwenTts({
    text,
    apiKey,
    model: input.ttsModel,
    voice: input.ttsVoice,
    instructions: input.ttsInstructions,
  })
  writeFileSync(filePath, tts.wav)

  const result: StoryTtsPreviewResult = {
    filePath,
    sourceUrl: tts.sourceUrl,
    chunkCount: tts.chunkCount,
    generatedAt: nowIso(),
    model: input.ttsModel,
    voice: input.ttsVoice,
    text,
  }
  writeFileSync(`${filePath}${PREVIEW_META_SUFFIX}`, JSON.stringify(result, null, 2), 'utf8')
  return result
}
