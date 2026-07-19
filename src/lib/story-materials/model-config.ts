import { DEFAULT_TTS_MODEL_VD, DEFAULT_TTS_VOICE_VD } from '@/lib/story-materials/tts-config'

export const SCRIPT_MODEL_PROVIDER = {
  GOOGLE: 'google',
  QWEN: 'qwen',
  OPENAI: 'openai',
} as const

export type ScriptModelProvider = (typeof SCRIPT_MODEL_PROVIDER)[keyof typeof SCRIPT_MODEL_PROVIDER]

export interface StoryGenerationModelConfig {
  scriptProvider: ScriptModelProvider
  scriptModel: string
  imageModel: string
  ttsModel: string
  ttsVoice: string
}

const DEFAULT_GEMINI_SCRIPT_MODEL = 'gemini-3-flash-preview-nothinking'
export const DEFAULT_QWEN_SCRIPT_MODEL = 'deepseek-v4-flash'
export const DEFAULT_STORY_IMAGE_MODEL = 'qwen-image-2.0'

export const DEFAULT_SCRIPT_MODEL_BY_PROVIDER: Record<ScriptModelProvider, string> = {
  [SCRIPT_MODEL_PROVIDER.GOOGLE]: DEFAULT_GEMINI_SCRIPT_MODEL,
  [SCRIPT_MODEL_PROVIDER.QWEN]: DEFAULT_QWEN_SCRIPT_MODEL,
  [SCRIPT_MODEL_PROVIDER.OPENAI]: DEFAULT_GEMINI_SCRIPT_MODEL,
}

export const DEFAULT_STORY_GENERATION_MODEL_CONFIG: StoryGenerationModelConfig = {
  scriptProvider: SCRIPT_MODEL_PROVIDER.QWEN,
  scriptModel: DEFAULT_SCRIPT_MODEL_BY_PROVIDER[SCRIPT_MODEL_PROVIDER.QWEN],
  imageModel: DEFAULT_STORY_IMAGE_MODEL,
  ttsModel: DEFAULT_TTS_MODEL_VD,
  ttsVoice: DEFAULT_TTS_VOICE_VD,
}

function toNonEmptyString(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim()
}

function isScriptModelProvider(value: string): value is ScriptModelProvider {
  return value === SCRIPT_MODEL_PROVIDER.GOOGLE
    || value === SCRIPT_MODEL_PROVIDER.QWEN
    || value === SCRIPT_MODEL_PROVIDER.OPENAI
}

export function parseStoryGenerationModelConfig(input: unknown): StoryGenerationModelConfig {
  const row = input && typeof input === 'object' ? input as Record<string, unknown> : {}

  const providerRaw = toNonEmptyString(row.scriptProvider).toLowerCase()
  if (providerRaw && !isScriptModelProvider(providerRaw)) {
    throw new Error(`INVALID_MODEL_CONFIG: unsupported scriptProvider=${providerRaw}`)
  }
  const scriptProvider = (providerRaw || DEFAULT_STORY_GENERATION_MODEL_CONFIG.scriptProvider) as ScriptModelProvider

  const scriptModelRaw = toNonEmptyString(row.scriptModel)
  const imageModelRaw = toNonEmptyString(row.imageModel)
  const ttsModelRaw = toNonEmptyString(row.ttsModel)
  const ttsVoiceRaw = toNonEmptyString(row.ttsVoice)

  const scriptModel = scriptModelRaw || DEFAULT_SCRIPT_MODEL_BY_PROVIDER[scriptProvider]
  const imageModel = imageModelRaw || DEFAULT_STORY_GENERATION_MODEL_CONFIG.imageModel
  const ttsModel = ttsModelRaw || DEFAULT_STORY_GENERATION_MODEL_CONFIG.ttsModel
  const ttsVoice = ttsVoiceRaw || DEFAULT_STORY_GENERATION_MODEL_CONFIG.ttsVoice

  if (!scriptModel) throw new Error('INVALID_MODEL_CONFIG: scriptModel is required')
  if (!imageModel) throw new Error('INVALID_MODEL_CONFIG: imageModel is required')
  if (!ttsModel) throw new Error('INVALID_MODEL_CONFIG: ttsModel is required')
  if (!ttsVoice) throw new Error('INVALID_MODEL_CONFIG: ttsVoice is required')

  return {
    scriptProvider,
    scriptModel,
    imageModel,
    ttsModel,
    ttsVoice,
  }
}
