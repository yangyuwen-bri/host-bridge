import { describe, expect, it } from 'vitest'
import { buildStoryMaterialsDashboard, classifyStoryMaterial } from './dashboard'
import type { StoryMaterialRecord } from './types'

function record(overrides: Partial<StoryMaterialRecord>): StoryMaterialRecord {
  return {
    id: 'zby-v01-001',
    title: '默认故事',
    titleAliases: [],
    volume: '子不语·卷1',
    priority: 'B',
    hookType: '',
    textCharCount: 500,
    localTextPath: '/tmp/source.txt',
    sourceFilePath: '/tmp/source.txt',
    sourceCatalogPath: '/tmp/catalog.csv',
    isGenerated: false,
    generatedCount: 0,
    latestGeneratedAt: null,
    latestAsset: null,
    hasReleaseManifest: false,
    hasRunSummary: false,
    generatedEvidence: [],
    videoCandidates: [],
    dataQuality: 'pending',
    ...overrides,
  }
}

describe('story materials dashboard', () => {
  it('classifies justice and social topics from story metadata', () => {
    const theme = classifyStoryMaterial(record({ title: '雷誅營卒', hookType: '古代社会新闻' }))

    expect(theme.id).toBe('social')
    expect(theme.label).toBe('社会民生')
  })

  it('builds funnel, heatmap rows, and recommendations from concrete records', () => {
    const rows = [
      record({
        id: 'zby-v04-017',
        title: '雷誅營卒',
        volume: '子不语·卷4',
        priority: 'S',
        hookType: '古代社会新闻',
        textCharCount: 515,
      }),
      record({
        id: 'zby-v22-021',
        title: '鬼送汤圆',
        volume: '子不语·卷22',
        priority: 'A',
        isGenerated: true,
        generatedCount: 1,
        latestAsset: {
          releaseFile: '',
          generatedAt: '2026-06-27T00:17:44.000Z',
          runDir: '/tmp/run',
          videoPath: '/tmp/run/08_final_story.mp4',
          hardSubVideoPath: '/tmp/run/10_final_story_hardsub.mp4',
          softSubVideoPath: null,
          subtitlePath: '/tmp/run/09_subtitles_auto.srt',
          coverPath: null,
          sourceKind: 'run_summary',
          evidenceKind: 'run_dir_name',
        },
        hasRunSummary: true,
        dataQuality: 'clean',
      }),
    ]

    const dashboard = buildStoryMaterialsDashboard(rows)

    expect(dashboard.funnel.total).toBe(2)
    expect(dashboard.funnel.generated).toBe(1)
    expect(dashboard.funnel.pending).toBe(1)
    expect(dashboard.funnel.withHardSub).toBe(1)
    expect(dashboard.volumeRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ volume: '子不语·卷4', total: 1, pending: 1, sCount: 1 }),
    ]))
    expect(dashboard.recommendations[0]?.record.id).toBe('zby-v04-017')
    expect(dashboard.recommendations[0]?.reason).toContain('未生产')
  })
})
