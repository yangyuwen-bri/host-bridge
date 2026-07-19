import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

export type FfmpegPathCandidates = {
  envPath: string | null
  imageioPath: string | null
  commandPath: string | null
}

function trimExecutablePath(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function resolveFromCommand(command: string): string | null {
  const result = spawnSync('bash', ['-lc', `command -v ${command}`], { encoding: 'utf8' })
  if (result.status !== 0) return null
  return trimExecutablePath(result.stdout)
}

function resolveImageioFfmpegPath(): string | null {
  const pythonResult = spawnSync(
    'python3',
    ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())'],
    { encoding: 'utf8' },
  )
  if (pythonResult.status !== 0) return null
  const fromPython = trimExecutablePath(pythonResult.stdout)
  return fromPython && existsSync(fromPython) ? fromPython : null
}

export function selectFfmpegPath(candidates: FfmpegPathCandidates): string {
  const envPath = trimExecutablePath(candidates.envPath)
  if (envPath) return envPath

  const imageioPath = trimExecutablePath(candidates.imageioPath)
  if (imageioPath) return imageioPath

  const commandPath = trimExecutablePath(candidates.commandPath)
  if (commandPath) return commandPath

  throw new Error('Unable to resolve ffmpeg path. Set FFMPEG_BIN or install ffmpeg.')
}

export function resolveFfmpegPath(): string {
  const envPath = trimExecutablePath(process.env.FFMPEG_BIN)
  if (envPath) {
    if (!existsSync(envPath)) {
      throw new Error(`FFMPEG_BIN does not exist: ${envPath}`)
    }
    return envPath
  }

  return selectFfmpegPath({
    envPath: null,
    imageioPath: resolveImageioFfmpegPath(),
    commandPath: resolveFromCommand('ffmpeg'),
  })
}
