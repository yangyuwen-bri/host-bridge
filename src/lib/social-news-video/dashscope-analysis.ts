import {
  buildSocialHotModelPrompt,
  extractFirstJsonObject,
  parseSocialHotModelDecision,
  type SocialHotModelAnalysisInput,
  type SocialHotModelDecision,
} from './model-analysis'

type DashscopeChoiceMessage = {
  content?: unknown
}

type DashscopeChoice = {
  message?: DashscopeChoiceMessage
}

type DashscopeResponse = {
  code?: unknown
  message?: unknown
  error?: unknown
  choices?: unknown
  model?: unknown
}

export type AnalyzeSocialHotWithDashscopeOptions = SocialHotModelAnalysisInput & {
  apiKey: string
  model: string
  fetchImpl?: typeof fetch
}

function readModelTextMessageContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object' && 'text' in part) {
          const text = (part as { text?: unknown }).text
          return typeof text === 'string' ? text : ''
        }
        return ''
      })
      .join('')
  }
  return ''
}

export async function analyzeSocialHotWithDashscope(
  options: AnalyzeSocialHotWithDashscopeOptions,
): Promise<{ decision: SocialHotModelDecision; rawText: string; prompt: string }> {
  const apiKey = options.apiKey.trim()
  if (!apiKey) throw new Error('MISSING_ALIYUN_API_KEY')
  const prompt = buildSocialHotModelPrompt(options)
  const fetchImpl = options.fetchImpl || fetch
  const response = await fetchImpl('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: options.model,
      temperature: 0.4,
      messages: [
        {
          role: 'system',
          content: '你是中文视频号选题总监。必须严格输出 JSON。',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  })

  const payload = await response.json().catch(() => ({})) as DashscopeResponse
  const errorObject = payload.error && typeof payload.error === 'object' ? payload.error as { message?: unknown } : null
  const code = typeof payload.code === 'string' ? payload.code : ''
  const message = typeof payload.message === 'string' ? payload.message : ''
  const errorMessage = typeof errorObject?.message === 'string' ? errorObject.message : ''
  if (!response.ok || code || message || errorMessage) {
    throw new Error(`DASHSCOPE_SOCIAL_HOT_ANALYSIS_FAILED: ${code || response.status} ${message || errorMessage || response.statusText}`)
  }

  const choicesRaw = Array.isArray(payload.choices) ? payload.choices : []
  const choices = choicesRaw.filter((item): item is DashscopeChoice => !!item && typeof item === 'object')
  const rawText = readModelTextMessageContent(choices[0]?.message?.content)
  if (!rawText.trim()) throw new Error('DASHSCOPE_SOCIAL_HOT_ANALYSIS_EMPTY')

  const jsonObject = extractFirstJsonObject(rawText)
  return {
    decision: parseSocialHotModelDecision(jsonObject),
    rawText,
    prompt,
  }
}
