import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  STORY_GENERATION_MODE,
  buildStoryGenerationCommandArgs,
  getStoryGenerationJobsStorePath,
  queryStoryGenerationJobs,
  resolveStorySourceFile,
  validateStoryId,
} from './generate'
import {
  DEFAULT_STORY_IMAGE_MODEL,
  DEFAULT_SCRIPT_MODEL_BY_PROVIDER,
  SCRIPT_MODEL_PROVIDER,
  parseStoryGenerationModelConfig,
} from './model-config'
import {
  DEFAULT_TTS_MODEL_VD,
  DEFAULT_TTS_VOICE_VD,
} from './tts-config'

function makeWorkspace(): string {
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'story-materials-generate-test-'))
  mkdirSync(path.join(workspaceRoot, 'materials', 'zhiguai', 'stories', 'zby-v01-001'), { recursive: true })
  mkdirSync(path.join(workspaceRoot, 'materials', 'zhiguai', 'ops'), { recursive: true })
  return workspaceRoot
}

describe('story materials generate helpers', () => {
  it('parses model config with provider-aware defaults', () => {
    const parsedDefault = parseStoryGenerationModelConfig({})
    expect(parsedDefault.scriptProvider).toBe(SCRIPT_MODEL_PROVIDER.QWEN)
    expect(parsedDefault.scriptModel).toBe(DEFAULT_SCRIPT_MODEL_BY_PROVIDER[SCRIPT_MODEL_PROVIDER.QWEN])
    expect(parsedDefault.imageModel).toBe(DEFAULT_STORY_IMAGE_MODEL)
    expect(parsedDefault.ttsModel).toBe(DEFAULT_TTS_MODEL_VD)
    expect(parsedDefault.ttsVoice).toBe(DEFAULT_TTS_VOICE_VD)

    const parsedGoogle = parseStoryGenerationModelConfig({
      scriptProvider: SCRIPT_MODEL_PROVIDER.GOOGLE,
    })
    expect(parsedGoogle.scriptModel).toBe('gemini-3-flash-preview-nothinking')
    expect(parsedGoogle.scriptModel).toBe(DEFAULT_SCRIPT_MODEL_BY_PROVIDER[SCRIPT_MODEL_PROVIDER.GOOGLE])
    expect(parsedGoogle.imageModel.length).toBeGreaterThan(0)
    expect(parsedGoogle.ttsModel.length).toBeGreaterThan(0)
    expect(parsedGoogle.ttsVoice.length).toBeGreaterThan(0)

    const parsedQwen = parseStoryGenerationModelConfig({
      scriptProvider: SCRIPT_MODEL_PROVIDER.QWEN,
      scriptModel: '',
    })
    expect(parsedQwen.scriptModel).toBe(DEFAULT_SCRIPT_MODEL_BY_PROVIDER[SCRIPT_MODEL_PROVIDER.QWEN])

    const parsedOpenAi = parseStoryGenerationModelConfig({
      scriptProvider: SCRIPT_MODEL_PROVIDER.OPENAI,
      scriptModel: '',
    })
    expect(parsedOpenAi.scriptModel).toBe('gemini-3-flash-preview-nothinking')
    expect(() => parseStoryGenerationModelConfig({ scriptProvider: 'foo' })).toThrow('INVALID_MODEL_CONFIG')
  })

  it('builds Aliyun-only story generation command without Google relay flags', () => {
    const command = buildStoryGenerationCommandArgs({
      storyFile: '/tmp/story/source.txt',
      runDir: '/tmp/story/run',
      hostOpening: '这是一段已经确认的主播开场，用来把热点自然引到故事。',
      modelConfig: parseStoryGenerationModelConfig({}),
    })

    expect(command).toContain('video:run-story-full-aliyun')
    expect(command).toContain('--llm-model')
    expect(command).toContain('deepseek-v4-flash')
    expect(command).toContain('--image-model')
    expect(command).toContain('qwen-image-2.0')
    expect(command).toContain('--host-opening')
    expect(command).toContain('这是一段已经确认的主播开场，用来把热点自然引到故事。')
    expect(command).not.toContain('video:run-story-full')
    expect(command).not.toContain('--script-provider')
  })

  it('validates and normalizes story id', () => {
    expect(validateStoryId('ZBY-V01-001')).toBe('zby-v01-001')
    expect(validateStoryId('LZZ-V01-001')).toBe('lzz-v01-001')
    expect(() => validateStoryId('abc')).toThrow('INVALID_STORY_ID')
  })

  it('resolves source file path from offline catalog', () => {
    const workspaceRoot = makeWorkspace()
    try {
      const catalogPath = path.join(workspaceRoot, 'materials', 'zhiguai', 'zhiguai_story_catalog_offline.csv')
      writeFileSync(
        catalogPath,
        [
          'id,title,volume,priority,hook_type,text_char_count,local_text_path',
          'zby-v01-001,李通判,子不语·卷1,S,异闻,980,stories/zby-v01-001/source.txt',
        ].join('\n'),
        'utf8',
      )
      const sourcePath = path.join(workspaceRoot, 'materials', 'zhiguai', 'stories', 'zby-v01-001', 'source.txt')
      writeFileSync(sourcePath, 'story', 'utf8')

      expect(resolveStorySourceFile(workspaceRoot, 'zby-v01-001')).toBe(sourcePath)
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('queries jobs with filters', () => {
    const workspaceRoot = makeWorkspace()
    try {
      const storePath = getStoryGenerationJobsStorePath(workspaceRoot)
      writeFileSync(
        storePath,
        JSON.stringify(
          {
            updatedAt: '2026-03-05T00:00:00.000Z',
            jobs: [
              {
                id: 'job-2',
                storyId: 'zby-v01-002',
                mode: STORY_GENERATION_MODE.CANONICAL_LONG,
                modelConfig: {
                  scriptProvider: SCRIPT_MODEL_PROVIDER.GOOGLE,
                  scriptModel: 'gemini-3-flash-preview',
                  imageModel: 'gemini-3.1-flash-image-preview',
                  ttsModel: 'qwen3-tts-instruct-flash',
                  ttsVoice: 'Cherry',
                },
                status: 'running',
                createdAt: '2026-03-05T00:00:02.000Z',
                startedAt: '2026-03-05T00:00:02.000Z',
                finishedAt: null,
                runDir: '/tmp/run2',
                logFile: '/tmp/run2/00_web_generate.log',
                releaseFile: null,
                command: ['npm', 'run'],
                error: null,
                exitCode: null,
                pid: process.pid,
              },
              {
                id: 'job-1',
                storyId: 'zby-v01-001',
                mode: STORY_GENERATION_MODE.CANONICAL_LONG,
                status: 'succeeded',
                createdAt: '2026-03-05T00:00:01.000Z',
                startedAt: '2026-03-05T00:00:01.000Z',
                finishedAt: '2026-03-05T00:10:00.000Z',
                runDir: '/tmp/run1',
                logFile: '/tmp/run1/00_web_generate.log',
                releaseFile: null,
                command: ['npm', 'run'],
                error: null,
                exitCode: 0,
              },
            ],
          },
          null,
          2,
        ),
        'utf8',
      )

      const all = queryStoryGenerationJobs({ workspaceRoot, limit: 10 })
      expect(all.length).toBe(2)
      expect(all[0].id).toBe('job-2')
      expect(all[0].modelConfig?.scriptProvider).toBe(SCRIPT_MODEL_PROVIDER.GOOGLE)
      expect(all[0].modelConfig?.ttsVoice).toBe('Cherry')
      expect(all[1].modelConfig).toBeNull()

      const runningOnly = queryStoryGenerationJobs({ workspaceRoot, runningOnly: true, limit: 10 })
      expect(runningOnly.length).toBe(1)
      expect(runningOnly[0].id).toBe('job-2')

      const oneStory = queryStoryGenerationJobs({ workspaceRoot, storyId: 'zby-v01-001', limit: 10 })
      expect(oneStory.length).toBe(1)
      expect(oneStory[0].id).toBe('job-1')
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('ignores malformed persisted generation jobs while keeping valid rows', () => {
    const workspaceRoot = makeWorkspace()
    try {
      const storePath = getStoryGenerationJobsStorePath(workspaceRoot)
      writeFileSync(
        storePath,
        JSON.stringify(
          {
            updatedAt: '2026-03-05T00:00:00.000Z',
            jobs: [
              null,
              { id: 'missing-story', mode: STORY_GENERATION_MODE.CANONICAL_LONG, status: 'queued' },
              {
                id: 'job-valid',
                storyId: 'zby-v01-005',
                mode: STORY_GENERATION_MODE.CANONICAL_LONG,
                modelConfig: null,
                status: 'queued',
                createdAt: '2026-03-05T00:00:05.000Z',
                startedAt: null,
                finishedAt: null,
                runDir: '/tmp/run5',
                logFile: '/tmp/run5/00_web_generate.log',
                releaseFile: null,
                command: ['npm', 'run'],
                error: null,
                exitCode: null,
              },
            ],
          },
          null,
          2,
        ),
        'utf8',
      )

      const rows = queryStoryGenerationJobs({ workspaceRoot, limit: 10 })
      expect(rows).toHaveLength(1)
      expect(rows[0].id).toBe('job-valid')
      expect(rows[0].storyId).toBe('zby-v01-005')
      expect(rows[0].modelConfig).toBeNull()
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('reconciles stale running jobs when process is gone', () => {
    const workspaceRoot = makeWorkspace()
    try {
      const runDirFailed = path.join(workspaceRoot, 'materials', 'zibuyu', 'runs', '20260301-000001-zby-v01-001-canonical-full')
      const runDirSucceeded = path.join(workspaceRoot, 'materials', 'zibuyu', 'runs', '20260301-000002-zby-v01-002-canonical-full')
      mkdirSync(runDirFailed, { recursive: true })
      mkdirSync(runDirSucceeded, { recursive: true })
      writeFileSync(path.join(runDirFailed, '00_pipeline.log'), 'step: generate character assets\n', 'utf8')
      writeFileSync(path.join(runDirFailed, '00_web_generate.log'), 'START command=npm run video:run-story-full\n', 'utf8')
      writeFileSync(path.join(runDirSucceeded, '00_pipeline.log'), 'pipeline done: /tmp/08_final_story.mp4\n', 'utf8')
      writeFileSync(path.join(runDirSucceeded, '00_web_generate.log'), 'START command=npm run video:run-story-full\n', 'utf8')
      writeFileSync(path.join(runDirSucceeded, '08_final_story.mp4'), 'video', 'utf8')

      const storePath = getStoryGenerationJobsStorePath(workspaceRoot)
      writeFileSync(
        storePath,
        JSON.stringify(
          {
            updatedAt: '2026-03-01T00:00:00.000Z',
            jobs: [
              {
                id: 'job-stale-failed',
                storyId: 'zby-v01-001',
                mode: STORY_GENERATION_MODE.CANONICAL_LONG,
                status: 'running',
                createdAt: '2026-03-01T00:00:01.000Z',
                startedAt: '2026-03-01T00:00:01.000Z',
                finishedAt: null,
                runDir: runDirFailed,
                logFile: path.join(runDirFailed, '00_web_generate.log'),
                releaseFile: null,
                command: ['npm', 'run'],
                error: null,
                exitCode: null,
                pid: 999999,
              },
              {
                id: 'job-stale-succeeded',
                storyId: 'zby-v01-002',
                mode: STORY_GENERATION_MODE.CANONICAL_LONG,
                status: 'running',
                createdAt: '2026-03-01T00:00:02.000Z',
                startedAt: '2026-03-01T00:00:02.000Z',
                finishedAt: null,
                runDir: runDirSucceeded,
                logFile: path.join(runDirSucceeded, '00_web_generate.log'),
                releaseFile: null,
                command: ['npm', 'run'],
                error: null,
                exitCode: null,
                pid: 999998,
              },
            ],
          },
          null,
          2,
        ),
        'utf8',
      )

      const all = queryStoryGenerationJobs({ workspaceRoot, limit: 10 })
      const failed = all.find((row) => row.id === 'job-stale-failed')
      const succeeded = all.find((row) => row.id === 'job-stale-succeeded')
      expect(failed?.status).toBe('failed')
      expect(failed?.error).toBe('STALE_PROCESS_NO_PID')
      expect(succeeded?.status).toBe('succeeded')
      expect(succeeded?.exitCode).toBe(0)

      const runningOnly = queryStoryGenerationJobs({ workspaceRoot, runningOnly: true, limit: 10 })
      expect(runningOnly.length).toBe(0)
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })
})
