import { downloadBinaryWithRedirects } from '@/lib/story-materials/http-download'
import { mergeTtsWavBuffers } from '@/lib/story-materials/tts-audio'
import { splitTextForUtf8ByteLimit } from '@/lib/story-runner/utils'
import { WebSocket } from 'ws'

export interface GenerateQwenTtsParams {
  text: string
  apiKey: string
  model: string
  voice: string
  instructions: string
  requestTimeoutMs: number
  maxInputBytes?: number
  onLog?: (message: string) => void
}

export interface GenerateQwenTtsResult {
  wav: Buffer
  sourceUrl: string
  chunkCount: number
}

type RealtimeSessionConfig = {
  mode: 'commit'
  voice: string
  language_type: 'Chinese'
  response_format: 'pcm'
  sample_rate: 24000
  instructions?: string
  optimize_instructions?: true
}

type RealtimeEvent = {
  type?: unknown
  delta?: unknown
  error?: unknown
  code?: unknown
  message?: unknown
}

function formatNetworkError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function logIfNeeded(params: GenerateQwenTtsParams, message: string): void {
  params.onLog?.(message)
}

export function isRealtimeQwenTtsModel(model: string): boolean {
  return model.trim().toLowerCase().startsWith('qwen3-tts-vc-realtime')
    || model.trim().toLowerCase().startsWith('qwen3-tts-instruct-flash-realtime')
    || model.trim().toLowerCase().startsWith('qwen3-tts-flash-realtime')
}

export function buildQwenRealtimeSessionConfig(params: {
  model: string
  voice: string
  instructions: string
}): RealtimeSessionConfig {
  const model = params.model.trim().toLowerCase()
  const config: RealtimeSessionConfig = {
    mode: 'commit',
    voice: params.voice,
    language_type: 'Chinese',
    response_format: 'pcm',
    sample_rate: 24000,
  }
  if (model.startsWith('qwen3-tts-instruct-flash-realtime')) {
    const instructions = params.instructions.trim()
    if (instructions) {
      config.instructions = instructions
      config.optimize_instructions = true
    }
  }
  return config
}

export function wrapPcm16MonoToWav(pcm: Buffer, sampleRate: number): Buffer {
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
    throw new Error(`INVALID_PCM_SAMPLE_RATE: ${sampleRate}`)
  }
  const header = Buffer.alloc(44)
  const dataSize = pcm.length
  const byteRate = sampleRate * 2
  const blockAlign = 2
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + dataSize, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(dataSize, 40)
  return Buffer.concat([header, pcm])
}

async function qwenHttpTtsSingle(params: GenerateQwenTtsParams & { text: string }): Promise<{ wav: Buffer; sourceUrl: string }> {
  let lastError = 'unknown'
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      const response = await fetch('https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${params.apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(params.requestTimeoutMs),
        body: JSON.stringify({
          model: params.model,
          input: {
            text: params.text,
            voice: params.voice,
            language_type: 'Chinese',
          },
          parameters: {
            instructions: params.instructions,
          },
        }),
      })

      const data = await response.json().catch(() => ({})) as Record<string, unknown>
      const errorCode = typeof data.code === 'string' ? data.code : ''
      const errorMessage = typeof data.message === 'string' ? data.message : ''
      if (!response.ok || errorCode || errorMessage) {
        lastError = `Qwen TTS failed: ${errorCode || response.status} ${errorMessage}`.trim()
        logIfNeeded(params, `qwen tts request retry=${attempt} error=${lastError}`)
        await sleep(1500 * attempt)
        continue
      }

      const output = data.output as { audio?: { url?: string }; audio_url?: string } | undefined
      const sourceUrl = output?.audio?.url || output?.audio_url || ''
      if (!sourceUrl) {
        lastError = 'Qwen TTS returned empty audio url'
        logIfNeeded(params, `qwen tts request retry=${attempt} error=${lastError}`)
        await sleep(1500 * attempt)
        continue
      }

      logIfNeeded(params, 'qwen tts downloading audio...')
      const wav = await downloadBinaryWithRedirects({
        url: sourceUrl,
        timeoutMs: params.requestTimeoutMs,
      })
      return { wav, sourceUrl }
    } catch (error) {
      lastError = formatNetworkError(error)
      logIfNeeded(params, `qwen tts retry=${attempt} error=${lastError}`)
      await sleep(1500 * attempt)
    }
  }
  throw new Error(lastError)
}

