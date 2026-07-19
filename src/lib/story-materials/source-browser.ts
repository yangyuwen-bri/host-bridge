import type { StoryMaterialRecord } from './types'

export function selectStorySourceRecord(params: {
  allRecords: StoryMaterialRecord[]
  filteredRecords: StoryMaterialRecord[]
  selectedStoryId: string | null
}): StoryMaterialRecord | null {
  if (params.selectedStoryId) {
    const exact = params.allRecords.find((record) => record.id === params.selectedStoryId)
    if (exact) return exact
  }
  return params.filteredRecords[0] || params.allRecords[0] || null
}

export function limitStorySourceIndexRecords(records: StoryMaterialRecord[], limit: number): StoryMaterialRecord[] {
  if (limit <= 0) return []
  return records.slice(0, limit)
}
