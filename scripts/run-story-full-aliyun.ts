import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { extractFirstJsonObject, toFileSlug } from '../src/lib/story-runner/utils'
import { resolveFfmpegPath } from '../src/lib/ffmpeg/resolve-ffmpeg'
import { resolveStoryVideoArtifacts } from '../src/lib/story-materials/video-assets'
import { buildNarrationText } from '../src/lib/story-materials/narration'
import {
  buildStoryReleaseManifest,
  writeStoryReleaseManifest,
  type StoryReleaseStorageProvider,
} from '../src/lib/story-materials/release-manifest'
import { findVoicePresetByFile, parseVoicePresetCsv, type VoicePreset } from '../src/lib/story-runner/voice-preset'
import {
  createCharacterImagePrompt,
  createSceneImagePrompt,
  type StoryBlueprint,
} from '../src/lib/story-runner/story-image-prompts'
import {
  buildAliyunBlueprintPrompt,
  estimateAliyunBlueprintPlan,
  normalizeAliyunBlueprint,
} from '../src/lib/story-runner/aliyun-story-blueprint'

type CliArgs = {
  storyFile: string | null
  storyId: string | null
  hostOpening: string
  outputDir: string
  aliyunApiKey: string
  voiceFile: string
  voiceManifestCsv: string
  llmModel: string
  imageModel: string
  ttsModel: string
  ttsVoice: string
  sceneCountOverride: number | null
}

type AliyunTextJsonResponse = {
  text: string
  modelVersion: string
}

type VoicePresetState = {
  fromVoiceFile: string
  preset: VoicePreset
  targetModel: string
  createdVoiceId: string
}

function readArg(flag: string): string | null {
  const idx = process.argv.indexOf(flag)
  if (idx === -1) return null
  return process.argv[idx + 1] || null
}

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function nowTimestamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

function parseArgs(): CliArgs {
  const storyFile = readArg('--story-file')
  const storyId = readArg('--story-id')
  if (!storyFile && !storyId) {
    throw new Error('Need one of: --story-file <path> or --story-id <id>')
  }

  const aliyunApiKey = readArg('--aliyun-key') || process.env.ALIYUN_API_KEY || ''
  if (!aliyunApiKey) throw new Error('Missing Aliyun API key (--aliyun-key or ALIYUN_API_KEY)')

  const defaultSlug = toFileSlug(storyId || path.basename(storyFile || 'story'))
  const hostOpening = readArg('--host-opening') || ''
  const outputDir = readArg('--output-dir')
    || path.resolve('materials/zibuyu/runs', `${nowTimestamp()}-${defaultSlug}-aliyun-full`)

  const voiceFile = path.resolve(
    readArg('--voice-file') || 'materials/hgt_rules/aliyun_tts_audition_20260301/custom_01_voiceA1.wav',
  )
  const voiceManifestCsv = path.resolve(
    readArg('--voice-manifest-csv') || 'materials/hgt_rules/aliyun_tts_audition_20260301/manifest_custom_voice_design.csv',
  )

  const llmModel = readArg('--llm-model') || 'deepseek-v4-flash'
  const imageModel = readArg('--image-model') || 'qwen-image-2.0'
  const ttsModel = readArg('--tts-model') || 'qwen3-tts-vd-2026-01-26'
  const ttsVoice = readArg('--tts-voice') || ''
  if (readArg('--target-minutes') !== null) {
    throw new Error('TARGET_MINUTES_UNSUPPORTED: story length is adaptive and must be determined by narrative completeness')
  }
  const sceneCountRaw = readArg('--scene-count')
  const sceneCountArg = sceneCountRaw === null ? NaN : Number.parseInt(sceneCountRaw, 10)
  const sceneCountOverride = Number.isFinite(sceneCountArg) ? Math.max(4, Math.min(36, sceneCountArg)) : null

  return {
    storyFile,
    storyId,
    hostOpening,
    outputDir,
    aliyunApiKey,
    voiceFile,
    voiceManifestCsv,
    llmModel,
    imageModel,
    ttsModel,
    ttsVoice,
    sceneCountOverride,
  }
}

function resolveStoryInput(args: CliArgs): { sourceText: string; sourceLabel: string } {
  if (args.storyFile) {
    const full = path.resolve(args.storyFile)
    if (!existsSync(full)) throw new Error(`Story file not found: ${full}`)
    return { sourceText: readFileSync(full, 'utf8'), sourceLabel: full }
  }

  const id = args.storyId as string
  const candidate = path.resolve('materials/zibuyu/library', `${id}.txt`)
  if (!existsSync(candidate)) throw new Error(`Story id file not found: ${candidate}`)
  return { sourceText: readFileSync(candidate, 'utf8'), sourceLabel: candidate }
}

