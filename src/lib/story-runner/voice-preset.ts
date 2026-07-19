import path from 'node:path'

export type VoicePreset = {
  idx: number
  preferredName: string
  label: string
  status: string
  voicePrompt: string
  previewText: string
  voiceId: string
  requestId: string
  localFile: string
  error: string
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]

    if (char === '"') {
      const next = i + 1 < line.length ? line[i + 1] : ''
      if (inQuotes && next === '"') {
        current += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (char === ',' && !inQuotes) {
      cells.push(current.trim())
      current = ''
      continue
    }

    current += char
  }

  cells.push(current.trim())
  return cells
}

export function parseVoicePresetCsv(csvContent: string): VoicePreset[] {
  const lines = csvContent
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  if (lines.length < 2) return []

  const headers = splitCsvLine(lines[0])
  const indexByHeader = new Map<string, number>()
  headers.forEach((header, idx) => {
    indexByHeader.set(header, idx)
  })

  const readCell = (row: string[], key: string): string => {
    const idx = indexByHeader.get(key)
    if (idx === undefined || idx >= row.length) return ''
    return row[idx] || ''
  }

  const result: VoicePreset[] = []
  for (let i = 1; i < lines.length; i += 1) {
    const row = splitCsvLine(lines[i])
    const rawIdx = Number.parseInt(readCell(row, 'idx'), 10)
    result.push({
      idx: Number.isFinite(rawIdx) ? rawIdx : i,
      preferredName: readCell(row, 'preferred_name'),
      label: readCell(row, 'label'),
      status: readCell(row, 'status'),
      voicePrompt: readCell(row, 'voice_prompt'),
      previewText: readCell(row, 'preview_text'),
      voiceId: readCell(row, 'voice_id'),
      requestId: readCell(row, 'request_id'),
      localFile: readCell(row, 'local_file'),
      error: readCell(row, 'error'),
    })
  }

  return result
}

export function findVoicePresetByFile(presets: VoicePreset[], voiceFilePath: string): VoicePreset | null {
  const fileName = path.basename(voiceFilePath)
  for (const preset of presets) {
    if (preset.localFile === fileName) {
      return preset
    }
  }
  return null
}
