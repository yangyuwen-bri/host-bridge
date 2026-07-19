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

type DashscopeMessage = {
  role: 'system' | 'user'
  content: string
}

type HostOpeningQualityReview = {
  pass: boolean
  issues: string[]
  revisedOpening: string
}

const HOST_OPENING_MIN_CHARS = 55
const HOST_OPENING_TARGET_MIN_CHARS = 70
const HOST_OPENING_TARGET_MAX_CHARS = 110
const HOST_OPENING_MAX_CHARS = 130
const HOST_OPENING_MAX_TOKENS = 280

export type HostOpeningGenerationOptions = {
  apiKey: string
  model: string
  hotNews: HotNewsItem
  socialIssue: string
  matchReason: string
  story: StoryCatalogRecord
  deepReview: DeepStoryReview | null
  fetchImpl?: typeof fetch
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function requiredString(row: Record<string, unknown>, field: string): string {
  const value = row[field]
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`HOST_OPENING_FIELD_MISSING: ${field}`)
  return value.trim()
}

function compactText(value: string, maxChars: number): string {
  const text = value.replace(/\s+/gu, ' ').trim()
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text
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

function countOpeningChars(opening: string): number {
  return opening.replace(/\s+/gu, '').length
}

function hasValidOpeningLength(opening: string): boolean {
  const charCount = countOpeningChars(opening)
  return charCount >= HOST_OPENING_MIN_CHARS && charCount <= HOST_OPENING_MAX_CHARS
}

export function buildHostOpeningPrompt(options: HostOpeningGenerationOptions): string {
  return [
    '你是一个中文视频号故事主播。用户已经确认了要讲的具体故事，现在请为这一条已确认的故事生成主播开场。',
    `开场理想长度约 ${HOST_OPENING_TARGET_MIN_CHARS}-${HOST_OPENING_TARGET_MAX_CHARS} 个中文字符，可自然落在 ${HOST_OPENING_MIN_CHARS}-${HOST_OPENING_MAX_CHARS} 个字符；不要为了凑字数添加空话。结构要完整：第一句用克制、准确的方式简单提到热点事件本身，只复述输入中能确认的信息；第二句提炼事件背后的处境或冲突；第三句自然转入已确认的古代故事，最好点出故事标题、人物或具体冲突。`,
    '这是故事确认后的独立生成任务，不要复述工作流，不要说“我选择了这个故事”。',
    '不要使用“今天热榜”“看到这件事，我想到”“相似的不是结局”“故事发生在”等模板句。',
    '不要把现实新闻事实写成故事事实，不要硬说两者结果相同；只连接共同的处境、冲突或情绪。',
    `只输出 JSON：{"hostOpening":"..."}。hostOpening 适合直接口播，不包含标题、标签、引号或 Markdown。输出前请自检：去掉空格后至少 ${HOST_OPENING_MIN_CHARS} 个字符，最好在 ${HOST_OPENING_TARGET_MIN_CHARS}-${HOST_OPENING_TARGET_MAX_CHARS} 之间；如果内容已经完整，不要用泛泛的总结句填充。`,
    '',
    '已确认的热点：',
    JSON.stringify({
      source: options.hotNews.source,
      rank: options.hotNews.rank,
      title: options.hotNews.title,
      hot: options.hotNews.hot,
    }, null, 2),
    `从热点中提炼的社会议题：${options.socialIssue}`,
    `故事匹配理由：${options.matchReason}`,
    '',
    '已确认故事：',
    JSON.stringify({
      id: options.story.id,
      title: options.story.titleTrad,
      reviewSummary: compactText(options.deepReview?.oneSentenceSummary || '', 180),
      storyAngle: compactText(options.deepReview?.modernNewsAngle || options.story.modernAngle, 180),
      fullOriginalText: options.story.sourceText,
    }, null, 2),
  ].join('\n')
}

function validateHostOpening(opening: string, enforceLength: boolean): string {
  const charCount = countOpeningChars(opening)
  if (enforceLength && (charCount < HOST_OPENING_MIN_CHARS || charCount > HOST_OPENING_MAX_CHARS)) {
    throw new Error('HOST_OPENING_LENGTH_INVALID')
  }
  if (opening.includes('#')) throw new Error('HOST_OPENING_CONTAINS_HASHTAG')
  const templatePhrases = ['今天热榜', '看到这件事，我想到', '相似的不是结局', '故事发生在']
  if (templatePhrases.some((phrase) => opening.includes(phrase))) throw new Error('HOST_OPENING_TEMPLATE_DETECTED')
  return opening
}

function parseHostOpeningPayload(raw: unknown, enforceLength: boolean): string {
  const root = asRecord(raw)
  if (!root) throw new Error('HOST_OPENING_ROOT_INVALID')
  return validateHostOpening(requiredString(root, 'hostOpening'), enforceLength)
}

export function parseHostOpening(raw: unknown): string {
  return parseHostOpeningPayload(raw, true)
}

function buildHostOpeningQualityPrompt(options: HostOpeningGenerationOptions, candidate: string): string {
  return [
    '你是中文视频号的严格质检编辑。下面是一段已经生成的主播开场，不要直接交付，先判断它是否真的适合进入视频。',
    `合格开场的长度是 ${HOST_OPENING_MIN_CHARS}-${HOST_OPENING_MAX_CHARS} 个字符，理想长度约 ${HOST_OPENING_TARGET_MIN_CHARS}-${HOST_OPENING_TARGET_MAX_CHARS}；长度只是辅助标准，不能为了达标注水。`,
    '必须同时满足：',
    '1. 对热点的描述只使用输入中明确存在的事实，不夸大、不补写未提供的结论；',
    '2. 能说清热点背后的一个具体处境或冲突，而不是泛泛讲“人性”和“现实”；',
    '3. 能自然指向已确认的故事，最好出现故事标题、人物或具体冲突，让观众知道接下来讲什么；',
    '4. 语言像主播口播，2-4句，节奏自然，没有模板化转场、标签、标题或 Markdown；',
    '5. 不把现实新闻和古代故事说成同一件事，也不替现实事件下未经证实的结论。',
    '如果不合格，请在 revisedOpening 中直接重写一版；重写只能使用输入事实和故事原文，不要解释修改过程。',
    '只输出 JSON：{"pass":true或false,"issues":["问题"],"revisedOpening":"合格时可为空，不合格时必须填写"}',
    '',
    '热点：',
    JSON.stringify({
      source: options.hotNews.source,
      rank: options.hotNews.rank,
      title: options.hotNews.title,
      hot: options.hotNews.hot,
    }, null, 2),
    `社会议题：${options.socialIssue}`,
    `匹配理由：${options.matchReason}`,
    '已确认故事：',
    JSON.stringify({
      id: options.story.id,
      title: options.story.titleTrad,
      fullOriginalText: options.story.sourceText,
    }, null, 2),
    `待评估开场：${candidate}`,
  ].join('\n')
}

function buildHostOpeningRepairPrompt(options: HostOpeningGenerationOptions, candidate: string, issues: string[]): string {
  return [
    buildHostOpeningQualityPrompt(options, candidate),
    '',
    '这是强制修订请求：上一轮结果未通过本地质量检查。必须输出一版新的 revisedOpening，不能留空，不能原样复制候选。',
    `本地检查问题：${issues.length > 0 ? issues.join('；') : '开场长度或结构不合格'}`,
    `新稿去掉空格后必须在 ${HOST_OPENING_MIN_CHARS}-${HOST_OPENING_MAX_CHARS} 个字符之间，优先控制在 ${HOST_OPENING_TARGET_MIN_CHARS}-${HOST_OPENING_TARGET_MAX_CHARS} 个字符。`,
  ].join('\n')
}

function parseHostOpeningQualityReview(raw: unknown): HostOpeningQualityReview {
  const root = asRecord(raw)
  if (!root || typeof root.pass !== 'boolean') throw new Error('HOST_OPENING_REVIEW_INVALID')
  const issues = Array.isArray(root.issues)
    ? root.issues.filter((issue): issue is string => typeof issue === 'string').map((issue) => issue.trim()).filter(Boolean)
    : []
  const revisedOpening = typeof root.revisedOpening === 'string' ? root.revisedOpening.trim() : ''
  if (!root.pass && !revisedOpening) throw new Error('HOST_OPENING_REVIEW_REVISION_MISSING')
  return { pass: root.pass, issues, revisedOpening }
}

async function requestDashscopeText(options: {
  apiKey: string
  model: string
  messages: DashscopeMessage[]
  fetchImpl: typeof fetch
}): Promise<string> {
  const response = await options.fetchImpl('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: options.model,
      temperature: 0.65,
      max_tokens: HOST_OPENING_MAX_TOKENS,
      messages: options.messages,
    }),
  })
  const payload = await response.json().catch(() => ({})) as DashscopeResponse
  const errorObject = payload.error && typeof payload.error === 'object' ? payload.error as { message?: unknown } : null
  const code = typeof payload.code === 'string' ? payload.code : ''
  const message = typeof payload.message === 'string' ? payload.message : ''
  const errorMessage = typeof errorObject?.message === 'string' ? errorObject.message : ''
  if (!response.ok || code || message || errorMessage) {
    throw new Error(`DASHSCOPE_HOST_OPENING_FAILED: ${code || response.status} ${message || errorMessage || response.statusText}`)
  }
  const choices = Array.isArray(payload.choices)
    ? payload.choices.filter((item): item is DashscopeChoice => Boolean(item) && typeof item === 'object')
    : []
  const rawText = readModelText(choices[0]?.message?.content)
  if (!rawText.trim()) throw new Error('DASHSCOPE_HOST_OPENING_EMPTY')
  return rawText
}