function resolveStoryId(args: CliArgs, sourcePath: string): string {
  if (args.storyId) return args.storyId
  const match = sourcePath.match(/zby-v\d{2}-\d{3}/iu)
  return match?.[0] || toFileSlug(path.basename(sourcePath))
}

function resolveReleaseStorageProvider(): StoryReleaseStorageProvider | undefined {
  const raw = process.env.STORY_RELEASE_STORAGE_PROVIDER?.trim()
  if (!raw) return undefined
  const supported: StoryReleaseStorageProvider[] = ['local', 'google-drive', 'cos', 'oss', 'r2']
  if (!supported.includes(raw as StoryReleaseStorageProvider)) {
    throw new Error(`STORY_RELEASE_STORAGE_PROVIDER_INVALID: ${raw}`)
  }
  return raw as StoryReleaseStorageProvider
}

function readJsonObject(filePath: string): Record<string, unknown> {
  const raw = readFileSync(filePath, 'utf8')
  const parsed = JSON.parse(raw)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Invalid JSON object: ${filePath}`)
  }
  return parsed as Record<string, unknown>
}

function readVoicePresetState(filePath: string): VoicePresetState | null {
  if (!existsSync(filePath)) return null
  const raw = readJsonObject(filePath)
  const createdVoiceId = typeof raw.createdVoiceId === 'string' ? raw.createdVoiceId : ''
  const targetModel = typeof raw.targetModel === 'string' ? raw.targetModel : ''
  const fromVoiceFile = typeof raw.fromVoiceFile === 'string' ? raw.fromVoiceFile : ''

  if (!createdVoiceId || !targetModel || !fromVoiceFile) {
    throw new Error(`Invalid voice preset state: ${filePath}`)
  }

  const presetRaw = raw.preset
  if (!presetRaw || typeof presetRaw !== 'object' || Array.isArray(presetRaw)) {
    throw new Error(`Invalid preset payload in: ${filePath}`)
  }
  const presetObj = presetRaw as Record<string, unknown>
  const idxValue = presetObj.idx
  const preset: VoicePreset = {
    idx: typeof idxValue === 'number' ? idxValue : 0,
    preferredName: typeof presetObj.preferredName === 'string' ? presetObj.preferredName : '',
    label: typeof presetObj.label === 'string' ? presetObj.label : '',
    status: typeof presetObj.status === 'string' ? presetObj.status : '',
    voicePrompt: typeof presetObj.voicePrompt === 'string' ? presetObj.voicePrompt : '',
    previewText: typeof presetObj.previewText === 'string' ? presetObj.previewText : '',
    voiceId: typeof presetObj.voiceId === 'string' ? presetObj.voiceId : '',
    requestId: typeof presetObj.requestId === 'string' ? presetObj.requestId : '',
    localFile: typeof presetObj.localFile === 'string' ? presetObj.localFile : '',
    error: typeof presetObj.error === 'string' ? presetObj.error : '',
  }

  return {
    fromVoiceFile,
    preset,
    targetModel,
    createdVoiceId,
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function appendLog(logFile: string, message: string) {
  const line = `[${new Date().toISOString()}] ${message}\n`
  process.stdout.write(line)
  writeFileSync(logFile, line, { flag: 'a' })
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return String(error)
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 30000): Promise<Response> {
  return fetch(url, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  })
}

function readModelTextMessageContent(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''

  const parts: string[] = []
  for (const part of value) {
    if (!part || typeof part !== 'object') continue
    const rec = part as Record<string, unknown>
    if (typeof rec.text === 'string') parts.push(rec.text)
  }
  return parts.join('\n')
}

async function aliyunTextJson(params: {
  model: string
  prompt: string
  apiKey: string
  logFile: string
}): Promise<AliyunTextJsonResponse> {
  let lastError = ''
  for (let i = 1; i <= 4; i += 1) {
    const response = await fetchWithTimeout(
      'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${params.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: params.model,
          temperature: 0.7,
          messages: [
            {
              role: 'system',
              content: '你是视频短剧导演。严格输出 JSON，不要输出任何额外说明。',
            },
            {
              role: 'user',
              content: params.prompt,
            },
          ],
        }),
      },
      300000,
    )

    const data = await response.json().catch(() => ({})) as Record<string, unknown>
    const errorObj = data.error as { message?: string } | undefined
    const choices = data.choices as Array<{ message?: { content?: unknown } }> | undefined
    const text = readModelTextMessageContent(choices?.[0]?.message?.content)

    if (response.ok && !errorObj && text.trim().length > 0) {
      return {
        text,
        modelVersion: typeof data.model === 'string' ? data.model : params.model,
      }
    }

    lastError = errorObj?.message || `HTTP ${response.status}`
    appendLog(params.logFile, `aliyunTextJson retry=${i} model=${params.model} error=${lastError}`)
    await sleep(3000)
  }

  throw new Error(`Aliyun text failed: ${lastError}`)
}

async function waitForImageTask(params: {
  taskId: string
  apiKey: string
  logFile: string
  sceneId: number
}): Promise<string> {
  for (let i = 1; i <= 80; i += 1) {
    let response: Response
    try {
      response = await fetchWithTimeout(
        `https://dashscope.aliyuncs.com/api/v1/tasks/${params.taskId}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${params.apiKey}`,
          },
        },
        15000,
      )
    } catch (error: unknown) {
      appendLog(params.logFile, `image task scene=${params.sceneId} poll=${i} network_error=${toErrorMessage(error)}`)
      await sleep(2500)
      continue
    }

    const data = await response.json().catch(() => ({})) as Record<string, unknown>
    const output = data.output as { task_status?: string; results?: Array<{ url?: string }> } | undefined
    const taskStatus = output?.task_status || ''

    if (!response.ok) {
      const code = typeof data.code === 'string' ? data.code : ''
      const message = typeof data.message === 'string' ? data.message : ''
      throw new Error(`image task query failed: ${code || response.status} ${message}`)
    }

    if (taskStatus === 'SUCCEEDED') {
      const imageUrl = output?.results?.[0]?.url || ''
      if (!imageUrl) throw new Error(`image task succeeded but output url is empty, task=${params.taskId}`)
      return imageUrl
    }
    if (taskStatus === 'FAILED' || taskStatus === 'CANCELED') {
      const code = typeof data.code === 'string' ? data.code : ''
      const message = typeof data.message === 'string' ? data.message : ''
      throw new Error(`image task failed: ${taskStatus} ${code} ${message}`)
    }

    appendLog(params.logFile, `image task scene=${params.sceneId} poll=${i} status=${taskStatus || 'UNKNOWN'}`)
    await sleep(2500)
  }

  throw new Error(`image task timeout: task=${params.taskId}`)
}

