import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { analyzeFullStoryCatalogWithDashscope } from '../src/lib/social-news-video/full-catalog-analysis'
import { fetchNewsNowHotItems } from '../src/lib/social-news-video/newsnow'
import {
  DEFAULT_NEWSNOW_SOURCES,
  buildSocialHotVideoPlanFromModelDecision,
  renderSocialHotVideoPlanMarkdown,
} from '../src/lib/social-news-video/planner'
import {
  collectProducedStoryIds,
  loadDeepStoryReviews,
  loadFullZbyStoryCatalog,
  loadStoryReviewRecords,
} from '../src/lib/social-news-video/story-catalog'
import type { HotNewsFetchResult } from '../src/lib/social-news-video/types'

type CliArgs = {
  workspaceRoot: string
  outputDir: string | null
  sources: string[]
  hotNewsJson: string | null
  limit: number
  generate: boolean
  analysisModel: string
  storyCandidateLimit: number
  llmModel: string
  imageModel: string
  ttsModel: string
}

function readArgValue(args: string[], name: string): string | null {
  const index = args.indexOf(name)
  if (index === -1) return null
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`ARG_VALUE_MISSING: ${name}`)
  return value
}

function parseCsvArg(value: string | null, fallback: readonly string[]): string[] {
  if (!value) return [...fallback]
  const items = value.split(',').map((item) => item.trim()).filter((item) => item.length > 0)
  if (items.length === 0) throw new Error('SOURCES_EMPTY')
  return items
}

function parseArgs(argv: string[]): CliArgs {
  const workspaceRoot = path.resolve(readArgValue(argv, '--workspace') || process.cwd())
  const limitRaw = readArgValue(argv, '--limit')
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : 5
  if (!Number.isFinite(limit) || limit < 1 || limit > 20) throw new Error(`LIMIT_INVALID: ${limitRaw}`)
  const storyCandidateLimitRaw = readArgValue(argv, '--story-candidate-limit')
  const storyCandidateLimit = storyCandidateLimitRaw ? Number.parseInt(storyCandidateLimitRaw, 10) : 120
  if (!Number.isFinite(storyCandidateLimit) || storyCandidateLimit < 20 || storyCandidateLimit > 250) {
    throw new Error(`STORY_CANDIDATE_LIMIT_INVALID: ${storyCandidateLimitRaw}`)
  }

  return {
    workspaceRoot,
    outputDir: readArgValue(argv, '--output-dir'),
    sources: parseCsvArg(readArgValue(argv, '--sources'), DEFAULT_NEWSNOW_SOURCES),
    hotNewsJson: readArgValue(argv, '--hot-news-json'),
    limit,
    generate: argv.includes('--generate'),
    analysisModel: readArgValue(argv, '--analysis-model') || 'qwen3-max',
    storyCandidateLimit,
    llmModel: readArgValue(argv, '--llm-model') || 'deepseek-v4-flash',
    imageModel: readArgValue(argv, '--image-model') || 'qwen-image-2.0',
    ttsModel: readArgValue(argv, '--tts-model') || 'qwen3-tts-vd-2026-01-26',
  }
}

function timestampForPath(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('')
}

function readHotNewsJson(filePath: string): HotNewsFetchResult {
  const payload = JSON.parse(readFileSync(filePath, 'utf8')) as HotNewsFetchResult
  if (!Array.isArray(payload.items) || !Array.isArray(payload.errors) || typeof payload.fetchedAt !== 'string') {
    throw new Error(`HOT_NEWS_JSON_INVALID: ${filePath}`)
  }
  return payload
}

function readDotEnvFile(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) return {}
  const result: Record<string, string> = {}
  const text = readFileSync(filePath, 'utf8')
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const equalIndex = line.indexOf('=')
    if (equalIndex <= 0) continue
    const key = line.slice(0, equalIndex).trim()
    const rawValue = line.slice(equalIndex + 1).trim()
    result[key] = rawValue.replace(/^['"]|['"]$/gu, '')
  }
  return result
}

