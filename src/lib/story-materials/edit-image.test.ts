import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  getStorySceneImageEditJobsStorePath,
  queryStorySceneImageEditJobs,
} from './edit-image'

function makeWorkspace(): string {
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'story-materials-edit-image-test-'))
  mkdirSync(path.join(workspaceRoot, 'materials', 'zhiguai', 'ops'), { recursive: true })
  return workspaceRoot
}

describe('story scene image edit jobs', () => {
  it('queries jobs with filters', () => {
    const workspaceRoot = makeWorkspace()
    try {
      const storePath = getStorySceneImageEditJobsStorePath(workspaceRoot)
      writeFileSync(
        storePath,
        JSON.stringify(
          {
            updatedAt: '2026-03-05T00:00:00.000Z',
            jobs: [
              {
                id: 'job-2',
                storyId: 'zby-v01-002',
                sceneId: 3,
                status: 'running',
                createdAt: '2026-03-05T00:00:02.000Z',
                startedAt: '2026-03-05T00:00:02.000Z',
                finishedAt: null,
                sourceRunDir: '/tmp/source2',
                outputRunDir: '/tmp/output2',
                parentVersionId: 'v1',
                outputVersionId: 'v2',
                logFile: '/tmp/output2/log',
                command: ['npm', 'run'],
                modelConfig: {
                  scriptProvider: 'google',
                  scriptModel: 'gemini-3-flash-preview',
                  imageModel: 'gemini-3.1-flash-image-preview',
                  ttsModel: 'qwen3-tts-vd-2026-01-26',
                  ttsVoice: 'qwen-tts-vd-voiceA1-voice-20260301150457775-1b59',
                },
                error: null,
                exitCode: null,
              },
              {
                id: 'job-1',
                storyId: 'zby-v01-001',
                sceneId: 1,
                status: 'succeeded',
                createdAt: '2026-03-05T00:00:01.000Z',
                startedAt: '2026-03-05T00:00:01.000Z',
                finishedAt: '2026-03-05T00:10:00.000Z',
                sourceRunDir: '/tmp/source1',
                outputRunDir: '/tmp/output1',
                parentVersionId: 'v1',
                outputVersionId: 'v2',
                logFile: '/tmp/output1/log',
                command: ['npm', 'run'],
                modelConfig: {
                  scriptProvider: 'google',
                  scriptModel: 'gemini-3-flash-preview',
                  imageModel: 'gemini-3.1-flash-image-preview',
                  ttsModel: 'qwen3-tts-vd-2026-01-26',
                  ttsVoice: 'qwen-tts-vd-voiceA1-voice-20260301150457775-1b59',
                },
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

      const all = queryStorySceneImageEditJobs({ workspaceRoot, limit: 10 })
      expect(all.length).toBe(2)
      expect(all[0].id).toBe('job-2')
      expect(all[0].sceneId).toBe(3)

      const runningOnly = queryStorySceneImageEditJobs({ workspaceRoot, runningOnly: true, limit: 10 })
      expect(runningOnly.length).toBe(1)
      expect(runningOnly[0].id).toBe('job-2')

      const oneStory = queryStorySceneImageEditJobs({ workspaceRoot, storyId: 'zby-v01-001', limit: 10 })
      expect(oneStory.length).toBe(1)
      expect(oneStory[0].id).toBe('job-1')
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('ignores malformed persisted image edit jobs while keeping valid rows', () => {
    const workspaceRoot = makeWorkspace()
    try {
      const storePath = getStorySceneImageEditJobsStorePath(workspaceRoot)
      writeFileSync(
        storePath,
        JSON.stringify(
          {
            updatedAt: '2026-03-05T00:00:00.000Z',
            jobs: [
              null,
              { id: 'missing-story', status: 'queued' },
              {
                id: 'job-valid',
                storyId: 'zby-v01-003',
                sceneId: 2,
                status: 'queued',
                createdAt: '2026-03-05T00:00:03.000Z',
                startedAt: null,
                finishedAt: null,
                sourceRunDir: '/tmp/source3',
                outputRunDir: '/tmp/output3',
                parentVersionId: 'v1',
                outputVersionId: 'v2',
                logFile: '/tmp/output3/log',
                command: ['npm', 'run'],
                modelConfig: {
                  scriptProvider: 'google',
                  scriptModel: 'gemini-3-flash-preview',
                  imageModel: 'gemini-3.1-flash-image-preview',
                  ttsModel: 'qwen3-tts-vd-2026-01-26',
                  ttsVoice: 'qwen-tts-vd-voiceA1-voice-20260301150457775-1b59',
                },
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

      const rows = queryStorySceneImageEditJobs({ workspaceRoot, limit: 10 })
      expect(rows).toHaveLength(1)
      expect(rows[0].id).toBe('job-valid')
      expect(rows[0].storyId).toBe('zby-v01-003')
      expect(rows[0].sceneId).toBe(2)
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })
})