function isQwenImageSyncModel(model: string): boolean {
  const normalized = model.trim().toLowerCase()
  return normalized.startsWith('qwen-image-2.0') || normalized.startsWith('qwen-image-max')
}

function extractAliyunSyncImageUrl(data: Record<string, unknown>): string {
  const output = data.output as { choices?: Array<{ message?: { content?: Array<{ image?: string }> } }> } | undefined
  const url = output?.choices?.[0]?.message?.content?.find((part) => typeof part.image === 'string')?.image || ''
  if (!url) throw new Error('Aliyun sync image response has empty image url')
  return url
}

async function downloadImageUrl(imageUrl: string): Promise<Buffer> {
  const imageResponse = await fetchWithTimeout(imageUrl, { method: 'GET' }, 120000)
  if (!imageResponse.ok) throw new Error(`image download failed: HTTP ${imageResponse.status}`)
  return Buffer.from(await imageResponse.arrayBuffer())
}

async function aliyunSyncImage(params: {
  model: string
  prompt: string
  apiKey: string
  logFile: string
  sceneId: number
}): Promise<Buffer> {
  let lastError = ''
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    let response: Response
    try {
      response = await fetchWithTimeout('https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${params.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: params.model,
          input: {
            messages: [
              {
                role: 'user',
                content: [
                  {
                    text: params.prompt,
                  },
                ],
              },
            ],
          },
          parameters: {
            n: 1,
            size: '1280*720',
            watermark: false,
            prompt_extend: true,
            negative_prompt: '低分辨率，低画质，肢体畸形，手指畸形，画面过饱和，蜡像感，人脸无细节，过度光滑，画面具有AI感，构图混乱，文字模糊，扭曲。',
          },
        }),
      }, 300000)
    } catch (error) {
      lastError = `Aliyun sync image network failed: ${toErrorMessage(error)}`
      appendLog(
        params.logFile,
        `aliyun sync image retry=${attempt} scene=${params.sceneId} model=${params.model} error=${lastError}`,
      )
      await sleep(Math.min(45_000, 5_000 * attempt))
      continue
    }

    const data = await response.json().catch(() => ({})) as Record<string, unknown>
    const code = typeof data.code === 'string' ? data.code : ''
    const message = typeof data.message === 'string' ? data.message : ''
    if (response.ok && !code && !message) {
      try {
        return await downloadImageUrl(extractAliyunSyncImageUrl(data))
      } catch (error) {
        lastError = `Aliyun sync image download failed: ${toErrorMessage(error)}`
        appendLog(
          params.logFile,
          `aliyun sync image retry=${attempt} scene=${params.sceneId} model=${params.model} error=${lastError}`,
        )
        await sleep(Math.min(45_000, 5_000 * attempt))
        continue
      }
    }

    lastError = `Aliyun sync image failed: ${code || response.status} ${message}`.trim()
    appendLog(
      params.logFile,
      `aliyun sync image retry=${attempt} scene=${params.sceneId} model=${params.model} error=${lastError}`,
    )
    await sleep(Math.min(45_000, 5_000 * attempt))
  }

  throw new Error(lastError || `Aliyun sync image failed: ${params.model}`)
}

