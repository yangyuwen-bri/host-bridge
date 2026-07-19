function parseCsvLine(line: string): string[] {
  const values: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    const next = i + 1 < line.length ? line[i + 1] : ''

    if (char === '"' && inQuotes && next === '"') {
      current += '"'
      i += 1
      continue
    }
    if (char === '"') {
      inQuotes = !inQuotes
      continue
    }
    if (char === ',' && !inQuotes) {
      values.push(current)
      current = ''
      continue
    }
    current += char
  }
  values.push(current)
  return values
}

export function parseCsvToRows(csvContent: string): string[][] {
  const lines = csvContent
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)

  return lines.map(parseCsvLine)
}

export function parseCsvToObjects(csvContent: string): Array<Record<string, string>> {
  const rows = parseCsvToRows(csvContent)
  if (rows.length === 0) return []
  const header = rows[0]
  const objects: Array<Record<string, string>> = []
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i]
    const entry: Record<string, string> = {}
    for (let c = 0; c < header.length; c += 1) {
      const key = header[c]
      entry[key] = row[c] || ''
    }
    objects.push(entry)
  }
  return objects
}
