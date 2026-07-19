import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  STORY_PUBLISH_COPY_SOURCE,
  generateStoryPublishCopy,
  getLatestStoryPublishCopy,
  queryStoryPublishCopies,
} from './publish-copy'

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}))

function makeWorkspace(): { workspaceRoot: string; runDir: string } {
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'story-materials-publish-copy-test-'))
  const runDir = path.join(workspaceRoot, 'materials', 'zibuyu', 'runs', '20260312-160559-zby-v01-007-canonical-full')
  mkdirSync(path.join(workspaceRoot, 'materials', 'zhiguai', 'ops'), { recursive: true })
  mkdirSync(runDir, { recursive: true })

  writeFileSync(
    path.join(workspaceRoot, 'materials', 'zhiguai', 'ops', 'story_materials_db.json'),
    JSON.stringify(
      {
        generatedAt: '2026-03-12T00:00:00.000Z',
        workspaceRoot,
        catalogPath: '',
        runsDir: '',
        dbPath: '',
        summary: {
          totalStories: 1,
          generatedStories: 1,
          pendingStories: 0,
          byPriority: {},
          byVolume: {},
        },
        records: [
          {
            id: 'zby-v01-007',
            title: '酆都知县',
            titleAliases: ['酆都知县'],
            volume: '子不语·卷1',
            priority: 'S',
            hookType: '异闻',
            textCharCount: 860,
            localTextPath: 'stories/zby-v01-007/source.txt',
            sourceFilePath: '',
            sourceCatalogPath: '',
            isGenerated: true,
            generatedCount: 1,
            latestGeneratedAt: '2026-03-12T00:00:00.000Z',
            latestAsset: {
              releaseFile: '',
              generatedAt: '2026-03-12T00:00:00.000Z',
              runDir,
              videoPath: path.join(runDir, '08_final_story.mp4'),
              hardSubVideoPath: null,
              softSubVideoPath: null,
              subtitlePath: null,
              coverPath: null,
              sourceKind: 'run_dir_scan',
              evidenceKind: 'run_dir_name',
            },
            hasReleaseManifest: false,
            hasRunSummary: true,
            generatedEvidence: ['run_dir_name'],
            videoCandidates: [path.join(runDir, '08_final_story.mp4')],
            dataQuality: 'legacy-run',
          },
        ],
        parseErrors: [],
      },
      null,
      2,
    ),
    'utf8',
  )

  writeFileSync(
    path.join(runDir, '03_story_plan.json'),
    JSON.stringify(
      {
        title: '酆都知县',
        scenes: [
          { id: 1, summary: '下井入幽冥', voiceOver: '刘纲夜探古井，误入阴司。' },
          { id: 2, summary: '阴司审案', voiceOver: '冤魂连连喊冤，旧案重启。' },
        ],
      },
      null,
      2,
    ),
    'utf8',
  )
  writeFileSync(path.join(runDir, '06_narration.txt'), '刘纲误入阴司，冤案层层翻出。', 'utf8')
  writeFileSync(path.join(runDir, '08_final_story.mp4'), 'video', 'utf8')

  return { workspaceRoot, runDir }
}

function mockDashscopeSuccess() {
  const execFileSyncMock = vi.mocked(execFileSync)
  execFileSyncMock.mockImplementation((file) => {
    if (file !== 'curl') return ''
    return JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              title: '子不语 酆都知县',
              hook: '一口古井，竟直通阴司。',
              content: '活人断不了的冤案，在阴司重审。包公与关帝先后现身，真相层层翻出。',
              hashtags: ['#子不语', '#酆都知县', '#志怪', '#古风悬疑'],
            }),
          },
        },
      ],
    })
  })
  return execFileSyncMock
}

function countCurlCalls(execFileSyncMock: ReturnType<typeof vi.mocked<typeof execFileSync>>): number {
  return execFileSyncMock.mock.calls.filter((call) => call[0] === 'curl').length
}