async function aliyunImage(params: {
  model: string
  prompt: string
  apiKey: string
  logFile: string
  sceneId: number
}): Promise<Buffer> {
  if (isQwenImageSyncModel(params.model)) {
    appendLog(params.logFile, `aliyun sync image scene=${params.sceneId} model=${params.model}`)
    return aliyunSyncImage(params)
  }

  const response = await fetchWithTimeout('https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
      'X-DashScope-Async': 'enable',
    },
    body: JSON.stringify({
      model: params.model,
      input: {
        prompt: params.prompt,
      },
      parameters: {
        n: 1,
        size: '1280*720',
      },
    }),
  })

  const data = await response.json().catch(() => ({})) as Record<string, unknown>
  const code = typeof data.code === 'string' ? data.code : ''
  const message = typeof data.message === 'string' ? data.message : ''
  if (!response.ok || code || message) {
    throw new Error(`Aliyun image submit failed: ${code || response.status} ${message}`)
  }

  const output = data.output as { task_id?: string } | undefined
  const taskId = output?.task_id || ''
  if (!taskId) throw new Error('Aliyun image submit succeeded but task_id is empty')

  const imageUrl = await waitForImageTask({
    taskId,
    apiKey: params.apiKey,
    logFile: params.logFile,
    sceneId: params.sceneId,
  })

  return downloadImageUrl(imageUrl)
}

function selectVoicePreset(args: CliArgs): VoicePreset {
  if (!existsSync(args.voiceManifestCsv)) {
    throw new Error(`Voice manifest csv not found: ${args.voiceManifestCsv}`)
  }
  if (!existsSync(args.voiceFile)) {
    throw new Error(`Voice file not found: ${args.voiceFile}`)
  }

  const csvRaw = readFileSync(args.voiceManifestCsv, 'utf8')
  const presets = parseVoicePresetCsv(csvRaw)
  if (presets.length === 0) {
    throw new Error(`Voice manifest is empty: ${args.voiceManifestCsv}`)
  }
  const preset = findVoicePresetByFile(presets, args.voiceFile)
  if (!preset) {
    throw new Error(`Cannot find preset for voice file: ${args.voiceFile}`)
  }
  if (!preset.voicePrompt.trim()) {
    throw new Error(`Matched preset has empty voice_prompt: file=${args.voiceFile}`)
  }
  return preset
}

async function createVdVoiceFromPreset(params: {
  preset: VoicePreset
  targetModel: string
  apiKey: string
  logFile: string
}): Promise<{ voiceId: string; previewWav: Buffer | null }> {
  const response = await fetchWithTimeout('https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'qwen-voice-design',
      input: {
        action: 'create',
        target_model: params.targetModel,
        voice_prompt: params.preset.voicePrompt,
        preview_text: params.preset.previewText || '这是一个用于短剧故事配音的测试音色。',
        preferred_name: params.preset.preferredName || 'voicea1',
        language: 'zh',
      },
      parameters: {
        sample_rate: 24000,
        response_format: 'wav',
      },
    }),
  })

  const data = await response.json().catch(() => ({})) as Record<string, unknown>
  const code = typeof data.code === 'string' ? data.code : ''
  const message = typeof data.message === 'string' ? data.message : ''
  if (!response.ok || code || message) {
    throw new Error(`voice design failed: ${code || response.status} ${message}`)
  }

  const output = data.output as {
    voice?: string
    preview_audio?: {
      data?: string
    }
  } | undefined
  const voiceId = output?.voice || ''
  if (!voiceId) throw new Error('voice design succeeded but voice id is empty')

  const previewAudioData = output?.preview_audio?.data || ''
  let previewWav: Buffer | null = null
  if (previewAudioData.startsWith('data:')) {
    const splitIndex = previewAudioData.indexOf('base64,')
    if (splitIndex > -1) {
      const encoded = previewAudioData.slice(splitIndex + 'base64,'.length)
      previewWav = Buffer.from(encoded, 'base64')
    } else {
      appendLog(params.logFile, 'voice preview exists but format is not base64 data uri')
    }
  }

  return { voiceId, previewWav }
}

