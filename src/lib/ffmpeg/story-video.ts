import path from 'node:path'

export type SceneDurationInput = {
  id: number
  durationSec?: number
  voiceOver?: string
}

export type SubtitleCue = {
  index: number
  startSec: number
  endSec: number
  text: string
}

export type AssSubtitleOptions = {
  playResX?: number
  playResY?: number
  fontName?: string
  fontSize?: number
  marginL?: number
  marginR?: number
  marginV?: number
  maxCharsPerLine?: number
  maxLines?: number
}

export function getWavDurationMs(buffer: Buffer): number | null {
  if (buffer.length < 44) return null
  if (buffer.subarray(0, 4).toString('ascii') !== 'RIFF') return null
  if (buffer.subarray(8, 12).toString('ascii') !== 'WAVE') return null

  const byteRate = buffer.readUInt32LE(28)
  if (byteRate <= 0) return null

  let offset = 12
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.subarray(offset, offset + 4).toString('ascii')
    const chunkSize = buffer.readUInt32LE(offset + 4)
    if (chunkId === 'data') {
      const safeDataSize = Math.min(chunkSize, Math.max(0, buffer.length - (offset + 8)))
      if (safeDataSize <= 0) return null
      return Math.round((safeDataSize / byteRate) * 1000)
    }
    offset += 8 + chunkSize
  }

  return null
}

export function normalizeSceneDurations(
  scenes: SceneDurationInput[],
  audioSec: number,
  minSec = 3.5,
): number[] {
  const voiceOverWeights = scenes.map((scene) => {
    const voiceOver = typeof scene.voiceOver === 'string' ? scene.voiceOver.replace(/\s+/gu, '') : ''
    return voiceOver.length
  })
  const hasUsefulVoiceOverWeights = voiceOverWeights.every((weight) => weight > 0)
  const base = hasUsefulVoiceOverWeights ? voiceOverWeights : scenes.map((scene) => {
    const raw = typeof scene.durationSec === 'number' ? scene.durationSec : 8
    return Number.isFinite(raw) ? Math.max(0.1, raw) : 8
  })
  const baseTotal = base.reduce((sum, value) => sum + value, 0)
  if (baseTotal <= 0 || audioSec <= 0) {
    return base.map(() => minSec)
  }
  const scale = audioSec / baseTotal
  return base.map((value) => Math.max(minSec, Number((value * scale).toFixed(3))))
}

export function sceneImageCandidates(runDir: string, sceneId: number): string[] {
  const name = `scene_${String(sceneId).padStart(2, '0')}`
  const baseDir = path.join(runDir, 'images')
  return [
    path.join(baseDir, `${name}.png`),
    path.join(baseDir, `${name}.jpg`),
    path.join(baseDir, `${name}.jpeg`),
    path.join(baseDir, `${name}.webp`),
  ]
}

function splitLongChunk(text: string, maxCharsPerCue: number): string[] {
  if (text.length <= maxCharsPerCue) return [text]

  const delimiters = ['，', ',', '、', '：', ':', '；', ';']
  const chunks: string[] = []
  let current = ''

  for (const char of text) {
    current += char
    if (current.length >= maxCharsPerCue && delimiters.includes(char)) {
      chunks.push(current.trim())
      current = ''
      continue
    }
    if (current.length >= maxCharsPerCue) {
      chunks.push(current.trim())
      current = ''
    }
  }

  if (current.trim().length > 0) chunks.push(current.trim())
  return chunks
}

function splitNarrationLines(text: string, maxCharsPerCue: number): string[] {
  const paragraphs = text
    .split(/\r?\n/u)
    .map((row) => row.trim())
    .filter((row) => row.length > 0)

  if (paragraphs.length === 0) return []

  const sentenceParts: string[] = []
  for (const paragraph of paragraphs) {
    const byPunctuation = paragraph
      .split(/(?<=[。！？!?；;])/u)
      .map((part) => part.trim())
      .filter((part) => part.length > 0)

    if (byPunctuation.length === 0) {
      sentenceParts.push(paragraph)
      continue
    }
    sentenceParts.push(...byPunctuation)
  }

  const smallChunks = sentenceParts.flatMap((part) => splitLongChunk(part, maxCharsPerCue))
  const merged: string[] = []
  let current = ''
  for (const chunk of smallChunks) {
    const candidate = current ? `${current}${chunk}` : chunk
    if (candidate.length <= maxCharsPerCue) {
      current = candidate
      continue
    }
    if (current.trim().length > 0) merged.push(current.trim())
    current = chunk
  }
  if (current.trim().length > 0) merged.push(current.trim())

  return merged.filter((row) => row.length > 0)
}

function formatSrtTimestamp(seconds: number): string {
  const clamped = Math.max(0, seconds)
  const totalMs = Math.round(clamped * 1000)
  const ms = totalMs % 1000
  const totalSec = Math.floor(totalMs / 1000)
  const sec = totalSec % 60
  const totalMin = Math.floor(totalSec / 60)
  const min = totalMin % 60
  const hour = Math.floor(totalMin / 60)
  return `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms).padStart(3, '0')}`
}

