import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { parseGoogleApiKeyList } from '@/lib/google-api'

export const SKILL_ENV_FILE = '/Users/gsdata/.codex/skills/story-video-dialect-release/.env.local'
export const LOCAL_ENV_FILE = '.env.local'

const AUTO_HTTP_PROXY_PORTS = [7890, 7897, 8080, 8888, 20171, 6152]

export type RuntimeProxySource = 'process_env' | 'local_env' | 'skill_env' | 'system_proxy' | 'auto_detected' | 'none'

export interface RuntimeProxySettings {
  source: RuntimeProxySource
  httpProxy: string
  httpsProxy: string
  allProxy: string
  hasProxy: boolean
}

interface ResolveProxySettingsInput {
  processEnv: NodeJS.ProcessEnv
  localEnv: Record<string, string>
  skillEnv: Record<string, string>
  listeningPorts?: number[]
  systemProxy?: {
    httpProxy: string
    httpsProxy: string
    allProxy: string
  }
}

function parseLoopbackProxyPort(value: string): number | null {
  const normalized = value.trim()
  if (!normalized) return null
  const match = normalized.match(/^https?:\/\/(?:127\.0\.0\.1|localhost):(\d+)$/iu)
  if (!match) return null
  const port = Number.parseInt(match[1], 10)
  return Number.isFinite(port) && port > 0 ? port : null
}

function hasUnreachableLoopbackProxy(proxy: {
  httpProxy: string
  httpsProxy: string
  allProxy: string
}, listeningPorts?: number[]): boolean {
  const ports = listeningPorts || listListeningTcpPorts()
  const candidates = [proxy.httpProxy, proxy.httpsProxy, proxy.allProxy]
    .map((value) => parseLoopbackProxyPort(value))
    .filter((value): value is number => value !== null)

  if (candidates.length === 0) return false
  return candidates.some((port) => !ports.includes(port))
}

export function parseEnvFile(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) return {}
  const raw = readFileSync(filePath, 'utf8')
  const rows = raw.split('\n')
  const out: Record<string, string> = {}
  for (const row of rows) {
    const line = row.trim()
    if (!line || line.startsWith('#')) continue
    const idx = line.indexOf('=')
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim()
    const value = line.slice(idx + 1).trim()
    if (!key) continue
    out[key] = value
  }
  return out
}

export function readWorkspaceEnvFiles(workspaceRoot: string): {
  localEnv: Record<string, string>
  skillEnv: Record<string, string>
} {
  return {
    localEnv: parseEnvFile(path.join(workspaceRoot, LOCAL_ENV_FILE)),
    skillEnv: parseEnvFile(SKILL_ENV_FILE),
  }
}

export function pickFirstNonEmpty(values: Array<string | undefined>): string {
  for (const item of values) {
    const normalized = (item || '').trim()
    if (normalized) return normalized
  }
  return ''
}

export function resolveGoogleApiKeysFromEnvSources(params: {
  processEnv: NodeJS.ProcessEnv
  localEnv: Record<string, string>
  skillEnv: Record<string, string>
}): string[] {
  return parseGoogleApiKeyList([
    params.processEnv.GOOGLE_API_KEYS,
    params.processEnv.GOOGLE_API_KEY,
    params.localEnv.GOOGLE_API_KEYS,
    params.localEnv.GOOGLE_API_KEY,
    params.skillEnv.GOOGLE_API_KEYS,
    params.skillEnv.GOOGLE_API_KEY,
  ])
}

export function withProxyNodeOptions(baseOptions: string, hasProxy: boolean): string {
  const options = baseOptions.trim()
  if (!hasProxy) return options
  if (options.includes('--use-env-proxy')) return options
  if (!options) return '--use-env-proxy'
  return `${options} --use-env-proxy`
}