async function qwenTtsWithVoice(params: {
  text: string
  voiceId: string
  ttsModel: string
  apiKey: string
}): Promise<{ wav: Buffer; sourceUrl: string }> {
  const response = await fetchWithTimeout(
    'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: params.ttsModel,
        input: {
          text: params.text,
          voice: params.voiceId,
          language_type: 'Chinese',
        },
        parameters: {
          instructions: '中文短剧口播，悬疑克制，节奏清晰，重点句压低语速。',
        },
      }),
    },
    120000,
  )

  const data = await response.json().catch(() => ({})) as Record<string, unknown>
  const code = typeof data.code === 'string' ? data.code : ''
  const message = typeof data.message === 'string' ? data.message : ''
  if (!response.ok || code || message) {
    throw new Error(`Qwen TTS failed: ${code || response.status} ${message}`)
  }

  const output = data.output as { audio?: { url?: string }; audio_url?: string } | undefined
  const sourceUrl = output?.audio?.url || output?.audio_url || ''
  if (!sourceUrl) throw new Error('Qwen TTS returned empty audio url')

  const audioResponse = await fetchWithTimeout(sourceUrl, { method: 'GET' }, 60000)
  if (!audioResponse.ok) throw new Error(`Qwen audio download failed: HTTP ${audioResponse.status}`)
  return {
    wav: Buffer.from(await audioResponse.arrayBuffer()),
    sourceUrl,
  }
}

function runComposeVideo(runDir: string, outputPath: string, qwenApiKey: string) {
  const result = spawnSync(
    'npm',
    [
      'run',
      'video:compose-story',
      '--',
      '--run-dir',
      runDir,
      '--output',
      outputPath,
      '--qwen-key',
      qwenApiKey,
    ],
    { encoding: 'utf8', env: process.env },
  )
  if (result.status !== 0) {
    throw new Error(`video compose failed: ${result.stderr || result.stdout}`)
  }
}

function runApplySubtitles(runDir: string, artifacts: ReturnType<typeof resolveStoryVideoArtifacts>): void {
  const result = spawnSync(
    'npm',
    [
      'run',
      'video:apply-story-subtitles',
      '--',
      '--run-dir',
      runDir,
      '--base-video',
      artifacts.baseVideoPath,
      '--subtitle',
      artifacts.subtitleAssPath,
      '--soft-subtitle',
      artifacts.subtitlePath,
      '--hard-output',
      artifacts.hardSubVideoPath,
      '--soft-output',
      artifacts.softSubVideoPath,
    ],
    { encoding: 'utf8', env: process.env },
  )
  if (result.status !== 0) {
    throw new Error(`subtitle apply failed: ${result.stderr || result.stdout}`)
  }
}

