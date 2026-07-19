export const DEFAULT_TTS_MODEL_VD = 'qwen3-tts-vd-2026-01-26'
export const DEFAULT_TTS_VOICE_VD = 'qwen-tts-vd-voicea1canon-voice-20260301192739696-97f2'

export const DEFAULT_TTS_MODEL_VC = 'qwen3-tts-vc-2026-01-22'
export const DEFAULT_TTS_VOICE_VC = 'qwen-tts-vc-voicea1-voice-20260406203404411-21ff'

export const TTS_MODEL_PRESETS = [
  DEFAULT_TTS_MODEL_VC,
  'qwen3-tts-vc-realtime-2026-01-15',
  DEFAULT_TTS_MODEL_VD,
  'qwen3-tts-instruct-flash',
  'qwen-tts-latest',
] as const

export const TTS_VOICE_PRESETS_VC = [
  DEFAULT_TTS_VOICE_VC,
] as const

export const TTS_VOICE_PRESETS_VD = [
  DEFAULT_TTS_VOICE_VD,
  'qwen-tts-vd-voiceA1-voice-20260306011435880-b4f9',
] as const

export const TTS_VOICE_PRESETS_GENERAL = [
  'Cherry',
  'Chelsie',
  'Serena',
  'Ethan',
] as const

export function isVdTtsModel(model: string): boolean {
  return model.trim().toLowerCase().startsWith('qwen3-tts-vd')
}

export function isVcTtsModel(model: string): boolean {
  return model.trim().toLowerCase().startsWith('qwen3-tts-vc')
}

export function resolveStoryTtsVoicePresets(ttsModel: string): string[] {
  if (isVcTtsModel(ttsModel)) return [...TTS_VOICE_PRESETS_VC]
  if (isVdTtsModel(ttsModel)) return [...TTS_VOICE_PRESETS_VD]
  return [...TTS_VOICE_PRESETS_GENERAL]
}
