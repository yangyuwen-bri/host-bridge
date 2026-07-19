import path from 'node:path'
import { publishStoryRelease } from '../src/lib/story-materials/release-publish'
import type { StoryReleaseStorageProvider } from '../src/lib/story-materials/release-manifest'

function readArg(flag: string): string | null {
  const index = process.argv.indexOf(flag)
  return index === -1 ? null : process.argv[index + 1] || null
}

function readProvider(value: string | null): StoryReleaseStorageProvider | undefined {
  if (!value) return undefined
  const providers: StoryReleaseStorageProvider[] = ['local', 'google-drive', 'cos', 'oss', 'r2']
  if (!providers.includes(value as StoryReleaseStorageProvider)) {
    throw new Error(`STORY_RELEASE_STORAGE_PROVIDER_INVALID: ${value}`)
  }
  return value as StoryReleaseStorageProvider
}

async function main(): Promise<void> {
  const runDir = readArg('--run-dir')
  if (!runDir) throw new Error('Missing required arg: --run-dir <path>')
  const manifest = await publishStoryRelease({
    workspaceRoot: process.cwd(),
    runDir: path.resolve(runDir),
    provider: readProvider(readArg('--provider')),
  })
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`)
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`STORY_RELEASE_PUBLISH_FAILED: ${message}\n`)
  process.exitCode = 1
})
