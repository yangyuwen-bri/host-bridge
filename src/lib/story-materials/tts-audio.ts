import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { resolveFfmpegPath } from '@/lib/ffmpeg/resolve-ffmpeg'

function escapeConcatPath(input: string): string {
  return input.replace(/'/g, "'\\''")
}

function runFfmpeg(ffmpegPath: string, args: string[]): void {
  const result = spawnSync(ffmpegPath, args, { encoding: 'utf8' })
  if (result.status !== 0) {
    const stderr = (result.stderr || result.stdout || '').trim()
    throw new Error(`FFMPEG_TTS_MERGE_FAILED: ${stderr.slice(-4000)}`)
  }
}

export function mergeTtsWavBuffers(chunks: Buffer[]): Buffer {
  if (chunks.length === 0) throw new Error('No wav chunks to merge')

  const tempDir = mkdtempSync(path.join(tmpdir(), 'waoowaoo-tts-merge-'))
  const ffmpegPath = resolveFfmpegPath()
  try {
    const normalizedPaths: string[] = []
    for (let index = 0; index < chunks.length; index += 1) {
      const rawPath = path.join(tempDir, `chunk_${index + 1}_raw.wav`)
      const normalizedPath = path.join(tempDir, `chunk_${index + 1}_normalized.wav`)
      writeFileSync(rawPath, chunks[index])
      runFfmpeg(ffmpegPath, [
        '-y',
        '-i',
        rawPath,
        '-c:a',
        'pcm_s16le',
        normalizedPath,
      ])
      normalizedPaths.push(normalizedPath)
    }

    if (normalizedPaths.length === 1) {
      const onlyPath = normalizedPaths[0]
      if (!existsSync(onlyPath)) throw new Error(`NORMALIZED_TTS_CHUNK_MISSING: ${onlyPath}`)
      return readFileSync(onlyPath)
    }

    const concatPath = path.join(tempDir, 'concat.txt')
    writeFileSync(
      concatPath,
      normalizedPaths.map((filePath) => `file '${escapeConcatPath(filePath)}'`).join('\n') + '\n',
      'utf8',
    )
    const mergedPath = path.join(tempDir, 'merged.wav')
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
      mergedPath,
    ])
    if (!existsSync(mergedPath)) throw new Error(`MERGED_TTS_WAV_MISSING: ${mergedPath}`)
    return readFileSync(mergedPath)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}
