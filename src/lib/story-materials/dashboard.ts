import type { StoryMaterialRecord } from './types'

export type StoryMaterialThemeId =
  | 'social'
  | 'justice'
  | 'family'
  | 'fraud'
  | 'officialdom'
  | 'romance'
  | 'spectacle'
  | 'ghost'
  | 'ritual'
  | 'other'

export interface StoryMaterialThemeDefinition {
  id: StoryMaterialThemeId
  label: string
  shortLabel: string
  description: string
  accent: string
}

export interface StoryMaterialThemeRow extends StoryMaterialThemeDefinition {
  total: number
  generated: number
  pending: number
  completionRate: number
  recommended: StoryMaterialRecord[]
}

export interface StoryMaterialVolumeRow {
  volume: string
  total: number
  generated: number
  pending: number
  completionRate: number
  sCount: number
  aCount: number
  averageChars: number
  topThemes: Array<{ label: string; count: number }>
}

export interface StoryMaterialOpsFunnel {
  total: number
  generated: number
  pending: number
  withHardSub: number
  withCopyReady: number
  manifestHealthy: number
  needsAudit: number
}

export interface StoryMaterialRecommendation {
  record: StoryMaterialRecord
  theme: StoryMaterialThemeDefinition
  reason: string
  score: number
}

export interface StoryMaterialsDashboard {
  funnel: StoryMaterialOpsFunnel
  volumeRows: StoryMaterialVolumeRow[]
  themeRows: StoryMaterialThemeRow[]
  recommendations: StoryMaterialRecommendation[]
  needsAudit: StoryMaterialRecord[]
}

const THEME_DEFINITIONS: StoryMaterialThemeDefinition[] = [
  {
    id: 'social',
    label: '社会民生',
    shortLabel: '民生',
    description: '生计、邻里、底层遭遇、乡村秩序和公共风险。',
    accent: '#d6a84f',
  },
  {
    id: 'justice',
    label: '冤案公堂',
    shortLabel: '公义',
    description: '告状、审案、报官、冤屈、迟来的追责。',
    accent: '#bd5b42',
  },
  {
    id: 'family',
    label: '家庭伦理',
    shortLabel: '家事',
    description: '夫妻、父母子女、婚姻、家族责任与误会。',
    accent: '#8b7758',
  },
  {
    id: 'fraud',
    label: '骗局报应',
    shortLabel: '骗局',
    description: '骗术、贪财、盗墓、诱骗、因果反噬。',
    accent: '#c47c39',
  },
  {
    id: 'officialdom',
    label: '官场权力',
    shortLabel: '官场',
    description: '官员、衙署、军营、权力关系和制度秩序。',
    accent: '#60735a',
  },
  {
    id: 'romance',
    label: '婚恋情债',
    shortLabel: '情债',
    description: '情爱、负心、色欲、婚恋纠葛。',
    accent: '#9a596b',
  },
  {
    id: 'spectacle',
    label: '妖怪奇观',
    shortLabel: '奇观',
    description: '妖物、异兽、怪象和强视觉奇观。',
    accent: '#4f756f',
  },
  {
    id: 'ghost',
    label: '鬼神报应',
    shortLabel: '鬼神',
    description: '鬼魂、阴司、城隍、冥府和报应。',
    accent: '#53617d',
  },
  {
    id: 'ritual',
    label: '奇人异术',
    shortLabel: '异术',
    description: '道士、和尚、术法、梦兆、乩神。',
    accent: '#756090',
  },
  {
    id: 'other',
    label: '未归类',
    shortLabel: '其他',
    description: '暂未识别到明确运营主题。',
    accent: '#6f6a61',
  },
]

export const STORY_MATERIAL_THEME_DEFINITIONS: readonly StoryMaterialThemeDefinition[] = THEME_DEFINITIONS

const THEME_BY_ID = new Map<StoryMaterialThemeId, StoryMaterialThemeDefinition>(
  THEME_DEFINITIONS.map((theme) => [theme.id, theme]),
)

const KEYWORDS: Record<Exclude<StoryMaterialThemeId, 'other'>, string[]> = {
  social: ['營卒', '营卒', '乞', '窮', '贫', '傭工', '佣工', '鄰', '邻', '村', '民', '商', '市', '災', '灾', '病', '葬', '塚', '墓', '荒', '飯', '米'],
  justice: ['冤', '案', '讞', '獄', '狱', '告', '控', '訟', '讼', '官', '審', '审', '判', '城隍', '東嶽', '东岳', '雷誅', '雷诛'],
  family: ['妻', '夫', '婦', '妇', '父', '母', '子', '兒', '儿', '女', '媳', '姑', '叔', '兄', '弟', '家', '孝'],
  fraud: ['騙', '骗', '盜', '盗', '賊', '贼', '財', '财', '錢', '钱', '妖人', '發塚', '发塚', '掘塚', '诈', '誘', '诱'],
  officialdom: ['官', '府', '衙', '軍', '军', '營', '营', '將軍', '将军', '巡撫', '刺史', '縣', '县', '王', '帝', '差役'],
  romance: ['愛', '爱', '情', '負心', '负心', '娼', '妓', '妾', '婚', '嫁', '娶', '郎', '美色', '相思'],
  spectacle: ['妖', '精', '怪', '龍', '龙', '蛇', '狐', '虎', '獸', '兽', '異', '异', '僵屍', '僵尸'],
  ghost: ['鬼', '魂', '陰', '阴', '冥', '亡', '死', '屍', '尸', '夢', '梦', '城隍', '地府'],
  ritual: ['道士', '和尚', '僧', '尼', '咒', '符', '乩', '神', '仙', '術', '术', '廟', '庙', '佛'],
}

function clampRate(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  if (value >= 1) return 1
  return value
}