async function qwenRealtimeTtsSingle(params: GenerateQwenTtsParams & { text: string }): Promise<{ wav: Buffer; sourceUrl: string }> {
  let lastError = 'unknown'
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      const result = await new Promise<{ wav: Buffer; sourceUrl: string }>((resolve, reject) => {
        const chunks: Buffer[] = []
        const wsUrl = `wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=${encodeURIComponent(params.model)}`
        const socket = new WebSocket(wsUrl, {
          headers: { Authorization: `Bearer ${params.apiKey}` },
        })
        let settled = false
        let timeout: NodeJS.Timeout | null = null

        const cleanup = (): void => {
          socket.removeAllListeners()
        }

        const closeSocket = (): void => {
          if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close()
        }

        const fail = (error: Error): void => {
          if (settled) return
          settled = true
          if (timeout) clearTimeout(timeout)
          cleanup()
          closeSocket()
          reject(error)
        }

        const succeed = (): void => {
          if (settled) return
          settled = true
          if (timeout) clearTimeout(timeout)
          cleanup()
          closeSocket()
          if (chunks.length === 0) {
            reject(new Error('Qwen TTS realtime returned empty audio'))
            return
          }
          resolve({
            wav: wrapPcm16MonoToWav(Buffer.concat(chunks), 24000),
            sourceUrl: `realtime://${params.model}/${params.voice}`,
          })
        }

        const resetTimeout = (): void => {
          if (timeout) clearTimeout(timeout)
          timeout = setTimeout(() => {
            fail(new Error(`Qwen TTS realtime timeout: ${params.model}`))
          }, params.requestTimeoutMs)
        }

        const sendEvent = (payload: Record<string, unknown>): void => {
          socket.send(JSON.stringify({
            event_id: `event_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            ...payload,
          }))
        }

        socket.on('open', () => {
          resetTimeout()
          logIfNeeded(params, 'qwen realtime session.update')
          sendEvent({
            type: 'session.update',
            session: buildQwenRealtimeSessionConfig({
              model: params.model,
              voice: params.voice,
              instructions: params.instructions,
            }),
          })
        })

        socket.on('message', (raw) => {
          try {
            resetTimeout()
            const event = JSON.parse(raw.toString()) as RealtimeEvent
            const type = typeof event.type === 'string' ? event.type : ''
            if (type !== 'response.audio.delta') {
              logIfNeeded(params, `qwen realtime event=${type || 'unknown'}`)
            }
            if (type === 'session.updated') {
              sendEvent({ type: 'input_text_buffer.append', text: params.text })
              sendEvent({ type: 'input_text_buffer.commit' })
              return
            }
            if (type === 'response.audio.delta') {
              const delta = typeof event.delta === 'string' ? event.delta : ''
              if (delta) chunks.push(Buffer.from(delta, 'base64'))
              return
            }
            if (type === 'response.done') {
              succeed()
              return
            }
            if (type === 'error') {
              const code = typeof event.code === 'string' ? event.code : 'realtime_error'
              const message = typeof event.message === 'string' ? event.message : 'unknown'
              fail(new Error(`Qwen TTS failed: ${code} ${message}`.trim()))
              return
            }
          } catch (error) {
            fail(new Error(`Qwen TTS realtime invalid event: ${formatNetworkError(error)}`))
            return
          }
        })

        socket.on('close', (code, reason) => {
          if (!settled) {
            const reasonText = reason.toString('utf8')
            fail(new Error(`Qwen TTS realtime socket closed: code=${code} reason=${reasonText}`))
          }
        })

        socket.on('error', (error) => {
          fail(new Error(`Qwen TTS realtime transport error: ${formatNetworkError(error)}`))
        })
      })
      return result
    } catch (error) {
      lastError = formatNetworkError(error)
      logIfNeeded(params, `qwen tts retry=${attempt} error=${lastError}`)
      await sleep(1500 * attempt)
    }
  }
  throw new Error(lastError)
}

export async function generateQwenTtsAudio(params: GenerateQwenTtsParams): Promise<GenerateQwenTtsResult> {
  const maxInputBytes = params.maxInputBytes ?? 560
  const textChunks = splitTextForUtf8ByteLimit(params.text, maxInputBytes)
  logIfNeeded(
    params,
    `qwen tts chunks=${textChunks.length} bytes=${textChunks.map((chunk) => Buffer.byteLength(chunk, 'utf8')).join(',')}`,
  )

  const wavBuffers: Buffer[] = []
  const sourceUrls: string[] = []
  for (let index = 0; index < textChunks.length; index += 1) {
    const text = textChunks[index]
    logIfNeeded(params, `qwen tts chunk=${index + 1}/${textChunks.length}`)
    const chunkResult = isRealtimeQwenTtsModel(params.model)
      ? await qwenRealtimeTtsSingle({ ...params, text })
      : await qwenHttpTtsSingle({ ...params, text })
    wavBuffers.push(chunkResult.wav)
    sourceUrls.push(chunkResult.sourceUrl)
  }

  return {
    wav: mergeTtsWavBuffers(wavBuffers),
    sourceUrl: sourceUrls.join(','),
    chunkCount: textChunks.length,
  }
}
