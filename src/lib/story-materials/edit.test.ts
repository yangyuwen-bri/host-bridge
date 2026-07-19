import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildAndPersistStoryMaterialsDatabase } from './db'
import { getStoryEditDetail, normalizeStoryVoiceoverText, queryStoryVoiceoverEditJobs } from './edit'

function makeWorkspace(): string {
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'story-materials-edit-test-'))
  mkdirSync(path.join(workspaceRoot, 'materials', 'zhiguai', 'ops'), { recursive: true })
  mkdirSync(path.join(workspaceRoot, 'materials', 'zibuyu', 'runs'), { recursive: true })
  return workspaceRoot
}

describe('story materials edit detail', () => {
  it('normalizes edited voiceover text to simplified chinese', () => {
    expect(normalizeStoryVoiceoverText('  陳秀才見著怪石，心裡發寒。  ')).toBe('陈秀才见着怪石，心里发寒。')
  })

  it('loads active run detail and initializes JSON version index', () => {
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

      const runDir = path.join(workspaceRoot, 'materials', 'zibuyu', 'runs', '20260305-000001-zby-v01-001-canonical-full')
      mkdirSync(path.join(runDir, 'images'), { recursive: true })
      writeFileSync(path.join(runDir, 'images', 'scene_01.png'), 'img1', 'utf8')
      writeFileSync(path.join(runDir, 'images', 'scene_02.png'), 'img2', 'utf8')
      writeFileSync(path.join(runDir, '08_final_story.mp4'), 'video', 'utf8')
      writeFileSync(
        path.join(runDir, '03_story_plan.json'),
        JSON.stringify(
          {
            title: '李通判',
            scenes: [
              { id: 1, summary: '开端', voiceOver: '第一段旁白' },
              { id: 2, summary: '转折', voiceOver: '第二段旁白' },
            ],
          },
          null,
          2,
        ),
        'utf8',
      )
      writeFileSync(
        path.join(runDir, '00_run_summary.json'),
        JSON.stringify(
          {
            storySource: path.join(workspaceRoot, 'materials', 'zhiguai', 'stories', 'zby-v01-001', 'source.txt'),
            generatedAt: '2026-03-05T00:00:01.000Z',
            output: {
              runDir,
              video: path.join(runDir, '08_final_story.mp4'),
            },
          },
          null,
          2,
        ),
        'utf8',
      )

      buildAndPersistStoryMaterialsDatabase({ workspaceRoot })
      const detail = getStoryEditDetail(workspaceRoot, 'zby-v01-001')
      expect(detail.storyId).toBe('zby-v01-001')
      expect(detail.activeRunDir).toBe(runDir)
      expect(detail.scenes.length).toBe(2)
      expect(detail.scenes[0].voiceOver).toBe('第一段旁白')
      expect(detail.scenes[0].imagePath).toBe(path.join(runDir, 'images', 'scene_01.png'))
      expect(detail.versions.length).toBe(1)
      expect(detail.versions[0].source).toBe('generated_base')

      const versionIndexPath = path.join(workspaceRoot, 'materials', 'zhiguai', 'ops', 'story_materials_versions.json')
      expect(existsSync(versionIndexPath)).toBe(true)
      const persisted = JSON.parse(readFileSync(versionIndexPath, 'utf8')) as {
        stories: Record<string, { activeVersionId: string }>
      }
      expect(persisted.stories['zby-v01-001'].activeVersionId.length).toBeGreaterThan(0)
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('ignores malformed persisted voiceover edit jobs while keeping valid rows', () => {
    const workspaceRoot = makeWorkspace()
    try {
      const storePath = path.join(workspaceRoot, 'materials', 'zhiguai', 'ops', 'story_materials_voiceover_jobs.json')
      writeFileSync(
        storePath,
        JSON.stringify(
          {
            updatedAt: '2026-03-05T00:00:00.000Z',
            jobs: [
              null,
              { id: 'missing-source', storyId: 'zby-v01-001', status: 'queued' },
              {
                id: 'voice-job-valid',
                storyId: 'zby-v01-004',
                status: 'running',
                createdAt: '2026-03-05T00:00:04.000Z',
                startedAt: '2026-03-05T00:00:04.000Z',
                finishedAt: null,
                sourceRunDir: '/tmp/source4',
                outputRunDir: '/tmp/output4',
                parentVersionId: 'v1',
                outputVersionId: 'v2',
                logFile: '/tmp/output4/log',
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

      const rows = queryStoryVoiceoverEditJobs({ workspaceRoot, runningOnly: true, limit: 10 })
      expect(rows).toHaveLength(1)
      expect(rows[0].id).toBe('voice-job-valid')
      expect(rows[0].storyId).toBe('zby-v01-004')
      expect(rows[0].sourceRunDir).toBe('/tmp/source4')
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })
})
