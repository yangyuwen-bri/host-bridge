import { describe, expect, it } from 'vitest'
import {
  applyProxyEnv,
  formatProxyLogLine,
  resolveGoogleApiKeysFromEnvSources,
  resolveProxySettings,
} from './runtime-env'

describe('story materials runtime env', () => {
  it('prefers explicit process proxy settings when the loopback proxy is reachable', () => {
    const proxy = resolveProxySettings({
      processEnv: {
        HTTP_PROXY: 'http://127.0.0.1:9999',
      },
      localEnv: {
        HTTP_PROXY: 'http://127.0.0.1:7890',
      },
      skillEnv: {
        HTTP_PROXY: 'http://127.0.0.1:7897',
      },
      systemProxy: {
        httpProxy: '',
        httpsProxy: '',
        allProxy: '',
      },
      listeningPorts: [7890],
    })

    expect(proxy.source).toBe('local_env')
    expect(proxy.httpProxy).toBe('http://127.0.0.1:7890')
    expect(proxy.hasProxy).toBe(true)
  })

  it('keeps explicit non-loopback process proxy settings even without listening port hints', () => {
    const proxy = resolveProxySettings({
      processEnv: {
        HTTPS_PROXY: 'http://proxy.example.com:8080',
      },
      localEnv: {},
      skillEnv: {},
      systemProxy: {
        httpProxy: '',
        httpsProxy: '',
        allProxy: '',
      },
      listeningPorts: [],
    })

    expect(proxy.source).toBe('process_env')
    expect(proxy.httpsProxy).toBe('http://proxy.example.com:8080')
    expect(proxy.hasProxy).toBe(true)
  })

  it('uses auto detected local proxy when no explicit settings exist', () => {
    const proxy = resolveProxySettings({
      processEnv: {},
      localEnv: {},
      skillEnv: {},
      systemProxy: {
        httpProxy: '',
        httpsProxy: '',
        allProxy: '',
      },
      listeningPorts: [7891, 7890],
    })

    expect(proxy.source).toBe('auto_detected')
    expect(proxy.httpProxy).toBe('http://127.0.0.1:7890')
    expect(proxy.httpsProxy).toBe('http://127.0.0.1:7890')
    expect(proxy.hasProxy).toBe(true)
  })

  it('returns none when only unreachable loopback proxies are configured', () => {
    const proxy = resolveProxySettings({
      processEnv: {
        HTTP_PROXY: 'http://127.0.0.1:7890',
      },
      localEnv: {},
      skillEnv: {},
      systemProxy: {
        httpProxy: '',
        httpsProxy: '',
        allProxy: '',
      },
      listeningPorts: [],
    })

    expect(proxy.source).toBe('none')
    expect(proxy.hasProxy).toBe(false)
    expect(proxy.httpProxy).toBe('')
  })

  it('uses macOS system proxy when explicit env and auto detection are unavailable', () => {
    const proxy = resolveProxySettings({
      processEnv: {},
      localEnv: {},
      skillEnv: {},
      systemProxy: {
        httpProxy: 'http://127.0.0.1:65013',
        httpsProxy: 'http://127.0.0.1:65013',
        allProxy: 'socks5://127.0.0.1:65013',
      },
      listeningPorts: [65013],
    })

    expect(proxy.source).toBe('system_proxy')
    expect(proxy.httpProxy).toBe('http://127.0.0.1:65013')
    expect(proxy.httpsProxy).toBe('http://127.0.0.1:65013')
    expect(proxy.hasProxy).toBe(true)
  })

  it('adds proxy env vars and use-env-proxy node option', () => {
    const nextEnv = applyProxyEnv(
      {
        NODE_OPTIONS: '--trace-warnings',
      },
      {
        source: 'auto_detected',
        httpProxy: 'http://127.0.0.1:7890',
        httpsProxy: 'http://127.0.0.1:7890',
        allProxy: '',
        hasProxy: true,
      },
    )

    expect(nextEnv.HTTP_PROXY).toBe('http://127.0.0.1:7890')
    expect(nextEnv.HTTPS_PROXY).toBe('http://127.0.0.1:7890')
    expect(nextEnv.NODE_OPTIONS).toContain('--trace-warnings')
    expect(nextEnv.NODE_OPTIONS).toContain('--use-env-proxy')
  })

  it('formats proxy log line for runtime diagnostics', () => {
    const line = formatProxyLogLine({
      source: 'auto_detected',
      httpProxy: 'http://127.0.0.1:7890',
      httpsProxy: 'http://127.0.0.1:7890',
      allProxy: '',
      hasProxy: true,
    })

    expect(line).toContain('source=auto_detected')
    expect(line).toContain('http=http://127.0.0.1:7890')
    expect(line).toContain('all=-')
  })

  it('resolves deduplicated google api key pools from env sources in priority order', () => {
    const keys = resolveGoogleApiKeysFromEnvSources({
      processEnv: {
        GOOGLE_API_KEYS: 'process-a,process-b',
        GOOGLE_API_KEY: 'process-b',
      },
      localEnv: {
        GOOGLE_API_KEYS: 'local-a,process-a',
        GOOGLE_API_KEY: 'local-b',
      },
      skillEnv: {
        GOOGLE_API_KEYS: 'skill-a',
        GOOGLE_API_KEY: 'local-b',
      },
    })

    expect(keys).toEqual(['process-a', 'process-b', 'local-a', 'local-b', 'skill-a'])
  })
})
