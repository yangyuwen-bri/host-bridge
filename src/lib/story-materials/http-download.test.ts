import * as http from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { downloadBinaryWithRedirects } from './http-download'

const servers: http.Server[] = []

async function listen(server: http.Server): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  servers.push(server)
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('TEST_SERVER_ADDRESS_INVALID')
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error)
          else resolve()
        })
      })
    },
  }
}

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop()
    if (!server) continue
    if (!server.listening) continue
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  }
})

describe('downloadBinaryWithRedirects', () => {
  it('http audio response -> returns exact bytes', async () => {
    const payload = Buffer.from('RIFF_test_audio_payload', 'utf8')
    const server = http.createServer((request, response) => {
      if (request.url !== '/audio.wav') {
        response.statusCode = 404
        response.end('missing')
        return
      }
      response.statusCode = 200
      response.setHeader('Content-Type', 'audio/x-wav')
      response.end(payload)
    })
    const { baseUrl } = await listen(server)

    const result = await downloadBinaryWithRedirects({
      url: `${baseUrl}/audio.wav`,
      timeoutMs: 3_000,
    })

    expect(result.equals(payload)).toBe(true)
    expect(result.byteLength).toBe(payload.byteLength)
  })

  it('redirect response -> follows location and returns final bytes', async () => {
    const payload = Buffer.from('redirected-audio', 'utf8')
    const server = http.createServer((request, response) => {
      if (request.url === '/redirect') {
        response.statusCode = 302
        response.setHeader('Location', '/final.wav')
        response.end()
        return
      }
      if (request.url === '/final.wav') {
        response.statusCode = 200
        response.end(payload)
        return
      }
      response.statusCode = 404
      response.end('missing')
    })
    const { baseUrl } = await listen(server)

    const result = await downloadBinaryWithRedirects({
      url: `${baseUrl}/redirect`,
      timeoutMs: 3_000,
    })

    expect(result.toString('utf8')).toBe('redirected-audio')
  })

  it('slow response beyond timeout -> rejects with timeout marker', async () => {
    const server = http.createServer((_request, response) => {
      setTimeout(() => {
        response.statusCode = 200
        response.end('late')
      }, 150)
    })
    const { baseUrl } = await listen(server)

    await expect(downloadBinaryWithRedirects({
      url: `${baseUrl}/slow.wav`,
      timeoutMs: 50,
    })).rejects.toThrow('DOWNLOAD_TIMEOUT')
  })

  it('chunked response with steady progress -> does not timeout before completion', async () => {
    const payload = Buffer.from('steady-progress-payload', 'utf8')
    const server = http.createServer((_request, response) => {
      response.statusCode = 200
      response.setHeader('Content-Type', 'application/octet-stream')

      let index = 0
      const timer = setInterval(() => {
        if (index >= payload.length) {
          clearInterval(timer)
          response.end()
          return
        }
        response.write(payload.subarray(index, index + 1))
        index += 1
      }, 10)
    })
    const { baseUrl } = await listen(server)

    const result = await downloadBinaryWithRedirects({
      url: `${baseUrl}/chunked.bin`,
      timeoutMs: 50,
    })

    expect(result.equals(payload)).toBe(true)
  })
})
