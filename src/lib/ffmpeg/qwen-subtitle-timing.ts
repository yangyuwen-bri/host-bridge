import type { SubtitleCue } from './story-video'

export type TimedRecognitionSegment = {
  index: number
  startSec: number
  endSec: number
  text: string
}

export type AlignedSubtitleCue = SubtitleCue & {
  matchScore: number
  recognizedText: string
}

type NormalizedTextMap = {
  text: string
  positions: number[]
}

const PUNCTUATION_REGEX = /[\s，。！？；：、“”‘’（）《》〈〉【】—…,.!?;:"'()\-]/u

function normalizeTextWithMap(text: string): NormalizedTextMap {
  const chars: string[] = []
  const positions: number[] = []

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (PUNCTUATION_REGEX.test(char)) continue
    chars.push(char)
    positions.push(index)
  }

  return {
    text: chars.join(''),
    positions,
  }
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0
  if (!a) return b.length
  if (!b) return a.length

  const rows = a.length + 1
  const cols = b.length + 1
  const matrix = Array.from({ length: rows }, () => new Array<number>(cols).fill(0))

  for (let row = 0; row < rows; row += 1) matrix[row][0] = row
  for (let col = 0; col < cols; col += 1) matrix[0][col] = col

  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const substitutionCost = a[row - 1] === b[col - 1] ? 0 : 1
      matrix[row][col] = Math.min(
        matrix[row - 1][col] + 1,
        matrix[row][col - 1] + 1,
        matrix[row - 1][col - 1] + substitutionCost,
      )
    }
  }

  return matrix[rows - 1][cols - 1]
}

function similarityScore(a: string, b: string): number {
  const maxLength = Math.max(a.length, b.length)
  if (maxLength === 0) return 1
  return 1 - (levenshteinDistance(a, b) / maxLength)
}

function trimCueText(text: string): string {
  return text.trim().replace(/^[，。！？；：、\s]+/u, '').replace(/[，。！？；：、\s]+$/u, '')
}

function chooseBestSliceEnd(sourceNormalized: string, cursor: number, recognizedNormalized: string): {
  end: number
  score: number
} {
  const targetLength = Math.max(4, recognizedNormalized.length)
  const minEnd = Math.min(sourceNormalized.length, cursor + Math.max(3, targetLength - 10))
  const maxEnd = Math.min(sourceNormalized.length, cursor + targetLength + 30)

  let bestEnd = -1
  let bestScore = -1

  for (let end = minEnd; end <= maxEnd; end += 1) {
    const candidate = sourceNormalized.slice(cursor, end)
    const score = similarityScore(recognizedNormalized, candidate) - (Math.abs(candidate.length - recognizedNormalized.length) * 0.003)
    if (score > bestScore) {
      bestScore = score
      bestEnd = end
    }
  }

  if (bestEnd < 0) {
    throw new Error(`SUBTITLE_ALIGNMENT_FAILED: unable to match segment starting at cursor=${cursor}`)
  }

  return {
    end: bestEnd,
    score: Number(bestScore.toFixed(4)),
  }
}

export function alignTimedSegmentsToCanonicalText(
  canonicalText: string,
  segments: TimedRecognitionSegment[],
): AlignedSubtitleCue[] {
  if (!canonicalText.trim()) throw new Error('SUBTITLE_ALIGNMENT_FAILED: canonical text is empty')
  if (segments.length === 0) throw new Error('SUBTITLE_ALIGNMENT_FAILED: timed segments are empty')

  const source = normalizeTextWithMap(canonicalText)
  if (!source.text) throw new Error('SUBTITLE_ALIGNMENT_FAILED: canonical text normalized to empty')

  let cursor = 0

  return segments.map((segment, index) => {
    const recognized = normalizeTextWithMap(segment.text).text
    if (!recognized) {
      throw new Error(`SUBTITLE_ALIGNMENT_FAILED: recognized segment ${segment.index} is empty`)
    }

    const isLast = index === segments.length - 1
    const startOrig = cursor < source.positions.length ? source.positions[cursor] : canonicalText.length

    if (isLast) {
      const tailText = trimCueText(canonicalText.slice(startOrig))
      if (!tailText) {
        throw new Error(`SUBTITLE_ALIGNMENT_FAILED: canonical tail is empty for segment ${segment.index}`)
      }
      return {
        index: segment.index,
        startSec: segment.startSec,
        endSec: segment.endSec,
        text: tailText,
        matchScore: 1,
        recognizedText: segment.text,
      }
    }

    const best = chooseBestSliceEnd(source.text, cursor, recognized)
    const endOrig = best.end - 1 < source.positions.length ? source.positions[best.end - 1] + 1 : canonicalText.length
    const cueText = trimCueText(canonicalText.slice(startOrig, endOrig))
    if (!cueText) {
      throw new Error(`SUBTITLE_ALIGNMENT_FAILED: cue text is empty for segment ${segment.index}`)
    }

    cursor = best.end
    return {
      index: segment.index,
      startSec: segment.startSec,
      endSec: segment.endSec,
      text: cueText,
      matchScore: best.score,
      recognizedText: segment.text,
    }
  })
}
