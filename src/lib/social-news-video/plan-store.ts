import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { renderSocialHotVideoPlanMarkdown } from './planner'
import type { FullCatalogAnalysisResult } from './full-catalog-analysis'
import type { SocialHotVideoPlan, HotNewsFetchResult } from './types'

export interface PersistSocialHotVideoPlanInput {
  directory: string
  hotNews: HotNewsFetchResult
  analysis: FullCatalogAnalysisResult
  plan: SocialHotVideoPlan
}

export function persistSocialHotVideoPlan(input: PersistSocialHotVideoPlanInput): string {
  const directory = path.resolve(input.directory)
  mkdirSync(directory, { recursive: true })
  writeFileSync(path.join(directory, '01_hot_news_raw.json'), JSON.stringify(input.hotNews, null, 2), 'utf8')
  writeFileSync(path.join(directory, '02_model_prompt.txt'), input.analysis.prompt, 'utf8')
  writeFileSync(path.join(directory, '03_model_raw_response.txt'), input.analysis.rawText, 'utf8')
  writeFileSync(path.join(directory, '04_model_decision.json'), JSON.stringify(input.analysis.decision, null, 2), 'utf8')
  writeFileSync(path.join(directory, '05_social_hot_video_plan.json'), JSON.stringify(input.plan, null, 2), 'utf8')
  writeFileSync(path.join(directory, '06_social_hot_video_plan.md'), renderSocialHotVideoPlanMarkdown(input.plan), 'utf8')
  return directory
}
