import JSON5 from 'json5'

export function extractFirstJsonObject(raw: string): Record<string, unknown> {
  const normalized = raw.replace(/```json\s*/gi, '').replace(/```/g, '').trim()
  const start = normalized.indexOf('{')
  const end = normalized.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('JSON object not found in model output')
  }
  const block = normalized.slice(start, end + 1)
  let parsed: unknown
  try {
    parsed = JSON.parse(block)
  } catch {
    parsed = JSON5.parse(block) as unknown
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Top-level JSON must be an object')
  }
  return parsed as Record<string, unknown>
}

export function toFileSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'story'
}

export function normalizeDurationSeconds(value: unknown, fallback = 8): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(3.5, Number(value.toFixed(3)))
}

export type StoryNarrationTargets = {
  sourceCharCount: number
  targetDurationSec: number
  targetSceneCount: number
  narrationCharMin: number
  narrationCharMax: number
  perSceneDurationSec: number
  perSceneVoiceMinChars: number
  perSceneVoiceMaxChars: number
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)))
}

function estimateClassicalChineseBoost(storyText: string, sourceCharCount: number): number {
  if (sourceCharCount === 0) return 1
  const classicalTokenCount = (storyText.match(/[之其乃遂焉矣者也乎夫盖兹未几舁仄委頓]/g) || []).length
  const ratio = classicalTokenCount / sourceCharCount
  const classicalBoost = ratio >= 0.1 ? 0.8 : ratio >= 0.06 ? 0.5 : ratio >= 0.03 ? 0.25 : 0
  const shortBoost = sourceCharCount < 260 ? ((260 - sourceCharCount) / 260) * 0.5 : 0
  return Math.min(2.2, 1 + classicalBoost + shortBoost)
}

export function estimateStoryNarrationTargets(storyText: string): StoryNarrationTargets {
  const sourceCharCount = storyText.replace(/\s+/g, '').length
  const expansionFactor = estimateClassicalChineseBoost(storyText, sourceCharCount)
  const effectiveCharCount = sourceCharCount * expansionFactor
  const baseDuration = effectiveCharCount / 4.2
  const targetDurationSec = clampInt(baseDuration, 60, 300)
  const targetSceneCount = clampInt(targetDurationSec / 10.5, 5, 18)
  const narrationCharTarget = clampInt(targetDurationSec * 4.6, 260, 1800)
  const narrationCharMin = clampInt(narrationCharTarget * 0.85, 220, 1600)
  const narrationCharMax = clampInt(narrationCharTarget * 1.25, narrationCharMin + 50, 2200)
  const perSceneDurationSec = clampInt(targetDurationSec / targetSceneCount, 6, 20)
  const perSceneVoiceMinChars = clampInt(narrationCharMin / targetSceneCount * 0.7, 35, 220)
  const perSceneVoiceMaxChars = clampInt(narrationCharMax / targetSceneCount * 1.05, perSceneVoiceMinChars + 18, 300)

  return {
    sourceCharCount,
    targetDurationSec,
    targetSceneCount,
    narrationCharMin,
    narrationCharMax,
    perSceneDurationSec,
    perSceneVoiceMinChars,
    perSceneVoiceMaxChars,
  }
}

export function splitTextForUtf8ByteLimit(text: string, maxBytes: number): string[] {
  const normalized = text.replace(/\r/g, '').trim()
  if (!normalized) {
    throw new Error('TTS input text is empty')
  }
  if (!Number.isFinite(maxBytes) || maxBytes < 8) {
    throw new Error(`Invalid maxBytes: ${maxBytes}`)
  }

  const paragraphs = normalized
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  const sentencePattern = /[^。！？!?；;]+[。！？!?；;]?/g
  const units = paragraphs.flatMap((paragraph) => {
    const matches = paragraph.match(sentencePattern)
    if (!matches || matches.length === 0) return [paragraph]
    return matches.map((part) => part.trim()).filter((part) => part.length > 0)
  })
  if (units.length === 0) throw new Error('Unable to split TTS text into units')

  const chunks: string[] = []
  let current = ''
  for (const unit of units) {
    const next = current ? `${current}${unit}` : unit
    if (Buffer.byteLength(next, 'utf8') <= maxBytes) {
      current = next
      continue
    }
    if (current) chunks.push(current)
    if (Buffer.byteLength(unit, 'utf8') <= maxBytes) {
      current = unit
      continue
    }
    let rolling = ''
    for (const char of unit) {
      const candidate = `${rolling}${char}`
      if (Buffer.byteLength(candidate, 'utf8') <= maxBytes) {
        rolling = candidate
        continue
      }
      if (!rolling) throw new Error('Single character exceeds TTS byte limit')
      chunks.push(rolling)
      rolling = char
    }
    current = rolling
  }
  if (current) chunks.push(current)
  return chunks
}
