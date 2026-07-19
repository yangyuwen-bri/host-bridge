import { createRequire } from 'node:module'

type OpenCcLocale = 'cn' | 'hk' | 'jp' | 't' | 'tw' | 'twp'

type OpenCcConverter = (input: string) => string

type OpenCcModule = {
  Converter: (options: { from: OpenCcLocale; to: OpenCcLocale }) => OpenCcConverter
}

const require = createRequire(import.meta.url)
const openCcModuleUnknown: unknown = require('opencc-js')
const openCcModule = openCcModuleUnknown as OpenCcModule
const traditionalToSimplified = openCcModule.Converter({ from: 'tw', to: 'cn' })

export function toSimplifiedChinese(text: string): string {
  if (!text) return text
  return traditionalToSimplified(text)
}

export function deepConvertTraditionalToSimplified<T>(value: T): T {
  if (typeof value === 'string') {
    return toSimplifiedChinese(value) as T
  }
  if (Array.isArray(value)) {
    return value.map((item) => deepConvertTraditionalToSimplified(item)) as T
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const normalizedEntries = Object.entries(record).map(([key, entryValue]) => [
      key,
      deepConvertTraditionalToSimplified(entryValue),
    ])
    return Object.fromEntries(normalizedEntries) as T
  }
  return value
}