function resolveAliyunApiKey(workspaceRoot: string): string {
  const env = {
    ...readDotEnvFile(path.join(workspaceRoot, '.env.local')),
    ...process.env,
  }
  const apiKey = String(env.ALIYUN_API_KEY || env.QWEN_API_KEY || '').trim()
  if (!apiKey) throw new Error('MISSING_ALIYUN_API_KEY')
  return apiKey
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const runTimestamp = timestampForPath()
  const outputDir = path.resolve(
    args.outputDir || path.join(args.workspaceRoot, 'materials', 'zibuyu', 'social-hot-plans', runTimestamp),
  )
  mkdirSync(outputDir, { recursive: true })

  const reviewPath = path.join(args.workspaceRoot, 'materials', 'zhiguai', 'analysis', 'content_ops_review', 'zby_sa_ops_review_rule_first_pass.json')
  const deepReviewPath = path.join(args.workspaceRoot, 'materials', 'zhiguai', 'analysis', 'content_ops_review', 'zby_s_llm_deep_review.json')
  const runsDir = path.join(args.workspaceRoot, 'materials', 'zibuyu', 'runs')

  const hotNews = args.hotNewsJson
    ? readHotNewsJson(args.hotNewsJson)
    : await fetchNewsNowHotItems({ sources: args.sources })
  writeFileSync(path.join(outputDir, '01_hot_news_raw.json'), JSON.stringify(hotNews, null, 2), 'utf8')

  const reviewedStories = loadStoryReviewRecords(reviewPath)
  const stories = loadFullZbyStoryCatalog(args.workspaceRoot, reviewedStories)
  const deepReviews = loadDeepStoryReviews(deepReviewPath)
  const producedStoryIds = collectProducedStoryIds(runsDir)
  const modelAnalysis = await analyzeFullStoryCatalogWithDashscope({
    hotNews,
    stories,
    deepReviews,
    producedStoryIds,
    limit: args.limit,
    batchSize: args.storyCandidateLimit,
    apiKey: resolveAliyunApiKey(args.workspaceRoot),
    model: args.analysisModel,
  })
  writeFileSync(path.join(outputDir, '02_model_prompt.txt'), modelAnalysis.prompt, 'utf8')
  writeFileSync(path.join(outputDir, '03_model_raw_response.txt'), modelAnalysis.rawText, 'utf8')
  writeFileSync(path.join(outputDir, '04_model_decision.json'), JSON.stringify(modelAnalysis.decision, null, 2), 'utf8')

  const plan = buildSocialHotVideoPlanFromModelDecision({
    workspaceRoot: args.workspaceRoot,
    outputDir,
    hotNews,
    stories,
    deepReviews,
    modelDecision: modelAnalysis.decision,
    limit: args.limit,
    runTimestamp,
    llmModel: args.llmModel,
    imageModel: args.imageModel,
    ttsModel: args.ttsModel,
  })

  const planJsonPath = path.join(outputDir, '05_social_hot_video_plan.json')
  const planMdPath = path.join(outputDir, '06_social_hot_video_plan.md')
  writeFileSync(planJsonPath, JSON.stringify(plan, null, 2), 'utf8')
  writeFileSync(planMdPath, renderSocialHotVideoPlanMarkdown(plan), 'utf8')

  console.log(JSON.stringify({
    outputDir,
    hotNewsCount: hotNews.items.length,
    sourceErrorCount: hotNews.errors.length,
    recommendationCount: plan.recommendations.length,
    selectedStoryId: plan.selected?.storyMatch.story.id || null,
    selectedTitle: plan.selected?.publishCopy.title || null,
    planJson: planJsonPath,
    planMarkdown: planMdPath,
  }, null, 2))

  if (!args.generate) return
  if (!plan.selected) throw new Error('GENERATE_SELECTED_RECOMMENDATION_MISSING')

  const env = {
    ...process.env,
    ...readDotEnvFile(path.join(args.workspaceRoot, '.env.local')),
  }
  const command = plan.selected.generation.command
  const result = spawnSync(command[0], command.slice(1), {
    cwd: args.workspaceRoot,
    env,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`VIDEO_GENERATION_FAILED: exit ${result.status}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
