import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildAndPersistStoryMaterialsDatabase } from './db'
import { parseCsvToObjects } from './csv'

function makeTempWorkspace(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'story-materials-test-'))
  mkdirSync(path.join(root, 'materials', 'zhiguai'), { recursive: true })
  mkdirSync(path.join(root, 'materials', 'zibuyu', 'runs'), { recursive: true })
  return root
}

describe('story materials database', () => {
  it('merges release packages, run summaries and run dirs into generated status', () => {
    const workspaceRoot = makeTempWorkspace()
    try {
      const catalogPath = path.join(workspaceRoot, 'materials', 'zhiguai', 'zhiguai_story_catalog_offline.csv')
      const csv = [
        'id,title,volume,priority,hook_type,text_char_count,local_text_path',
        'zby-v01-001,李通判,子不语·卷1,S,异闻,980,stories/zby-v01-001/source.txt',
        'zby-v01-002,蔡書生,子不语·卷1,A,异闻,178,stories/zby-v01-002/source.txt',
      ].join('\n')
      writeFileSync(catalogPath, csv, 'utf8')

      const releasePath = path.join(
        workspaceRoot,
        'materials',
        'zibuyu',
        'runs',
        '20260305-000001-zby-v01-001-release-package.json',
      )
      const runDir = path.join(workspaceRoot, 'materials', 'zibuyu', 'runs', '20260305-000001-zby-v01-001-canonical-full')
      const releasePayload = {
        generated_at: '2026-03-05T00:00:01.000Z',
        story_selector: { story_id: 'zby-v01-001' },
        runs: [
          {
            tag: 'canonical',
            run_dir: runDir,
            video: `${runDir}/08_final_story.mp4`,
            hard_sub_video: `${runDir}/10_final_story_hardsub.mp4`,
            soft_sub_video: `${runDir}/10_final_story_softsub.mp4`,
            subtitle: `${runDir}/09_subtitles_canonical_auto.srt`,
          },
        ],
      }
      writeFileSync(releasePath, JSON.stringify(releasePayload, null, 2), 'utf8')
      mkdirSync(runDir, { recursive: true })
      writeFileSync(path.join(runDir, '08_final_story.mp4'), 'video', 'utf8')
      writeFileSync(path.join(runDir, '10_final_story_hardsub.mp4'), 'hardsub', 'utf8')
      writeFileSync(path.join(runDir, '10_final_story_softsub.mp4'), 'softsub', 'utf8')
      writeFileSync(path.join(runDir, '09_subtitles_canonical_auto.srt'), 'subtitle', 'utf8')

      const legacyReleasePath = path.join(
        workspaceRoot,
        'materials',
        'zibuyu',
        'runs',
        '20260301-022621-zby-v01-002-release-package.json',
      )
      const legacyReleasePayload = {
        generated_at: '2026-03-01T02:26:21.145862Z',
        story_source: `${workspaceRoot}/materials/zibuyu/library/zby-v01-002.txt`,
        runs: [],
      }
      writeFileSync(legacyReleasePath, JSON.stringify(legacyReleasePayload, null, 2), 'utf8')

      const legacyRunDir = path.join(workspaceRoot, 'materials', 'zibuyu', 'runs', '20260301-153344-zby-v01-002-aliyun-full')
      mkdirSync(legacyRunDir, { recursive: true })
      writeFileSync(path.join(legacyRunDir, '08_final_story.mp4'), 'video', 'utf8')
      writeFileSync(path.join(legacyRunDir, '10_final_story_hardsub.mp4'), 'hardsub', 'utf8')
      writeFileSync(path.join(legacyRunDir, '10_final_story_softsub.mp4'), 'softsub', 'utf8')
      writeFileSync(path.join(legacyRunDir, '09_subtitles_auto.srt'), 'subtitle', 'utf8')

      const summaryPayload = {
        storySource: `${workspaceRoot}/materials/zibuyu/library/zby-v01-002.txt`,
        generatedAt: '2026-03-01T07:47:50.923Z',
        output: {
          runDir: legacyRunDir,
          video: `${legacyRunDir}/08_final_story.mp4`,
          hard_sub_video: `${legacyRunDir}/10_final_story_hardsub.mp4`,
          soft_sub_video: `${legacyRunDir}/10_final_story_softsub.mp4`,
          subtitle: `${legacyRunDir}/09_subtitles_auto.srt`,
        },
      }
      writeFileSync(path.join(legacyRunDir, '00_run_summary.json'), JSON.stringify(summaryPayload, null, 2), 'utf8')

      const result = buildAndPersistStoryMaterialsDatabase({ workspaceRoot })
      expect(result.database.summary.totalStories).toBe(2)
      expect(result.database.summary.generatedStories).toBe(2)
      expect(result.database.summary.pendingStories).toBe(0)

      const generated = result.database.records.find((item) => item.id === 'zby-v01-001')
      expect(generated?.isGenerated).toBe(true)
      expect(generated?.latestAsset?.videoPath).toBe(`${runDir}/08_final_story.mp4`)
      expect(generated?.latestAsset?.hardSubVideoPath).toBe(`${runDir}/10_final_story_hardsub.mp4`)
      expect(generated?.latestAsset?.softSubVideoPath).toBe(`${runDir}/10_final_story_softsub.mp4`)
      expect(generated?.latestAsset?.subtitlePath).toBe(`${runDir}/09_subtitles_canonical_auto.srt`)
      expect(generated?.hasReleaseManifest).toBe(true)
      expect(generated?.generatedEvidence).toContain('release_selector')

      const legacyGenerated = result.database.records.find((item) => item.id === 'zby-v01-002')
      expect(legacyGenerated?.isGenerated).toBe(true)
      expect(legacyGenerated?.hasReleaseManifest).toBe(true)
      expect(legacyGenerated?.hasRunSummary).toBe(true)
      expect(legacyGenerated?.generatedEvidence).toContain('release_story_source')
      expect(legacyGenerated?.generatedEvidence).toContain('run_summary_story_source')
      expect(legacyGenerated?.latestAsset?.videoPath).toBe(`${legacyRunDir}/08_final_story.mp4`)
      expect(legacyGenerated?.latestAsset?.hardSubVideoPath).toBe(`${legacyRunDir}/10_final_story_hardsub.mp4`)
      expect(legacyGenerated?.latestAsset?.softSubVideoPath).toBe(`${legacyRunDir}/10_final_story_softsub.mp4`)
      expect(legacyGenerated?.latestAsset?.subtitlePath).toBe(`${legacyRunDir}/09_subtitles_auto.srt`)
      expect(legacyGenerated?.dataQuality).toBe('clean')

      expect(existsSync(result.persistedTo)).toBe(true)
      const persisted = JSON.parse(readFileSync(result.persistedTo, 'utf8')) as { records: Array<{ id: string }> }
      expect(persisted.records.length).toBe(2)
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('parses quoted csv fields with commas', () => {
    const rows = parseCsvToObjects([
      'id,title,volume',
      's1,"标题,带逗号","卷1"',
    ].join('\n'))
    expect(rows.length).toBe(1)
    expect(rows[0].title).toBe('标题,带逗号')
  })

  it('recognizes non-zby story ids from run directories', () => {
    const workspaceRoot = makeTempWorkspace()
    try {
      const catalogPath = path.join(workspaceRoot, 'materials', 'zhiguai', 'zhiguai_story_catalog_offline.csv')
      const csv = [
        'id,title,volume,priority,hook_type,text_char_count,local_text_path',
        'lzz-v01-001,考城隍,聊斋志异·卷1,B,异闻,590,stories/lzz-v01-001/source.txt',
      ].join('\n')
      writeFileSync(catalogPath, csv, 'utf8')

      const runDir = path.join(workspaceRoot, 'materials', 'zibuyu', 'runs', '20260305-000001-lzz-v01-001-canonical-full')
      mkdirSync(runDir, { recursive: true })
      writeFileSync(path.join(runDir, '08_final_story.mp4'), Buffer.alloc(1_200_000))
      writeFileSync(path.join(runDir, '10_final_story_hardsub.mp4'), Buffer.alloc(1_350_000))
      writeFileSync(path.join(runDir, '10_final_story_softsub.mp4'), Buffer.alloc(1_220_000))
      writeFileSync(path.join(runDir, '09_subtitles_auto.srt'), 'subtitle', 'utf8')

      const result = buildAndPersistStoryMaterialsDatabase({ workspaceRoot })
      const record = result.database.records.find((item) => item.id === 'lzz-v01-001')
      expect(record?.isGenerated).toBe(true)
      expect(record?.latestAsset?.videoPath).toBe(path.join(runDir, '08_final_story.mp4'))
      expect(record?.latestAsset?.hardSubVideoPath).toBe(path.join(runDir, '10_final_story_hardsub.mp4'))
      expect(record?.latestAsset?.softSubVideoPath).toBe(path.join(runDir, '10_final_story_softsub.mp4'))
      expect(record?.latestAsset?.subtitlePath).toBe(path.join(runDir, '09_subtitles_auto.srt'))
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('prefers the most complete generated asset and ignores tiny broken subtitle videos', () => {
    const workspaceRoot = makeTempWorkspace()
    try {
      const catalogPath = path.join(workspaceRoot, 'materials', 'zhiguai', 'zhiguai_story_catalog_offline.csv')
      const csv = [
        'id,title,volume,priority,hook_type,text_char_count,local_text_path',
        'zby-v01-003,南昌士人,子不语·卷1,B,异闻,601,stories/zby-v01-003/source.txt',
      ].join('\n')
      writeFileSync(catalogPath, csv, 'utf8')

      const olderRunDir = path.join(workspaceRoot, 'materials', 'zibuyu', 'runs', '20260325-193328-zby-v01-003-canonical-full')
      mkdirSync(olderRunDir, { recursive: true })
      writeFileSync(path.join(olderRunDir, '08_final_story.mp4'), Buffer.alloc(1_200_000))
      writeFileSync(path.join(olderRunDir, '10_final_story_hardsub.mp4'), Buffer.alloc(1_450_000))
      writeFileSync(path.join(olderRunDir, '10_final_story_softsub.mp4'), Buffer.alloc(1_210_000))
      writeFileSync(path.join(olderRunDir, '09_subtitles_auto.srt'), 'subtitle', 'utf8')

      const newerRunDir = path.join(workspaceRoot, 'materials', 'zibuyu', 'runs', '20260325-212801-zby-v01-003-canonical-full')
      mkdirSync(newerRunDir, { recursive: true })
      writeFileSync(path.join(newerRunDir, '08_final_story.mp4'), Buffer.alloc(1_400_000))
      writeFileSync(path.join(newerRunDir, '10_final_story_hardsub.mp4'), Buffer.alloc(90_000))
      writeFileSync(path.join(newerRunDir, '09_subtitles_auto.srt'), 'subtitle', 'utf8')

      const result = buildAndPersistStoryMaterialsDatabase({ workspaceRoot })
      const record = result.database.records.find((item) => item.id === 'zby-v01-003')

      expect(record?.isGenerated).toBe(true)
      expect(record?.generatedCount).toBe(2)
      expect(record?.latestAsset?.runDir).toBe(olderRunDir)
      expect(record?.latestAsset?.hardSubVideoPath).toBe(path.join(olderRunDir, '10_final_story_hardsub.mp4'))
      expect(record?.latestAsset?.softSubVideoPath).toBe(path.join(olderRunDir, '10_final_story_softsub.mp4'))
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })
})
