import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  getWavDurationMs,
  normalizeSceneDurations,
  sceneImageCandidates,
  type SceneDurationInput,
  subtitleCuesToAss,
  subtitleCuesToSrt,
} from '../src/lib/ffmpeg/story-video'
import {
  alignTimedSegmentsToCanonicalText,
  type TimedRecognitionSegment,
} from '../src/lib/ffmpeg/qwen-subtitle-timing'
import { resolveFfmpegPath } from '../src/lib/ffmpeg/resolve-ffmpeg'

type StoryPlan = {
  scenes: SceneDurationInput[]
}

type CliArgs = {
  runDir: string
  output: string
  fps: number
  width: number
  height: number
  fitMode: 'cover' | 'contain'
  qwenApiKey: string
}

function readArg(name: string): string | null {
  const index = process.argv.indexOf(name)
  if (index === -1) return null
  return process.argv[index + 1] || null
}

function toInt(value: string | null, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function parseArgs(): CliArgs {
  const runDir = readArg('--run-dir')
  if (!runDir) {
    throw new Error('Missing required arg: --run-dir <path>')
  }
  const output = readArg('--output') || path.join(runDir, '07_final_story_ffmpeg.mp4')
  const fitModeArg = (readArg('--fit-mode') || 'cover').trim().toLowerCase()
  if (fitModeArg !== 'cover' && fitModeArg !== 'contain') {
    throw new Error(`Invalid --fit-mode: ${fitModeArg}. Expected cover or contain.`)
  }
  return {
    runDir,
    output,
    fps: toInt(readArg('--fps'), 24),
    width: toInt(readArg('--width'), 1280),
    height: toInt(readArg('--height'), 720),
    fitMode: fitModeArg,
    qwenApiKey: readArg('--qwen-key') || process.env.QWEN_API_KEY || process.env.ALIYUN_API_KEY || '',
  }
}

function runFfmpeg(ffmpegPath: string, args: string[]) {
  const result = spawnSync(ffmpegPath, args, { encoding: 'utf8' })
  if (result.status !== 0) {
    const stderr = result.stderr.trim()
    throw new Error(`ffmpeg failed (${args.join(' ')}):\n${stderr.slice(-4000)}`)
  }
}

function escapeConcatPath(input: string): string {
  return input.replace(/'/g, "'\\''")
}

function resolveQwenSubtitlePython(): string {
  const explicit = process.env.QWEN_SUBTITLE_PYTHON?.trim()
  if (explicit) {
    if (!existsSync(explicit)) throw new Error(`QWEN_SUBTITLE_PYTHON does not exist: ${explicit}`)
    return explicit
  }

  const workspaceVenvPython = path.resolve('.venv-qwen3-asr-toolkit', 'bin', 'python')
  if (existsSync(workspaceVenvPython)) return workspaceVenvPython

  throw new Error(
    'Missing Qwen subtitle runtime: expected .venv-qwen3-asr-toolkit/bin/python or QWEN_SUBTITLE_PYTHON',
  )
}

function generateTimedSubtitleSegments(params: {
  runDir: string
  audioPath: string
  qwenApiKey: string
  ffmpegPath: string
}): TimedRecognitionSegment[] {
  if (!params.qwenApiKey) {
    throw new Error('Missing Qwen API key for subtitle timing (--qwen-key or QWEN_API_KEY or ALIYUN_API_KEY)')
  }

  const pythonPath = resolveQwenSubtitlePython()
  const outputJsonPath = path.join(params.runDir, '09_subtitles_qwen_segments.json')
  const scriptPath = path.resolve('scripts', 'generate-qwen-subtitle-timestamps.py')
  if (!existsSync(scriptPath)) throw new Error(`Subtitle timing script not found: ${scriptPath}`)

  const envPath = `${path.dirname(params.ffmpegPath)}:${process.env.PATH || ''}`
  const result = spawnSync(
    pythonPath,
    [
      scriptPath,
      '--audio-file',
      params.audioPath,
      '--output-json',
      outputJsonPath,
      '--api-key',
      params.qwenApiKey,
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: envPath,
      },
    },
  )
  if (result.status !== 0) {
    throw new Error(`qwen subtitle timing failed: ${result.stderr || result.stdout}`)
  }
  if (!existsSync(outputJsonPath)) {
    throw new Error(`qwen subtitle timing output missing: ${outputJsonPath}`)
  }

  const raw = JSON.parse(readFileSync(outputJsonPath, 'utf8')) as {
    segments?: unknown
  }
  const segmentsRaw = Array.isArray(raw.segments) ? raw.segments : []
  const segments: TimedRecognitionSegment[] = segmentsRaw.map((item, index) => {
    const row = item && typeof item === 'object' ? item as Record<string, unknown> : {}
    const startSec = typeof row.startSec === 'number' ? row.startSec : NaN
    const endSec = typeof row.endSec === 'number' ? row.endSec : NaN
    const text = typeof row.text === 'string' ? row.text.trim() : ''
    if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec || !text) {
      throw new Error(`Invalid timed subtitle segment at index ${index}`)
    }
    return {
      index: typeof row.index === 'number' && Number.isFinite(row.index) ? Math.floor(row.index) : index + 1,
      startSec,
      endSec,
      text,
    }
  })
  if (segments.length === 0) throw new Error('Qwen subtitle timing returned zero usable segments')
  return segments
}

