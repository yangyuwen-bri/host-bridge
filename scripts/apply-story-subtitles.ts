import { existsSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { resolveDefaultHardSubtitleFile, resolveDefaultSoftSubtitleFile } from '../src/lib/ffmpeg/subtitle-artifacts'
import { buildSubtitleFilter } from '../src/lib/ffmpeg/subtitle-render'
import { resolveFfmpegPath } from '../src/lib/ffmpeg/resolve-ffmpeg'

type CliArgs = {
  runDir: string
  baseVideo: string
  subtitleFile: string
  softSubtitleFile: string
  hardOutput: string
  softOutput: string
}

function readArg(name: string): string | null {
  const index = process.argv.indexOf(name)
  if (index === -1) return null
  return process.argv[index + 1] || null
}

function parseArgs(): CliArgs {
  const runDirArg = readArg('--run-dir')
  if (!runDirArg) throw new Error('Missing required arg: --run-dir <path>')
  const runDir = path.resolve(runDirArg)

  const baseVideo = path.resolve(readArg('--base-video') || path.join(runDir, '08_final_story.mp4'))
  const subtitleFile = path.resolve(readArg('--subtitle') || resolveDefaultHardSubtitleFile(runDir))
  const softSubtitleFile = path.resolve(readArg('--soft-subtitle') || resolveDefaultSoftSubtitleFile(runDir))
  const hardOutput = path.resolve(readArg('--hard-output') || path.join(runDir, '10_final_story_hardsub.mp4'))
  const softOutput = path.resolve(readArg('--soft-output') || path.join(runDir, '10_final_story_softsub.mp4'))

  return { runDir, baseVideo, subtitleFile, softSubtitleFile, hardOutput, softOutput }
}

function runFfmpeg(ffmpegPath: string, args: string[]) {
  const result = spawnSync(ffmpegPath, args, { encoding: 'utf8' })
  if (result.status !== 0) {
    const stderr = result.stderr.trim()
    throw new Error(`ffmpeg failed (${args.join(' ')}):\n${stderr.slice(-4000)}`)
  }
}

function main() {
  const args = parseArgs()
  if (!existsSync(args.baseVideo)) throw new Error(`Base video not found: ${args.baseVideo}`)
  if (!existsSync(args.subtitleFile)) throw new Error(`Subtitle file not found: ${args.subtitleFile}`)
  if (!existsSync(args.softSubtitleFile)) throw new Error(`Soft subtitle file not found: ${args.softSubtitleFile}`)

  const ffmpegPath = resolveFfmpegPath()
  const subtitleFilter = buildSubtitleFilter(args.subtitleFile)

  runFfmpeg(ffmpegPath, [
    '-y',
    '-i',
    args.baseVideo,
    '-vf',
    subtitleFilter,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'copy',
    args.hardOutput,
  ])

  runFfmpeg(ffmpegPath, [
    '-y',
    '-i',
    args.baseVideo,
    '-i',
    args.softSubtitleFile,
    '-c:v',
    'copy',
    '-c:a',
    'copy',
    '-c:s',
    'mov_text',
    '-metadata:s:s:0',
    'language=chi',
    args.softOutput,
  ])

  console.log(`Subtitle render done:`)
  console.log(`- base: ${args.baseVideo}`)
  console.log(`- hard subtitle: ${args.subtitleFile}`)
  console.log(`- soft subtitle: ${args.softSubtitleFile}`)
  console.log(`- hard: ${args.hardOutput}`)
  console.log(`- soft: ${args.softOutput}`)
  console.log(`- runDir: ${args.runDir}`)
}

main()
