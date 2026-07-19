export interface StoryCatalogRecord {
  id: string
  title: string
  titleAliases: string[]
  volume: string
  priority: string
  hookType: string
  textCharCount: number
  localTextPath: string
  sourceFilePath: string
  sourceCatalogPath: string
}

export type StoryGeneratedSourceKind =
  | 'release_manifest'
  | 'release_manifest_legacy'
  | 'run_summary'
  | 'run_dir_scan'

export type StoryGeneratedEvidenceKind =
  | 'release_selector'
  | 'release_story_source'
  | 'release_filename'
  | 'release_run_dir'
  | 'run_summary_story_source'
  | 'run_dir_name'

export interface StoryGeneratedAsset {
  releaseFile: string
  generatedAt: string | null
  runDir: string
  videoPath: string | null
  hardSubVideoPath: string | null
  softSubVideoPath: string | null
  subtitlePath: string | null
  coverPath: string | null
  sourceKind: StoryGeneratedSourceKind
  evidenceKind: StoryGeneratedEvidenceKind
}

export type StoryRecordDataQuality = 'pending' | 'clean' | 'manifest-only' | 'legacy-run' | 'orphan-run'

export interface StoryMaterialRecord extends StoryCatalogRecord {
  isGenerated: boolean
  generatedCount: number
  latestGeneratedAt: string | null
  latestAsset: StoryGeneratedAsset | null
  hasReleaseManifest: boolean
  hasRunSummary: boolean
  generatedEvidence: StoryGeneratedEvidenceKind[]
  videoCandidates: string[]
  dataQuality: StoryRecordDataQuality
}

export interface StoryMaterialsSummary {
  totalStories: number
  generatedStories: number
  pendingStories: number
  byPriority: Record<string, number>
  byVolume: Record<string, number>
}

export interface StoryMaterialsDatabase {
  generatedAt: string
  workspaceRoot: string
  catalogPath: string
  runsDir: string
  dbPath: string
  summary: StoryMaterialsSummary
  records: StoryMaterialRecord[]
  parseErrors: Array<{ file: string; error: string }>
}