function formatAssTimestamp(seconds: number): string {
  const clamped = Math.max(0, seconds)
  const totalCentiseconds = Math.round(clamped * 100)
  const centiseconds = totalCentiseconds % 100
  const totalSec = Math.floor(totalCentiseconds / 100)
  const sec = totalSec % 60
  const totalMin = Math.floor(totalSec / 60)
  const min = totalMin % 60
  const hour = Math.floor(totalMin / 60)
  return `${hour}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`
}

function escapeAssText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\r?\n/gu, '\\N')
}

function wrapCueTextForAss(text: string, maxCharsPerLine: number, maxLines: number): string {
  const normalized = text.trim().replace(/\s+/gu, '')
  if (!normalized) return ''
  const pieces = splitLongChunk(normalized, Math.max(4, maxCharsPerLine))
  const lines: string[] = []
  let current = ''

  for (const piece of pieces) {
    if (!piece) continue
    const candidate = current ? `${current}${piece}` : piece
    if (candidate.length <= maxCharsPerLine) {
      current = candidate
      continue
    }
    if (current) lines.push(current)
    current = piece
  }

  if (current) lines.push(current)

  if (lines.length <= maxLines) {
    return lines.map(escapeAssText).join('\\N')
  }

  const truncatedLines = lines.slice(0, Math.max(1, maxLines - 1))
  const lastLine = lines.slice(Math.max(1, maxLines - 1)).join('')
  truncatedLines.push(lastLine)
  return truncatedLines.map(escapeAssText).join('\\N')
}

export function buildNarrationSubtitleCues(
  narrationText: string,
  totalDurationSec: number,
  maxCharsPerCue = 22,
): SubtitleCue[] {
  const lines = splitNarrationLines(narrationText.trim(), Math.max(8, maxCharsPerCue))
  if (lines.length === 0) return []

  const safeTotalDuration = Number.isFinite(totalDurationSec) ? Math.max(0.1, totalDurationSec) : 0.1
  const minCueSec = 1.2
  const minTotal = minCueSec * lines.length
  const charWeights = lines.map((line) => Math.max(1, line.replace(/\s+/gu, '').length))
  const weightSum = charWeights.reduce((sum, value) => sum + value, 0)
  const durations = charWeights.map((weight) => (safeTotalDuration * weight) / weightSum)

  if (safeTotalDuration >= minTotal) {
    const remain = safeTotalDuration - minTotal
    for (let i = 0; i < durations.length; i += 1) {
      durations[i] = minCueSec + (remain * charWeights[i]) / weightSum
    }
  }

  const cues: SubtitleCue[] = []
  let cursor = 0
  for (let i = 0; i < lines.length; i += 1) {
    const isLast = i === lines.length - 1
    const startSec = cursor
    const endSec = isLast ? safeTotalDuration : Math.min(safeTotalDuration, startSec + durations[i])
    cues.push({
      index: i + 1,
      startSec,
      endSec,
      text: lines[i],
    })
    cursor = endSec
  }

  return cues
}

export function subtitleCuesToSrt(cues: SubtitleCue[]): string {
  return cues
    .map((cue) => `${cue.index}\n${formatSrtTimestamp(cue.startSec)} --> ${formatSrtTimestamp(cue.endSec)}\n${cue.text}\n`)
    .join('\n')
    .trim()
}

export function buildNarrationSrt(
  narrationText: string,
  totalDurationSec: number,
  maxCharsPerCue = 22,
): string {
  const cues = buildNarrationSubtitleCues(narrationText, totalDurationSec, maxCharsPerCue)
  if (cues.length === 0) return ''
  return `${subtitleCuesToSrt(cues)}\n`
}

export function subtitleCuesToAss(
  cues: SubtitleCue[],
  options: AssSubtitleOptions = {},
): string {
  const playResX = options.playResX ?? 1280
  const playResY = options.playResY ?? 720
  const fontName = options.fontName ?? 'Songti SC'
  const fontSize = options.fontSize ?? 36
  const marginL = options.marginL ?? 72
  const marginR = options.marginR ?? 72
  const marginV = options.marginV ?? 42
  const maxCharsPerLine = options.maxCharsPerLine ?? 11
  const maxLines = options.maxLines ?? 2

  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    `PlayResX: ${playResX}`,
    `PlayResY: ${playResY}`,
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,${fontName},${fontSize},&H00FFFFFF,&H000000FF,&H80101010,&H00000000,0,0,0,0,100,100,0,0,1,2.2,0,2,${marginL},${marginR},${marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ]

  const lines = cues.map((cue) => {
    const wrappedText = wrapCueTextForAss(cue.text, maxCharsPerLine, maxLines)
    return `Dialogue: 0,${formatAssTimestamp(cue.startSec)},${formatAssTimestamp(cue.endSec)},Default,,0,0,0,,${wrappedText}`
  })

  return `${[...header, ...lines].join('\n')}\n`
}

export function buildNarrationAss(
  narrationText: string,
  totalDurationSec: number,
  maxCharsPerCue = 22,
  options: AssSubtitleOptions = {},
): string {
  const cues = buildNarrationSubtitleCues(narrationText, totalDurationSec, maxCharsPerCue)
  if (cues.length === 0) return ''
  return subtitleCuesToAss(cues, options)
}
