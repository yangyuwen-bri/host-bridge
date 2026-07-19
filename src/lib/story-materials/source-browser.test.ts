import { describe, expect, it } from 'vitest'
import { limitStorySourceIndexRecords, selectStorySourceRecord } from './source-browser'
import type { StoryMaterialRecord } from './types'

function record(id: string, title = id): StoryMaterialRecord {
  return {
    id,
    title,
    titleAliases: [],
    volume: '子不语·卷1',
    priority: 'B',
    hookType: '',
    textCharCount: 100,
    localTextPath: `/tmp/${id}.txt`,
    sourceFilePath: `/tmp/${id}.txt`,
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
  }
}

describe('story source browser helpers', () => {
  it('keeps a selected story even when filters currently hide it', () => {
    const allRecords = [record('zby-v01-001'), record('zby-v01-002')]
    const filteredRecords = [allRecords[0]]

    const selected = selectStorySourceRecord({
      allRecords,
      filteredRecords,
      selectedStoryId: 'zby-v01-002',
    })

    expect(selected?.id).toBe('zby-v01-002')
  })

  it('falls back to the first filtered record and limits visible index records', () => {
    const allRecords = [record('zby-v01-001'), record('zby-v01-002'), record('zby-v01-003')]
    const filteredRecords = [allRecords[1], allRecords[2]]

    const selected = selectStorySourceRecord({ allRecords, filteredRecords, selectedStoryId: null })
    const visible = limitStorySourceIndexRecords(filteredRecords, 1)

    expect(selected?.id).toBe('zby-v01-002')
    expect(visible.map((item) => item.id)).toEqual(['zby-v01-002'])
  })
})