export function listListeningTcpPorts(): number[] {
  try {
    const output = execFileSync('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const ports = new Set<number>()
    const matches = output.matchAll(/:(\d+)\s+\(LISTEN\)/g)
    for (const match of matches) {
      const raw = match[1]
      const port = Number.parseInt(raw, 10)
      if (Number.isFinite(port) && port > 0) ports.add(port)
    }
    return [...ports].sort((a, b) => a - b)
  } catch {
    return []
  }
}

function autoDetectedProxyUrl(listeningPorts?: number[]): string {
  const ports = listeningPorts || listListeningTcpPorts()
  for (const port of AUTO_HTTP_PROXY_PORTS) {
    if (ports.includes(port)) {
      return `http://127.0.0.1:${port}`
    }
  }
  return ''
}

function extractScutilProxyValue(raw: string, key: string): string {
  const match = raw.match(new RegExp(`${key}\\s*:\\s*([^\\n]+)`))
  return match?.[1]?.trim() || ''
}

export function readMacOsSystemProxy(): {
  httpProxy: string
  httpsProxy: string
  allProxy: string
} {
  try {
    const output = execFileSync('scutil', ['--proxy'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const httpEnabled = extractScutilProxyValue(output, 'HTTPEnable') === '1'
    const httpsEnabled = extractScutilProxyValue(output, 'HTTPSEnable') === '1'
    const socksEnabled = extractScutilProxyValue(output, 'SOCKSEnable') === '1'

    const httpHost = extractScutilProxyValue(output, 'HTTPProxy')
    const httpPort = extractScutilProxyValue(output, 'HTTPPort')
    const httpsHost = extractScutilProxyValue(output, 'HTTPSProxy')
    const httpsPort = extractScutilProxyValue(output, 'HTTPSPort')
    const socksHost = extractScutilProxyValue(output, 'SOCKSProxy')
    const socksPort = extractScutilProxyValue(output, 'SOCKSPort')

    const httpProxy = httpEnabled && httpHost && httpPort ? `http://${httpHost}:${httpPort}` : ''
    const httpsProxy = httpsEnabled && httpsHost && httpsPort ? `http://${httpsHost}:${httpsPort}` : ''
    const allProxy = socksEnabled && socksHost && socksPort ? `socks5://${socksHost}:${socksPort}` : ''
    return { httpProxy, httpsProxy, allProxy }
  } catch {
    return {
      httpProxy: '',
      httpsProxy: '',
      allProxy: '',
    }
  }
}

export function resolveProxySettings(input: ResolveProxySettingsInput): RuntimeProxySettings {
  const explicitProcessHttp = pickFirstNonEmpty([
    input.processEnv.HTTP_PROXY,
    input.processEnv.http_proxy,
  ])
  const explicitProcessHttps = pickFirstNonEmpty([
    input.processEnv.HTTPS_PROXY,
    input.processEnv.https_proxy,
  ])
  const explicitProcessAll = pickFirstNonEmpty([
    input.processEnv.ALL_PROXY,
    input.processEnv.all_proxy,
  ])
  if (explicitProcessHttp || explicitProcessHttps || explicitProcessAll) {
    const processProxy = {
      source: 'process_env' as const,
      httpProxy: explicitProcessHttp,
      httpsProxy: explicitProcessHttps,
      allProxy: explicitProcessAll,
      hasProxy: true,
    }
    if (!hasUnreachableLoopbackProxy(processProxy, input.listeningPorts)) {
      return processProxy
    }
  }

  const localHttp = pickFirstNonEmpty([input.localEnv.HTTP_PROXY, input.localEnv.http_proxy])
  const localHttps = pickFirstNonEmpty([input.localEnv.HTTPS_PROXY, input.localEnv.https_proxy])
  const localAll = pickFirstNonEmpty([input.localEnv.ALL_PROXY, input.localEnv.all_proxy])
  if (localHttp || localHttps || localAll) {
    const localProxy = {
      source: 'local_env' as const,
      httpProxy: localHttp,
      httpsProxy: localHttps,
      allProxy: localAll,
      hasProxy: true,
    }
    if (!hasUnreachableLoopbackProxy(localProxy, input.listeningPorts)) {
      return localProxy
    }
  }

  const skillHttp = pickFirstNonEmpty([input.skillEnv.HTTP_PROXY, input.skillEnv.http_proxy])
  const skillHttps = pickFirstNonEmpty([input.skillEnv.HTTPS_PROXY, input.skillEnv.https_proxy])
  const skillAll = pickFirstNonEmpty([input.skillEnv.ALL_PROXY, input.skillEnv.all_proxy])
  if (skillHttp || skillHttps || skillAll) {
    const skillProxy = {
      source: 'skill_env' as const,
      httpProxy: skillHttp,
      httpsProxy: skillHttps,
      allProxy: skillAll,
      hasProxy: true,
    }
    if (!hasUnreachableLoopbackProxy(skillProxy, input.listeningPorts)) {
      return skillProxy
    }
  }

  const systemProxy = input.systemProxy || readMacOsSystemProxy()
  if (systemProxy.httpProxy || systemProxy.httpsProxy || systemProxy.allProxy) {
    const resolvedSystemProxy = {
      source: 'system_proxy' as const,
      httpProxy: systemProxy.httpProxy,
      httpsProxy: systemProxy.httpsProxy,
      allProxy: systemProxy.allProxy,
      hasProxy: true,
    }
    if (!hasUnreachableLoopbackProxy(resolvedSystemProxy, input.listeningPorts)) {
      return resolvedSystemProxy
    }
  }

  const detectedHttpProxy = autoDetectedProxyUrl(input.listeningPorts)
  if (detectedHttpProxy) {
    return {
      source: 'auto_detected',
      httpProxy: detectedHttpProxy,
      httpsProxy: detectedHttpProxy,
      allProxy: '',
      hasProxy: true,
    }
  }

  return {
    source: 'none',
    httpProxy: '',
    httpsProxy: '',
    allProxy: '',
    hasProxy: false,
  }
}

export function applyProxyEnv(baseEnv: NodeJS.ProcessEnv, proxy: RuntimeProxySettings): NodeJS.ProcessEnv {
  const nextEnv: NodeJS.ProcessEnv = {
    ...baseEnv,
    NODE_OPTIONS: withProxyNodeOptions(baseEnv.NODE_OPTIONS || '', proxy.hasProxy),
  }
  if (proxy.httpProxy) {
    nextEnv.HTTP_PROXY = proxy.httpProxy
    nextEnv.http_proxy = proxy.httpProxy
  }
  if (proxy.httpsProxy) {
    nextEnv.HTTPS_PROXY = proxy.httpsProxy
    nextEnv.https_proxy = proxy.httpsProxy
  }
  if (proxy.allProxy) {
    nextEnv.ALL_PROXY = proxy.allProxy
    nextEnv.all_proxy = proxy.allProxy
  }
  return nextEnv
}

export function formatProxyLogLine(proxy: RuntimeProxySettings): string {
  return [
    `RUNTIME_PROXY source=${proxy.source}`,
    `http=${proxy.httpProxy || '-'}`,
    `https=${proxy.httpsProxy || '-'}`,
    `all=${proxy.allProxy || '-'}`,
  ].join(' ')
}