export async function generateHostOpeningWithDashscope(
  options: HostOpeningGenerationOptions,
): Promise<{ opening: string; prompt: string; rawText: string }> {
  const apiKey = options.apiKey.trim()
  if (!apiKey) throw new Error('MISSING_ALIYUN_API_KEY')
  const prompt = buildHostOpeningPrompt(options)
  const fetchImpl = options.fetchImpl || fetch
  const rawText = await requestDashscopeText({
    apiKey,
    model: options.model,
    fetchImpl,
    messages: [
      { role: 'system', content: '你是中文视频号主播，必须严格输出 JSON。' },
      { role: 'user', content: prompt },
    ],
  })
  const candidate = parseHostOpeningPayload(extractFirstJsonObject(rawText), false)
  const reviewRawText = await requestDashscopeText({
    apiKey,
    model: options.model,
    fetchImpl,
    messages: [
      { role: 'system', content: '你是中文视频号内容质检编辑，必须严格输出 JSON。' },
      { role: 'user', content: buildHostOpeningQualityPrompt(options, candidate) },
    ],
  })
  const review = parseHostOpeningQualityReview(extractFirstJsonObject(reviewRawText))
  if (review.pass && hasValidOpeningLength(candidate)) {
    return { opening: parseHostOpening({ hostOpening: candidate }), prompt, rawText }
  }

  if (review.revisedOpening) {
    return {
      opening: parseHostOpening({ hostOpening: review.revisedOpening }),
      prompt,
      rawText,
    }
  }

  const repairRawText = await requestDashscopeText({
    apiKey,
    model: options.model,
    fetchImpl,
    messages: [
      { role: 'system', content: '你是中文视频号内容修订编辑，必须严格输出 JSON。' },
      {
        role: 'user',
        content: buildHostOpeningRepairPrompt(options, candidate, [
          ...review.issues,
          ...(hasValidOpeningLength(candidate) ? [] : ['候选稿长度不在可接受范围']),
        ]),
      },
    ],
  })
  const repair = parseHostOpeningQualityReview(extractFirstJsonObject(repairRawText))
  if (!repair.revisedOpening) throw new Error('HOST_OPENING_REPAIR_MISSING')

  return {
    opening: parseHostOpening({ hostOpening: repair.revisedOpening }),
    prompt,
    rawText,
  }
}