function main() {
  const cli = parseArgs()
  const ffmpegPath = resolveFfmpegPath()
  const planPath = path.join(cli.runDir, '03_story_plan.json')
  const audioPath = path.join(cli.runDir, '05_narration.wav')
  const narrationPath = path.join(cli.runDir, '06_narration.txt')

  if (!existsSync(planPath)) throw new Error(`Missing plan file: ${planPath}`)
  if (!existsSync(audioPath)) throw new Error(`Missing audio file: ${audioPath}`)

  const rawPlan = readFileSync(planPath, 'utf8')
  const plan = JSON.parse(rawPlan) as StoryPlan
  if (!Array.isArray(plan.scenes) || plan.scenes.length === 0) {
    throw new Error('Invalid 03_story_plan.json: scenes is empty')
  }

  const wavBuffer = readFileSync(audioPath)
  const audioDurationMs = getWavDurationMs(wavBuffer)
  if (audioDurationMs === null) {
    throw new Error('Unable to read WAV duration from 05_narration.wav')
  }
  const audioDurationSec = audioDurationMs / 1000
  let subtitlePath: string | null = null
  let subtitleAssPath: string | null = null
  let subtitleTimingDebugPath: string | null = null
  if (existsSync(narrationPath)) {
    const narrationText = readFileSync(narrationPath, 'utf8').trim()
    if (narrationText.length > 0) {
      const timedSegments = generateTimedSubtitleSegments({
        runDir: cli.runDir,
        audioPath,
        qwenApiKey: cli.qwenApiKey,
        ffmpegPath,
      })
      const alignedCues = alignTimedSegmentsToCanonicalText(narrationText, timedSegments)
      subtitleTimingDebugPath = path.join(cli.runDir, '09_subtitles_alignment_debug.json')
      writeFileSync(subtitleTimingDebugPath, JSON.stringify({ cues: alignedCues }, null, 2), 'utf8')

      const srtText = `${subtitleCuesToSrt(alignedCues)}\n`
      subtitlePath = path.join(cli.runDir, '09_subtitles_auto.srt')
      writeFileSync(subtitlePath, srtText, 'utf8')

      subtitleAssPath = path.join(cli.runDir, '09_subtitles_auto.ass')
      const assText = subtitleCuesToAss(alignedCues, {
        playResX: cli.width,
        playResY: cli.height,
        maxCharsPerLine: 10,
        maxLines: 2,
      })
      writeFileSync(subtitleAssPath, assText, 'utf8')
    }
  }

  const sceneDurations = normalizeSceneDurations(plan.scenes, audioDurationSec)

  const sceneInputs = plan.scenes.map((scene, idx) => {
    const id = typeof scene.id === 'number' ? scene.id : idx + 1
    const image = sceneImageCandidates(cli.runDir, id).find((candidate) => existsSync(candidate))
    if (!image) {
      throw new Error(`Missing image for scene ${id} under ${path.join(cli.runDir, 'images')}`)
    }
    return { id, image, durationSec: sceneDurations[idx] }
  })

  const tempDir = mkdtempSync(path.join(tmpdir(), 'waoowaoo-ffmpeg-'))
  const clips: string[] = []

  try {
    for (const scene of sceneInputs) {
      const clipPath = path.join(tempDir, `scene_${String(scene.id).padStart(2, '0')}.mp4`)
      const vf = cli.fitMode === 'contain'
        ? `scale=${cli.width}:${cli.height}:force_original_aspect_ratio=decrease,pad=${cli.width}:${cli.height}:(ow-iw)/2:(oh-ih)/2:color=black,format=yuv420p`
        : `scale=${cli.width}:${cli.height}:force_original_aspect_ratio=increase,crop=${cli.width}:${cli.height},format=yuv420p`
      runFfmpeg(ffmpegPath, [
        '-y',
        '-loop',
        '1',
        '-framerate',
        String(cli.fps),
        '-i',
        scene.image,
        '-t',
        scene.durationSec.toFixed(3),
        '-vf',
        vf,
        '-r',
        String(cli.fps),
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-an',
        clipPath,
      ])
      clips.push(clipPath)
    }

    const concatListPath = path.join(tempDir, 'concat.txt')
    writeFileSync(
      concatListPath,
      clips.map((clip) => `file '${escapeConcatPath(clip)}'`).join('\n') + '\n',
      'utf8',
    )

    const silentVideoPath = path.join(tempDir, 'silent.mp4')
    runFfmpeg(ffmpegPath, [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      concatListPath,
      '-c',
      'copy',
      silentVideoPath,
    ])

    runFfmpeg(ffmpegPath, [
      '-y',
      '-i',
      silentVideoPath,
      '-i',
      audioPath,
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-shortest',
      cli.output,
    ])

    const manifestPath = path.join(cli.runDir, '07_ffmpeg_manifest.json')
    writeFileSync(
      manifestPath,
      JSON.stringify(
        {
          ffmpegPath,
          output: cli.output,
          audioDurationSec: Number(audioDurationSec.toFixed(3)),
          subtitlePath,
          subtitleAssPath,
          subtitleTimingDebugPath,
          subtitleMode: 'qwen_timed_canonical',
          subtitleBurnedIn: false,
          fps: cli.fps,
          fitMode: cli.fitMode,
          resolution: `${cli.width}x${cli.height}`,
          scenes: sceneInputs,
        },
        null,
        2,
      ),
      'utf8',
    )

    console.log(`FFmpeg compose done: ${cli.output}`)
    console.log(`Manifest: ${manifestPath}`)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

main()
