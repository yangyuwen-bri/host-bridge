import { extractFirstJsonObject } from './model-analysis'
import type { DeepStoryReview, HotNewsItem, StoryCatalogRecord } from './types'

type DashscopeResponse = {
  code?: unknown
  message?: unknown
  error?: unknown
  choices?: unknown
}

type DashscopeChoice = {
  message?: {
    content?: unknown
  }
}

export type PublishCopyGenerationOptions = {
  apiKey: string
  model: string
  hotNews: HotNewsItem
  socialIssue: string
  matchReason: string
  story: StoryCatalogRecord
  deepReview: DeepStoryReview | null
  hostOpening: string
  fetchImpl?: typeof fetch
}

export type PublishCopy = {
  title: string
  body: string
  hashtags: string[]
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function requiredString(row: Record<string, unknown>, field: string): string {
  const value = row[field]
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`PUBLISH_COPY_FIELD_MISSING: ${field}`)
  return value.trim()
}

function readModelText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((part) => {
    if (typeof part === 'string') return part
    if (part && typeof part === 'object' && 'text' in part) {
      const text = (part as { text?: unknown }).text
      return typeof text === 'string' ? text : ''
    }
    return ''
  }).join('')
}

function readHashtags(row: Record<string, unknown>): string[] {
  const value = row.hashtags
  if (!Array.isArray(value)) throw new Error('PUBLISH_COPY_HASHTAGS_INVALID')
  const hashtags = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
  if (hashtags.length !== 10) throw new Error('PUBLISH_COPY_HASHTAGS_COUNT_INVALID')
  if (new Set(hashtags).size !== hashtags.length) throw new Error('PUBLISH_COPY_HASHTAGS_DUPLICATE')
  if (hashtags.some((tag) => !tag.startsWith('#'))) throw new Error('PUBLISH_COPY_HASHTAG_PREFIX_INVALID')
  return hashtags
}

export function buildPublishCopyPrompt(options: PublishCopyGenerationOptions): string {
  return [
    '你是中文视频号内容编辑。用户已经确认了具体故事，现在只为这一个故事生成发布文案。',
    '标题必须使用故事原始标题，不能改写。正文要有悬念和画面感，可以暗暗连接热点背后的社会议题，但不能写“今天热榜”“我选择了这个故事”“该热点”等工作流话术。',
    '正文只写发布正文，不包含任何 # 标签；标签单独放在 hashtags 数组。',
    'hashtags 必须输出恰好 10 个不重复标签，分别覆盖：账号、内容类型、故事题材、社会议题、热点场景、情绪关键词和受众兴趣。标签要具体、相关，不能堆泛化热门词。',
    '只输出 JSON：{"title":"故事原始标题","body":"3-6行发布正文","hashtags":["#子不语","#志怪故事","#古代奇案","#社会议题","#热点场景","#人性冲突","#民间故事","#悬疑故事","#传统文化","#故事解读"]}',
    '',
    '热点：',
    JSON.stringify({ source: options.hotNews.source, rank: options.hotNews.rank, title: options.hotNews.title, hot: options.hotNews.hot }, null, 2),
    `社会议题：${options.socialIssue}`,
    `匹配理由：${options.matchReason}`,
    `主播开场：${options.hostOpening || '尚未生成，正文只依据已确认热点和故事生成。'}`,
    '',
    '已确认故事：',
    JSON.stringify({
      id: options.story.id,
      originalTitle: options.story.titleTrad,
      summary: options.deepReview?.oneSentenceSummary || options.story.sourceExcerpt,
      modernAngle: options.deepReview?.modernNewsAngle || options.story.modernAngle,
      fullOriginalText: options.story.sourceText,
    }, null, 2),
  ].join('\n')
}

export function parsePublishCopy(raw: unknown, expectedTitle: string): PublishCopy {
  const root = asRecord(raw)
  if (!root) throw new Error('PUBLISH_COPY_ROOT_INVALID')
  const title = requiredString(root, 'title')
  if (title !== expectedTitle) throw new Error('PUBLISH_COPY_TITLE_MISMATCH')
  const body = requiredString(root, 'body')
  if (body.includes('#')) throw new Error('PUBLISH_COPY_BODY_CONTAINS_HASHTAG')
  return { title, body, hashtags: readHashtags(root) }
}

export async function generatePublishCopyWithDashscope(
  options: PublishCopyGenerationOptions,
): Promise<{ copy: PublishCopy; prompt: string; rawText: string }> {
  const apiKey = options.apiKey.trim()
  if (!apiKey) throw new Error('MISSING_ALIYUN_API_KEY')
  const prompt = buildPublishCopyPrompt(options)
  const fetchImpl = options.fetchImpl || fetch
  const response = await fetchImpl('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: options.model,
      temperature: 0.55,
      messages: [
        { role: 'system', content: '你是中文视频号文案编辑，必须严格输出 JSON。' },
        { role: 'user', content: prompt },
      ],
    }),
  })
  const payload = await response.json().catch(() => ({})) as DashscopeResponse
  const errorObject = payload.error && typeof payload.error === 'object' ? payload.error as { message?: unknown } : null
  const code = typeof payload.code === 'string' ? payload.code : ''
  const message = typeof payload.message === 'string' ? payload.message : ''
  const errorMessage = typeof errorObject?.message === 'string' ? errorObject.message : ''
  if (!response.ok || code || message || errorMessage) {
    throw new Error(`DASHSCOPE_PUBLISH_COPY_FAILED: ${code || response.status} ${message || errorMessage || response.statusText}`)
  }
  const choices = Array.isArray(payload.choices)
    ? payload.choices.filter((item): item is DashscopeChoice => Boolean(item) && typeof item === 'object')
    : []
  const rawText = readModelText(choices[0]?.message?.content)
  if (!rawText.trim()) throw new Error('DASHSCOPE_PUBLISH_COPY_EMPTY')
  const copy = parsePublishCopy(extractFirstJsonObject(rawText), options.story.titleTrad)
  return { copy, prompt, rawText }
}