function runFfmpeg(ffmpegPath: string, args: string[]) {
  const result = spawnSync(ffmpegPath, args, { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed: ${result.stderr || result.stdout}`)
  }
}

function escapeConcatPath(input: string): string {
  return input.replace(/'/g, "'\\''")
}

function utf8Bytes(input: string): number {
  return Buffer.byteLength(input, 'utf8')
}

function splitTextForTts(text: string, maxBytes = 560): string[] {
  const normalized = text.replace(/\r/g, '').trim()
  if (!normalized) return []

  const rough = normalized
    .split(/(?<=[。！？!?；;])/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)

  const chunks: string[] = []
  let current = ''
  const flushCurrent = () => {
    if (current.trim().length > 0) chunks.push(current.trim())
    current = ''
  }

  for (const sentence of rough) {
    if (utf8Bytes(sentence) > maxBytes) {
      flushCurrent()
      let start = 0
      while (start < sentence.length) {
        let end = Math.min(sentence.length, start + 180)
        while (end > start && utf8Bytes(sentence.slice(start, end)) > maxBytes) {
          end -= 1
        }
        if (end <= start) end = Math.min(sentence.length, start + 1)
        chunks.push(sentence.slice(start, end))
        start = end
      }
      continue
    }

    const candidate = current.length > 0 ? `${current}${sentence}` : sentence
    if (utf8Bytes(candidate) > maxBytes) {
      flushCurrent()
      current = sentence
    } else {
      current = candidate
    }
  }
  flushCurrent()
  return chunks
}

async function synthesizeNarrationToFile(params: {
  text: string
  voiceId: string
  ttsModel: string
  apiKey: string
  outputDir: string
  outputWavPath: string
  logFile: string
}): Promise<{ sourceUrls: string[]; chunkCount: number }> {
  const chunks = splitTextForTts(params.text)
  if (chunks.length === 0) throw new Error('Narration is empty after split')

  const segmentDir = path.join(params.outputDir, 'tts_segments')
  ensureDir(segmentDir)

  const segmentPaths: string[] = []
  const sourceUrls: string[] = []
  for (let i = 0; i < chunks.length; i += 1) {
    appendLog(params.logFile, `tts chunk ${i + 1}/${chunks.length} chars=${chunks[i].length} bytes=${utf8Bytes(chunks[i])}`)
    const tts = await qwenTtsWithVoice({
      text: chunks[i],
      voiceId: params.voiceId,
      ttsModel: params.ttsModel,
      apiKey: params.apiKey,
    })
    const segmentPath = path.join(segmentDir, `seg_${String(i + 1).padStart(3, '0')}.wav`)
    writeFileSync(segmentPath, tts.wav)
    segmentPaths.push(segmentPath)
    sourceUrls.push(tts.sourceUrl)
  }

  if (segmentPaths.length === 1) {
    writeFileSync(params.outputWavPath, readFileSync(segmentPaths[0]))
    return { sourceUrls, chunkCount: 1 }
  }

  const ffmpegPath = resolveFfmpegPath()
  const concatPath = path.join(segmentDir, 'concat.txt')
  writeFileSync(
    concatPath,
    segmentPaths.map((segmentPath) => `file '${escapeConcatPath(segmentPath)}'`).join('\n') + '\n',
    'utf8',
  )

  try {
    runFfmpeg(ffmpegPath, [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      concatPath,
      '-c',
      'copy',
      params.outputWavPath,
    ])
  } catch {
    runFfmpeg(ffmpegPath, [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      concatPath,
      '-c:a',
      'pcm_s16le',
      '-ar',
      '24000',
      '-ac',
      '1',
      params.outputWavPath,
    ])
  }

  return { sourceUrls, chunkCount: chunks.length }
}

async function main() {
  const args = parseArgs()
  const input = resolveStoryInput(args)

  ensureDir(args.outputDir)
  ensureDir(path.join(args.outputDir, 'images'))
  ensureDir(path.join(args.outputDir, 'characters'))

  const logFile = path.join(args.outputDir, '00_pipeline.log')
  if (!existsSync(logFile)) writeFileSync(logFile, '')

  const sourcePath = path.join(args.outputDir, '01_source.txt')
  if (!existsSync(sourcePath)) {
    writeFileSync(sourcePath, input.sourceText, 'utf8')
  }
  appendLog(logFile, `source loaded: ${input.sourceLabel}`)

  const planPath = path.join(args.outputDir, '03_story_plan.json')
  let blueprintModelVersion = args.llmModel
  let blueprint: StoryBlueprint

  if (existsSync(planPath)) {
    appendLog(logFile, 'step: reuse existing blueprint')
    blueprintModelVersion = 'reused-existing-blueprint'
    const blueprintPlan = estimateAliyunBlueprintPlan(input.sourceText, args.sceneCountOverride)
    blueprint = normalizeAliyunBlueprint(readJsonObject(planPath), blueprintPlan)
    appendLog(logFile, `blueprint reused: title=${blueprint.title}`)
  } else {
    appendLog(logFile, 'step: generate blueprint via aliyun llm')
    const blueprintPlan = estimateAliyunBlueprintPlan(input.sourceText, args.sceneCountOverride)
    appendLog(logFile, `adaptive blueprint plan: sourceChars=${blueprintPlan.sourceCharCount} paragraphs=${blueprintPlan.sourceParagraphCount} maxScenes=${blueprintPlan.maxSceneCount} maxVoiceOverChars=${blueprintPlan.maxVoiceOverChars}`)
    const blueprintResponse = await aliyunTextJson({
      model: args.llmModel,
      prompt: buildAliyunBlueprintPrompt(input.sourceText, blueprintPlan),
      apiKey: args.aliyunApiKey,
      logFile,
    })
    blueprintModelVersion = blueprintResponse.modelVersion
    writeFileSync(path.join(args.outputDir, '02_blueprint_raw.txt'), blueprintResponse.text, 'utf8')
    const blueprintJson = extractFirstJsonObject(blueprintResponse.text)
    blueprint = normalizeAliyunBlueprint(blueprintJson, blueprintPlan)
    writeFileSync(planPath, JSON.stringify(blueprint, null, 2), 'utf8')
    appendLog(logFile, `blueprint ready: title=${blueprint.title}`)
  }

  const voicePresetPath = path.join(args.outputDir, '00_voice_preset.json')
  const existingVoiceState = readVoicePresetState(voicePresetPath)
  let preset: VoicePreset
  let voiceId = ''

  if (args.ttsVoice.trim()) {
    preset = {
      idx: 0,
      preferredName: 'existing-tts-voice',
      label: 'existing tts voice',
      status: 'provided',
      voicePrompt: '',
      previewText: '',
      voiceId: args.ttsVoice.trim(),
      requestId: '',
      localFile: '',
      error: '',
    }
    voiceId = args.ttsVoice.trim()
    appendLog(logFile, `step: use provided voice id: ${voiceId}`)
  } else if (existingVoiceState) {
    preset = existingVoiceState.preset
    voiceId = existingVoiceState.createdVoiceId
    appendLog(logFile, `step: reuse existing voice id: ${voiceId}`)
  } else {
    appendLog(logFile, 'step: create custom voice id from selected preset')
    preset = selectVoicePreset(args)
    const voiceResult = await createVdVoiceFromPreset({
      preset,
      targetModel: args.ttsModel,
      apiKey: args.aliyunApiKey,
      logFile,
    })
    voiceId = voiceResult.voiceId
    if (voiceResult.previewWav) {
      writeFileSync(path.join(args.outputDir, '00_voice_preview.wav'), voiceResult.previewWav)
    }
    writeFileSync(
      voicePresetPath,
      JSON.stringify(
        {
          fromVoiceFile: args.voiceFile,
          preset,
          targetModel: args.ttsModel,
          createdVoiceId: voiceResult.voiceId,
        },
        null,
        2,
      ),
      'utf8',
    )
    appendLog(logFile, `voice created: ${voiceResult.voiceId}`)
  }

  appendLog(logFile, 'step: generate character assets by aliyun image')
  const characterManifest: Array<{ id: string; name: string; filePath: string }> = []
  for (const character of blueprint.characters) {
    const filename = `${character.id}-${toFileSlug(character.name)}.png`
    const filePath = path.join(args.outputDir, 'characters', filename)

    if (!existsSync(filePath)) {
      const prompt = createCharacterImagePrompt(character, blueprint.style, '16:9')
      const imageData = await aliyunImage({
        model: args.imageModel,
        prompt,
        apiKey: args.aliyunApiKey,
        logFile,
        sceneId: 100 + characterManifest.length,
      })
      writeFileSync(filePath, imageData)
      appendLog(logFile, `character asset saved: ${filename}`)
    } else {
      appendLog(logFile, `character asset reused: ${filename}`)
    }

    characterManifest.push({ id: character.id, name: character.name, filePath })
  }
  writeFileSync(path.join(args.outputDir, '04_character_manifest.json'), JSON.stringify(characterManifest, null, 2), 'utf8')

  appendLog(logFile, 'step: generate scene images by aliyun image')
  const sceneManifest: Array<{ sceneId: number; imagePath: string; charRefs: string[] }> = []
  for (const scene of blueprint.scenes) {
    const imagePath = path.join(args.outputDir, 'images', `scene_${String(scene.id).padStart(2, '0')}.png`)

    if (!existsSync(imagePath)) {
      const prompt = createSceneImagePrompt(scene, blueprint.characters, blueprint.style, '16:9')
      const imageData = await aliyunImage({
        model: args.imageModel,
        prompt,
        apiKey: args.aliyunApiKey,
        logFile,
        sceneId: scene.id,
      })
      writeFileSync(imagePath, imageData)
      appendLog(logFile, `scene image saved: scene_${String(scene.id).padStart(2, '0')}.png`)
    } else {
      appendLog(logFile, `scene image reused: scene_${String(scene.id).padStart(2, '0')}.png`)
    }

    sceneManifest.push({ sceneId: scene.id, imagePath, charRefs: scene.charRefs })
  }
  writeFileSync(path.join(args.outputDir, '05_image_manifest.json'), JSON.stringify(sceneManifest, null, 2), 'utf8')

  appendLog(logFile, 'step: generate narration by aliyun tts with custom voice')
  const storyNarrationText = blueprint.scenes.map((scene) => scene.voiceOver.trim()).filter((line) => line.length > 0).join('\n')
  if (storyNarrationText.length === 0) {
    throw new Error('NARRATION_FROM_SCENES_EMPTY')
  }
  const narrationText = buildNarrationText(args.hostOpening, storyNarrationText)
  const narrationTextPath = path.join(args.outputDir, '06_narration.txt')
  writeFileSync(narrationTextPath, `${narrationText}\n`, 'utf8')
  if (args.hostOpening.trim()) {
    writeFileSync(path.join(args.outputDir, '00_host_opening.txt'), `${args.hostOpening.trim()}\n`, 'utf8')
  }

  const narrationWavPath = path.join(args.outputDir, '05_narration.wav')
  let ttsSourceUrl = ''
  let ttsChunkCount = 0
  if (!existsSync(narrationWavPath)) {
    const ttsResult = await synthesizeNarrationToFile({
      text: narrationText,
      voiceId: voiceId,
      ttsModel: args.ttsModel,
      apiKey: args.aliyunApiKey,
      outputDir: args.outputDir,
      outputWavPath: narrationWavPath,
      logFile,
    })
    ttsChunkCount = ttsResult.chunkCount
    ttsSourceUrl = ttsResult.sourceUrls[0] || ''
    writeFileSync(path.join(args.outputDir, '00_tts_source_url.txt'), `${ttsResult.sourceUrls.join('\n')}\n`, 'utf8')
  } else {
    appendLog(logFile, 'narration audio reused: 05_narration.wav')
    const sourceUrlPath = path.join(args.outputDir, '00_tts_source_url.txt')
    if (existsSync(sourceUrlPath)) {
      const urls = readFileSync(sourceUrlPath, 'utf8')
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
      ttsSourceUrl = urls[0] || ''
      ttsChunkCount = urls.length
    }
  }

  appendLog(logFile, 'step: compose final video by ffmpeg pipeline')
  const artifacts = resolveStoryVideoArtifacts(args.outputDir)
  runComposeVideo(args.outputDir, artifacts.baseVideoPath, args.aliyunApiKey)
  appendLog(logFile, 'step: render subtitle videos')
  runApplySubtitles(args.outputDir, artifacts)

  const generatedAt = new Date().toISOString()
  const resolvedStoryId = resolveStoryId(args, sourcePath)
  const releaseManifest = buildStoryReleaseManifest({
    workspaceRoot: process.cwd(),
    runDir: args.outputDir,
    storyId: resolvedStoryId,
    storyTitle: blueprint.title,
    generatedAt,
    storageProvider: resolveReleaseStorageProvider(),
    context: {
      hostOpening: args.hostOpening.trim() || undefined,
    },
  })
  const releaseManifestPath = writeStoryReleaseManifest(releaseManifest, args.outputDir)

  const summary = {
    storySource: input.sourceLabel,
    title: blueprint.title,
    style: blueprint.style,
    models: {
      blueprint: blueprintModelVersion,
      image: args.imageModel,
      tts: args.ttsModel,
      voiceDesign: args.ttsVoice.trim() ? 'provided-voice-id' : 'qwen-voice-design',
    },
    narrativePlan: {
      mode: 'adaptive-story-length',
      sceneCountOverride: args.sceneCountOverride,
      generatedSceneCount: blueprint.scenes.length,
      narrationChars: narrationText.length,
    },
    output: {
      runDir: args.outputDir,
      video: artifacts.baseVideoPath,
      hard_sub_video: artifacts.hardSubVideoPath,
      soft_sub_video: artifacts.softSubVideoPath,
      subtitle: artifacts.subtitlePath,
      source: sourcePath,
      storyPlan: planPath,
      characterManifest: path.join(args.outputDir, '04_character_manifest.json'),
      imageManifest: path.join(args.outputDir, '05_image_manifest.json'),
      narration: narrationTextPath,
      narrationWav: narrationWavPath,
    },
    voice: {
      fromFile: args.voiceFile,
      voiceId,
      presetName: preset.preferredName,
      presetLabel: preset.label,
    },
    ttsSourceUrl,
    ttsChunkCount,
    releaseManifest: releaseManifestPath,
    generatedAt,
  }
  writeFileSync(path.join(args.outputDir, '00_run_summary.json'), JSON.stringify(summary, null, 2), 'utf8')
  appendLog(logFile, `release manifest written: ${releaseManifestPath}`)
  appendLog(logFile, `pipeline done: ${artifacts.hardSubVideoPath}`)
  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error: unknown) => {
  const message = toErrorMessage(error)
  console.error(`PIPELINE_FAILED: ${message}`)
  process.exit(1)
})
