import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { persistSocialHotVideoPlan } from './plan-store'
import type { FullCatalogAnalysisResult } from './full-catalog-analysis'
import type { SocialHotVideoPlan } from './types'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('social hot plan store', () => {
  it('persists the raw inputs and rendered plan used by the editorial page', () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'social-hot-plan-test-'))
    tempDirectories.push(workspaceRoot)
    const directory = path.join(workspaceRoot, 'plan')
    const hotNews = { fetchedAt: '2026-07-14T08:00:00.000Z', items: [], errors: [] }
    const analysis = {
      decision: { overallRead: '测试分析', recommendations: [] },
      rawText: '{"overallRead":"测试分析","recommendations":[]}',
      prompt: '测试提示词',
      recallCount: 0,
      catalogCount: 100,
    } as FullCatalogAnalysisResult
    const plan = {
      generatedAt: '2026-07-14T08:00:01.000Z',
      workspaceRoot,
      outputDir: directory,
      sourceErrors: [],
      modelDecision: analysis.decision,
      selected: null,
      recommendations: [],
    } as SocialHotVideoPlan

    persistSocialHotVideoPlan({ directory, hotNews, analysis, plan })

    expect(JSON.parse(readFileSync(path.join(directory, '01_hot_news_raw.json'), 'utf8'))).toEqual(hotNews)
    expect(readFileSync(path.join(directory, '02_model_prompt.txt'), 'utf8')).toBe('测试提示词')
    expect(JSON.parse(readFileSync(path.join(directory, '04_model_decision.json'), 'utf8')).overallRead).toBe('测试分析')
    expect(readFileSync(path.join(directory, '06_social_hot_video_plan.md'), 'utf8')).toContain('No recommendation passed the filters.')
  })
})
