export interface GenerateAliyunStoryImageInput {
  model: string
  prompt: string
  apiKey: string
  sceneId?: number
  log?: (message: string) => void
}

interface AliyunTaskResponse {
  output?: {
    task_id?: string
    task_status?: string
    results?: Array<{ url?: string }>
  }
  code?: string
  message?: string
}

interface AliyunSyncImageResponse {
  output?: {
    choices?: Array<{
      message?: {
        content?: Array<{
          image?: string
        }>
      }
    }>
  }
  code?: string
  message?: string
}

export function isAliyunStoryImageModel(model: string): boolean {
  const normalized = model.trim().toLowerCase()
  return normalized.startsWith('qwen-image')
}

export function isAliyunSyncStoryImageModel(model: string): boolean {
  const normalized = model.trim().toLowerCase()
  return normalized.startsWith('qwen-image-2.0') || normalized.startsWith('qwen-image-max')
}

function logMessage(params: GenerateAliyunStoryImageInput, message: string): void {
  params.log?.(message)
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 30_000): Promise<Response> {
  return fetch(url, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  })
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function errorMessage(data: { code?: string; message?: string }, status: number): string {
  return `${data.code || status} ${data.message || ''}`.trim()
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return String(error)
}

function extractSyncImageUrl(data: AliyunSyncImageResponse): string {
  const url = data.output?.choices?.[0]?.message?.content?.find((part) => typeof part.image === 'string')?.image || ''
  if (!url) throw new Error('ALIYUN_IMAGE_EMPTY_URL')
  return url
}

async function downloadImageUrl(imageUrl: string): Promise<Buffer> {
  const response = await fetchWithTimeout(imageUrl, { method: 'GET' }, 120_000)
  if (!response.ok) throw new Error(`ALIYUN_IMAGE_DOWNLOAD_FAILED: HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

async function generateSyncImage(params: GenerateAliyunStoryImageInput): Promise<Buffer> {
  let lastError = ''
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    let response: Response
    try {
      response = await fetchWithTimeout(
        'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${params.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: params.model,
            input: {
              messages: [
                {
                  role: 'user',
                  content: [{ text: params.prompt }],
                },
              ],
            },
            parameters: {
              n: 1,
              size: '1280*720',
              watermark: false,
              prompt_extend: true,
              negative_prompt: '低分辨率，低画质，肢体畸形，手指畸形，画面过饱和，蜡像感，人脸无细节，过度光滑，画面具有AI感，构图混乱，文字模糊，扭曲。',
            },
          }),
        },
        300_000,
      )
    } catch (error) {
      lastError = `ALIYUN_SYNC_IMAGE_NETWORK_FAILED: ${toErrorMessage(error)}`
      logMessage(params, `aliyun sync image retry=${attempt} scene=${params.sceneId ?? 'n/a'} model=${params.model} error=${lastError}`)
      await sleep(Math.min(45_000, 5_000 * attempt))
      continue
    }

    const data = await response.json().catch((): AliyunSyncImageResponse => ({}))
    if (response.ok && !data.code && !data.message) {
      try {
        return await downloadImageUrl(extractSyncImageUrl(data))
      } catch (error) {
        lastError = `ALIYUN_SYNC_IMAGE_DOWNLOAD_FAILED: ${toErrorMessage(error)}`
        logMessage(params, `aliyun sync image retry=${attempt} scene=${params.sceneId ?? 'n/a'} model=${params.model} error=${lastError}`)
        await sleep(Math.min(45_000, 5_000 * attempt))
        continue
      }
    }

    lastError = `ALIYUN_SYNC_IMAGE_FAILED: ${errorMessage(data, response.status)}`
    logMessage(params, `aliyun sync image retry=${attempt} scene=${params.sceneId ?? 'n/a'} model=${params.model} error=${lastError}`)
    await sleep(Math.min(45_000, 5_000 * attempt))
  }

  throw new Error(lastError || `ALIYUN_SYNC_IMAGE_FAILED: ${params.model}`)
}

async function waitForImageTask(params: GenerateAliyunStoryImageInput & { taskId: string }): Promise<string> {
  for (let attempt = 1; attempt <= 80; attempt += 1) {
    const response = await fetchWithTimeout(
      `https://dashscope.aliyuncs.com/api/v1/tasks/${params.taskId}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${params.apiKey}`,
        },
      },
      15_000,
    )
    const data = await response.json().catch((): AliyunTaskResponse => ({}))
    const status = data.output?.task_status || ''
    if (!response.ok) throw new Error(`ALIYUN_IMAGE_TASK_QUERY_FAILED: ${errorMessage(data, response.status)}`)
    if (status === 'SUCCEEDED') {
      const imageUrl = data.output?.results?.[0]?.url || ''
      if (!imageUrl) throw new Error(`ALIYUN_IMAGE_EMPTY_URL: task=${params.taskId}`)
      return imageUrl
    }
    if (status === 'FAILED' || status === 'CANCELED') {
      throw new Error(`ALIYUN_IMAGE_TASK_FAILED: ${status} ${data.code || ''} ${data.message || ''}`.trim())
    }
    logMessage(params, `aliyun image task scene=${params.sceneId ?? 'n/a'} poll=${attempt} status=${status || 'UNKNOWN'}`)
    await sleep(2500)
  }
  throw new Error(`ALIYUN_IMAGE_TASK_TIMEOUT: task=${params.taskId}`)
}

async function generateAsyncImage(params: GenerateAliyunStoryImageInput): Promise<Buffer> {
  const response = await fetchWithTimeout(
    'https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
        'X-DashScope-Async': 'enable',
      },
      body: JSON.stringify({
        model: params.model,
        input: { prompt: params.prompt },
        parameters: {
          n: 1,
          size: '1280*720',
        },
      }),
    },
    120_000,
  )

  const data = await response.json().catch((): AliyunTaskResponse => ({}))
  if (!response.ok || data.code || data.message) {
    throw new Error(`ALIYUN_IMAGE_SUBMIT_FAILED: ${errorMessage(data, response.status)}`)
  }
  const taskId = data.output?.task_id || ''
  if (!taskId) throw new Error('ALIYUN_IMAGE_EMPTY_TASK_ID')
  const imageUrl = await waitForImageTask({ ...params, taskId })
  return downloadImageUrl(imageUrl)
}

export async function generateAliyunStoryImage(params: GenerateAliyunStoryImageInput): Promise<Buffer> {
  if (!params.apiKey.trim()) throw new Error('MISSING_ALIYUN_API_KEY')
  if (!params.model.trim()) throw new Error('ALIYUN_IMAGE_MODEL_EMPTY')
  if (!params.prompt.trim()) throw new Error('ALIYUN_IMAGE_PROMPT_EMPTY')
  if (!isAliyunStoryImageModel(params.model)) {
    throw new Error(`ALIYUN_IMAGE_MODEL_UNSUPPORTED: ${params.model}`)
  }
  if (isAliyunSyncStoryImageModel(params.model)) return generateSyncImage(params)
  return generateAsyncImage(params)
}
