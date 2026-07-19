import * as http from 'node:http'
import * as https from 'node:https'

const DEFAULT_MAX_REDIRECTS = 5

function selectClient(protocol: string): typeof http | typeof https {
  if (protocol === 'http:') return http
  if (protocol === 'https:') return https
  throw new Error(`UNSUPPORTED_DOWNLOAD_PROTOCOL: ${protocol}`)
}

export async function downloadBinaryWithRedirects(params: {
  url: string
  timeoutMs: number
  maxRedirects?: number
}): Promise<Buffer> {
  const maxRedirects = params.maxRedirects ?? DEFAULT_MAX_REDIRECTS
  return downloadBinaryOnce(params.url, params.timeoutMs, maxRedirects)
}

async function downloadBinaryOnce(url: string, timeoutMs: number, redirectsRemaining: number): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    let settled = false
    const target = new URL(url)
    const client = selectClient(target.protocol)
    const request = client.get(target, (response) => {
      const statusCode = response.statusCode ?? 0
      const location = response.headers.location

      if (
        location
        && statusCode >= 300
        && statusCode < 400
      ) {
        response.resume()
        if (redirectsRemaining <= 0) {
          settled = true
          reject(new Error(`DOWNLOAD_TOO_MANY_REDIRECTS: ${url}`))
          return
        }
        const nextUrl = new URL(location, target).toString()
        void downloadBinaryOnce(nextUrl, timeoutMs, redirectsRemaining - 1)
          .then((buffer) => {
            if (settled) return
            settled = true
            resolve(buffer)
          })
          .catch((error: unknown) => {
            if (settled) return
            settled = true
            reject(error)
          })
        return
      }

      if (statusCode < 200 || statusCode >= 300) {
        response.resume()
        settled = true
        reject(new Error(`DOWNLOAD_HTTP_${statusCode}: ${url}`))
        return
      }

      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer | string) => {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
      })
      response.on('end', () => {
        if (settled) return
        settled = true
        resolve(Buffer.concat(chunks))
      })
      response.on('error', (error: Error) => {
        if (settled) return
        settled = true
        reject(error)
      })
    })

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`DOWNLOAD_TIMEOUT: ${url}`))
    })
    request.on('error', (error: Error) => {
      if (settled) return
      settled = true
      reject(error)
    })
  })
}