function findFirstCurlCall(execFileSyncMock: ReturnType<typeof vi.mocked<typeof execFileSync>>) {
  return execFileSyncMock.mock.calls.find((call) => call[0] === 'curl') || null
}

afterEach(() => {
  vi.clearAllMocks()
  delete process.env.QWEN_API_KEY
  delete process.env.ALIYUN_API_KEY
  delete process.env.HTTP_PROXY
  delete process.env.HTTPS_PROXY
  delete process.env.ALL_PROXY
  delete process.env.http_proxy
  delete process.env.https_proxy
  delete process.env.all_proxy
})

describe('story publish copy', () => {
  it('generates and persists publish copy for a run', async () => {
    const { workspaceRoot, runDir } = makeWorkspace()
    const execFileSyncMock = mockDashscopeSuccess()
    process.env.QWEN_API_KEY = 'test-key'

    try {
      const record = await generateStoryPublishCopy({
        workspaceRoot,
        storyId: 'zby-v01-007',
        runDir,
        model: 'qwen3-max',
        source: STORY_PUBLISH_COPY_SOURCE.MANUAL,
      })

      expect(record.storyId).toBe('zby-v01-007')
      expect(record.runDir).toBe(runDir)
      expect(record.title).toBe('子不语 酆都知县')
      expect(record.body).toContain('#子不语')
      expect(countCurlCalls(execFileSyncMock)).toBe(1)

      const latest = getLatestStoryPublishCopy(workspaceRoot, 'zby-v01-007')
      expect(latest?.id).toBe(record.id)
      expect(latest?.model).toBe('qwen3-max')
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('reuses same-run copy when force is false', async () => {
    const { workspaceRoot, runDir } = makeWorkspace()
    const execFileSyncMock = mockDashscopeSuccess()
    process.env.QWEN_API_KEY = 'test-key'

    try {
      const first = await generateStoryPublishCopy({
        workspaceRoot,
        storyId: 'zby-v01-007',
        runDir,
        model: 'qwen3-max',
        source: STORY_PUBLISH_COPY_SOURCE.MANUAL,
      })
      const second = await generateStoryPublishCopy({
        workspaceRoot,
        storyId: 'zby-v01-007',
        runDir,
        model: 'qwen3-max',
        source: STORY_PUBLISH_COPY_SOURCE.AUTO_ON_VIDEO_SUCCESS,
        force: false,
      })

      expect(second.id).toBe(first.id)
      expect(countCurlCalls(execFileSyncMock)).toBe(1)
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('supports latest-by-story query', async () => {
    const { workspaceRoot, runDir } = makeWorkspace()
    const execFileSyncMock = mockDashscopeSuccess()
    process.env.QWEN_API_KEY = 'test-key'

    try {
      await generateStoryPublishCopy({
        workspaceRoot,
        storyId: 'zby-v01-007',
        runDir,
        model: 'qwen3-max',
        source: STORY_PUBLISH_COPY_SOURCE.MANUAL,
      })

      const secondRun = path.join(workspaceRoot, 'materials', 'zibuyu', 'runs', '20260313-010101-zby-v01-007-canonical-full')
      mkdirSync(secondRun, { recursive: true })
      writeFileSync(
        path.join(secondRun, '03_story_plan.json'),
        JSON.stringify({
          title: '酆都知县',
          scenes: [{ id: 1, summary: '重跑版本', voiceOver: '新的版本文本。' }],
        }),
        'utf8',
      )
      writeFileSync(path.join(secondRun, '06_narration.txt'), '新的版本文本。', 'utf8')
      writeFileSync(path.join(secondRun, '08_final_story.mp4'), 'video', 'utf8')

      await generateStoryPublishCopy({
        workspaceRoot,
        storyId: 'zby-v01-007',
        runDir: secondRun,
        model: 'qwen3-max',
        source: STORY_PUBLISH_COPY_SOURCE.MANUAL,
        force: true,
      })

      const latestRows = queryStoryPublishCopies({
        workspaceRoot,
        latestByStory: true,
        limit: 10,
      })
      expect(latestRows.length).toBe(1)
      expect(latestRows[0].storyId).toBe('zby-v01-007')
      expect(countCurlCalls(execFileSyncMock)).toBe(2)
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('rejects traditional chinese publish copy payloads', async () => {
    const { workspaceRoot, runDir } = makeWorkspace()
    const execFileSyncMock = vi.mocked(execFileSync)
    process.env.QWEN_API_KEY = 'test-key'
    execFileSyncMock.mockReturnValue(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: '子不语 酆都知縣',
                hook: '一口古井，竟直通陰司。',
                content: '活人斷不了的冤案，在陰司重審。包公與關帝先後現身，真相層層翻出。',
                hashtags: ['#子不语', '#酆都知縣', '#志怪', '#古風懸疑'],
              }),
            },
          },
        ],
      }),
    )

    try {
      await expect(generateStoryPublishCopy({
        workspaceRoot,
        storyId: 'zby-v01-007',
        runDir,
        model: 'qwen3-max',
        source: STORY_PUBLISH_COPY_SOURCE.MANUAL,
      })).rejects.toThrowError('COPY_TITLE_NOT_SIMPLIFIED_CHINESE')
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('retries when first response is traditional chinese and accepts simplified retry', async () => {
    const { workspaceRoot, runDir } = makeWorkspace()
    const execFileSyncMock = vi.mocked(execFileSync)
    process.env.QWEN_API_KEY = 'test-key'
    const curlResponses = [
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: '子不语 酆都知縣',
                hook: '一口古井，竟直通陰司。',
                content: '活人斷不了的冤案，在陰司重審。',
                hashtags: ['#子不语', '#酆都知縣', '#志怪', '#古風懸疑'],
              }),
            },
          },
        ],
      }),
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: '子不语 酆都知县',
                hook: '一口古井，竟直通阴司。',
                content: '活人断不了的冤案，在阴司重审。',
                hashtags: ['#子不语', '#酆都知县', '#志怪', '#古风悬疑'],
              }),
            },
          },
        ],
      }),
    ]
    execFileSyncMock.mockImplementation((file) => {
      if (file !== 'curl') return ''
      const response = curlResponses.shift()
      if (!response) throw new Error('UNEXPECTED_EXTRA_CURL_CALL')
      return response
    })

    try {
      const record = await generateStoryPublishCopy({
        workspaceRoot,
        storyId: 'zby-v01-007',
        runDir,
        model: 'qwen3-max',
        source: STORY_PUBLISH_COPY_SOURCE.MANUAL,
      })

      expect(record.title).toBe('子不语 酆都知县')
      expect(record.content).toBe('活人断不了的冤案，在阴司重审。')
      expect(countCurlCalls(execFileSyncMock)).toBe(2)
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('passes resolved proxy environment to DashScope curl requests', async () => {
    const { workspaceRoot, runDir } = makeWorkspace()
    const execFileSyncMock = mockDashscopeSuccess()
    process.env.QWEN_API_KEY = 'test-key'
    process.env.HTTPS_PROXY = 'http://proxy.example:8080'

    try {
      await generateStoryPublishCopy({
        workspaceRoot,
        storyId: 'zby-v01-007',
        runDir,
        model: 'qwen3-max',
        source: STORY_PUBLISH_COPY_SOURCE.MANUAL,
      })

      const call = findFirstCurlCall(execFileSyncMock)
      expect(call).not.toBeNull()
      if (!call) throw new Error('CURL_CALL_NOT_FOUND')
      const options = call[2]
      expect(options).toMatchObject({
        env: expect.objectContaining({
          HTTPS_PROXY: 'http://proxy.example:8080',
          https_proxy: 'http://proxy.example:8080',
        }),
      })
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })
})
