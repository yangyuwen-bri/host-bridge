import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { EditorialHotItem, EditorialRecommendation } from './editorial-view'
import { readLatestEditorialProductionResult, writeEditorialProductionResult } from './editorial-result'

const tempDirectories: string[] = []

function makeTempWorkspace(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'editorial-result-test-'))
  tempDirectories.push(directory)
  return directory
}

function makeHotItem(): EditorialHotItem {
  return {
    id: 'weibo#12',
    source: 'weibo',
    sourceLabel: '微博',
    rank: 12,
    title: '测试热点',
    heat: '—',
    trend: '平稳',
    issue: '测试议题',
    lead: '测试引导',
    url: 'https://example.com/hot',
    fetchedAt: '2026-07-14T07:51:23.943Z',
  }
}

function makeRecommendation(): EditorialRecommendation {
  return {
    hotId: 'weibo#12',
    storyId: 'zby-v14-027',
    storyTitle: '鬼入人腹',
    socialIssue: '测试议题',
    matchReason: '测试匹配理由',
    matchScore: 78,
    matchEvidence: '测试热点证据',
    storyEvidence: '测试故事证据',
    comparisonNote: '测试比较说明',
    storySourcePath: 'stories/zby-v14-027/source.txt',
    storyTextCharCount: 477,
    storySummary: '测试摘要',
    storyAngle: '测试角度',
    storyCategoryTags: '测试标签',
    storyRiskTags: '测试风险',
    storyProductionRecommendation: '可备选',
    riskLevel: 'medium',
    riskNotes: '测试风险说明',
    publishTitle: '鬼入人腹',
    publishBody: '测试正文',
    hashtags: ['#1', '#2', '#3', '#4', '#5', '#6', '#7', '#8', '#9', '#10'],
  }
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('editorial production result store', () => {
  it('round-trips the latest completed result for page hydration', () => {
    const workspaceRoot = makeTempWorkspace()
    const result = writeEditorialProductionResult(workspaceRoot, {
      updatedAt: '2026-07-14T08:00:22.348Z',
      jobId: 'job-1',
      status: 'succeeded',
      storyId: 'zby-v14-027',
      runDir: '/tmp/run',
      videoPath: '/tmp/run/10_final_story_hardsub.mp4',
      hostOpening: '测试开场',
      hotItem: makeHotItem(),
      recommendation: makeRecommendation(),
    })

    const loaded = readLatestEditorialProductionResult(workspaceRoot)

    expect(loaded?.jobId).toBe(result.jobId)
    expect(loaded?.recommendation.publishTitle).toBe('鬼入人腹')
    expect(loaded?.recommendation.hashtags).toHaveLength(10)
    expect(loaded?.videoPath).toBe('/tmp/run/10_final_story_hardsub.mp4')
  })
})