function completionRate(total: number, generated: number): number {
  if (total <= 0) return 0
  return clampRate(generated / total)
}

function matchKeywordScore(text: string, words: string[]): number {
  let score = 0
  for (const word of words) {
    if (text.includes(word)) score += 1
  }
  return score
}

export function classifyStoryMaterial(record: StoryMaterialRecord): StoryMaterialThemeDefinition {
  const haystack = `${record.title} ${record.hookType} ${record.titleAliases.join(' ')}`
  let bestTheme: StoryMaterialThemeId = 'other'
  let bestScore = 0
  for (const [themeId, words] of Object.entries(KEYWORDS) as Array<[Exclude<StoryMaterialThemeId, 'other'>, string[]]>) {
    const score = matchKeywordScore(haystack, words)
    if (score > bestScore) {
      bestTheme = themeId
      bestScore = score
    }
  }
  return THEME_BY_ID.get(bestTheme) || THEME_DEFINITIONS[THEME_DEFINITIONS.length - 1]
}

function priorityScore(priority: string): number {
  if (priority === 'S') return 36
  if (priority === 'A') return 24
  if (priority === 'B') return 12
  return 4
}

function lengthScore(chars: number): number {
  if (chars >= 500 && chars <= 1200) return 24
  if (chars >= 350 && chars < 500) return 16
  if (chars > 1200 && chars <= 1800) return 14
  if (chars > 1800) return 6
  return 4
}

function themeProductionScore(themeId: StoryMaterialThemeId): number {
  if (themeId === 'social') return 30
  if (themeId === 'justice') return 28
  if (themeId === 'family') return 20
  if (themeId === 'fraud') return 18
  if (themeId === 'officialdom') return 14
  return 6
}

function recommendationReason(record: StoryMaterialRecord, theme: StoryMaterialThemeDefinition): string {
  const bits = [`${theme.label}`]
  if (record.priority === 'S' || record.priority === 'A') bits.push(`${record.priority}级`)
  if (record.textCharCount >= 500 && record.textCharCount <= 1200) bits.push('篇幅适中')
  if (!record.isGenerated) bits.push('未生产')
  return bits.join(' · ')
}

export function buildStoryMaterialsDashboard(records: StoryMaterialRecord[]): StoryMaterialsDashboard {
  const funnel: StoryMaterialOpsFunnel = {
    total: records.length,
    generated: 0,
    pending: 0,
    withHardSub: 0,
    withCopyReady: 0,
    manifestHealthy: 0,
    needsAudit: 0,
  }

  const volumeMap = new Map<string, StoryMaterialRecord[]>()
  const themeMap = new Map<StoryMaterialThemeId, StoryMaterialRecord[]>()
  const needsAudit: StoryMaterialRecord[] = []

  for (const record of records) {
    if (record.isGenerated) funnel.generated += 1
    else funnel.pending += 1
    if (record.latestAsset?.hardSubVideoPath) funnel.withHardSub += 1
    if (record.hasReleaseManifest) funnel.manifestHealthy += 1
    if (record.dataQuality !== 'clean') {
      funnel.needsAudit += 1
      needsAudit.push(record)
    }

    const volumeRows = volumeMap.get(record.volume) || []
    volumeRows.push(record)
    volumeMap.set(record.volume, volumeRows)

    const theme = classifyStoryMaterial(record)
    const themeRows = themeMap.get(theme.id) || []
    themeRows.push(record)
    themeMap.set(theme.id, themeRows)
  }

  const volumeRows: StoryMaterialVolumeRow[] = [...volumeMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([volume, rows]) => {
      const generated = rows.filter((record) => record.isGenerated).length
      const themeCounts = new Map<string, number>()
      for (const record of rows) {
        const theme = classifyStoryMaterial(record)
        themeCounts.set(theme.shortLabel, (themeCounts.get(theme.shortLabel) || 0) + 1)
      }
      return {
        volume,
        total: rows.length,
        generated,
        pending: rows.length - generated,
        completionRate: completionRate(rows.length, generated),
        sCount: rows.filter((record) => record.priority === 'S').length,
        aCount: rows.filter((record) => record.priority === 'A').length,
        averageChars: Math.round(rows.reduce((sum, record) => sum + record.textCharCount, 0) / Math.max(1, rows.length)),
        topThemes: [...themeCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 2)
          .map(([label, count]) => ({ label, count })),
      }
    })

  const themeRows: StoryMaterialThemeRow[] = THEME_DEFINITIONS.map((theme) => {
    const rows = themeMap.get(theme.id) || []
    const generated = rows.filter((record) => record.isGenerated).length
    const recommended = [...rows]
      .filter((record) => !record.isGenerated)
      .sort((a, b) => {
        const left = priorityScore(b.priority) + lengthScore(b.textCharCount)
        const right = priorityScore(a.priority) + lengthScore(a.textCharCount)
        if (left !== right) return left - right
        return a.id.localeCompare(b.id)
      })
      .slice(0, 3)
    return {
      ...theme,
      total: rows.length,
      generated,
      pending: rows.length - generated,
      completionRate: completionRate(rows.length, generated),
      recommended,
    }
  })

  const recommendations: StoryMaterialRecommendation[] = records
    .filter((record) => !record.isGenerated)
    .map((record) => {
      const theme = classifyStoryMaterial(record)
      const score = priorityScore(record.priority) + lengthScore(record.textCharCount) + themeProductionScore(theme.id)
      return {
        record,
        theme,
        reason: recommendationReason(record, theme),
        score,
      }
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return a.record.id.localeCompare(b.record.id)
    })
    .slice(0, 8)

  return {
    funnel,
    volumeRows,
    themeRows,
    recommendations,
    needsAudit: needsAudit.slice(0, 8),
  }
}
