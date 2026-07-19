import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { buildAndPersistStoryMaterialsDatabase, readStoryMaterialsDatabase } from '@/lib/story-materials/db'
import { validateStoryId } from '@/lib/story-materials/generate'
import {
  applyProxyEnv,
  readWorkspaceEnvFiles,
  resolveProxySettings,
} from '@/lib/story-materials/runtime-env'

export const STORY_PUBLISH_COPY_SOURCE = {
  MANUAL: 'manual',
  AUTO_ON_VIDEO_SUCCESS: 'auto_on_video_success',
} as const

export type StoryPublishCopySource = (typeof STORY_PUBLISH_COPY_SOURCE)[keyof typeof STORY_PUBLISH_COPY_SOURCE]

export interface StoryPublishCopyRecord {
  id: string
  storyId: string
  storyTitle: string
  runDir: string
  title: string
  hook: string
  content: string
  hashtags: string[]
  body: string
  model: string
  source: StoryPublishCopySource
  generatedAt: string
}

interface StoryPublishCopyStore {
  updatedAt: string
  records: StoryPublishCopyRecord[]
}

interface StoryPublishCopyPlanScene {
  id: number
  summary: string
  voiceOver: string
}

interface StoryPublishCopyPlan {
  title?: unknown
  scenes?: unknown
}

interface DashscopeChatChoiceMessage {
  content?: unknown
}

interface DashscopeChatChoice {
  message?: DashscopeChatChoiceMessage
}

interface DashscopeChatResponse {
  code?: unknown
  message?: unknown
  choices?: unknown
}

export interface GenerateStoryPublishCopyInput {
  workspaceRoot: string
  storyId: string
  runDir?: string | null
  model: string
  source: StoryPublishCopySource
  force?: boolean
}

export interface QueryStoryPublishCopiesInput {
  workspaceRoot: string
  storyId?: string | null
  limit?: number
  latestByStory?: boolean
}

const COPY_STORE_FILENAME = 'story_materials_publish_copies.json'
const STORY_DB_FILENAME = 'story_materials_db.json'
const SKILL_ENV_FILE = '/Users/gsdata/.codex/skills/story-video-dialect-release/.env.local'
const LOCAL_ENV_FILE = '.env.local'
const DEFAULT_LIMIT = 200
const MAX_INPUT_CHARS = 2600
export const DEFAULT_STORY_PUBLISH_COPY_MODEL = 'qwen3-max'
const MAX_SIMPLIFIED_CHINESE_RETRIES = 3

function nowIso(): string {
  return new Date().toISOString()
}

function nowTimestamp(): string {
  const date = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function parseEnvFile(filePath: string): Record<string, string> {
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

function resolveQwenApiKey(workspaceRoot: string): string {
  const localEnv = parseEnvFile(path.join(workspaceRoot, LOCAL_ENV_FILE))
  const skillEnv = parseEnvFile(SKILL_ENV_FILE)
  const apiKey = (
    process.env.QWEN_API_KEY
    || process.env.ALIYUN_API_KEY
    || localEnv.QWEN_API_KEY
    || localEnv.ALIYUN_API_KEY
    || skillEnv.QWEN_API_KEY
    || skillEnv.ALIYUN_API_KEY
    || ''
  ).trim()
  if (!apiKey) throw new Error('MISSING_QWEN_API_KEY')
  return apiKey
}

function copyStorePath(workspaceRoot: string): string {
  return path.join(workspaceRoot, 'materials', 'zhiguai', 'ops', COPY_STORE_FILENAME)
}

function storyDbPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, 'materials', 'zhiguai', 'ops', STORY_DB_FILENAME)
}

export function getStoryPublishCopiesStorePath(workspaceRoot: string): string {
  return copyStorePath(path.resolve(workspaceRoot))
}

function ensureParentDir(filePath: string): void {
  const parent = path.dirname(filePath)
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true })
}

function readStore(workspaceRoot: string): StoryPublishCopyStore {
  const filePath = copyStorePath(workspaceRoot)
  if (!existsSync(filePath)) {
    return {
      updatedAt: nowIso(),
      records: [],
    }
  }
  const raw = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<StoryPublishCopyStore>
  const rows = Array.isArray(raw.records) ? raw.records : []
  const records = rows
    .filter((item): item is StoryPublishCopyRecord => {
      if (!item || typeof item !== 'object') return false
      const row = item as unknown as Record<string, unknown>
      return (
        typeof row.id === 'string'
        && typeof row.storyId === 'string'
        && typeof row.runDir === 'string'
        && typeof row.title === 'string'
        && typeof row.body === 'string'
        && typeof row.model === 'string'
        && typeof row.source === 'string'
        && typeof row.generatedAt === 'string'
      )
    })
    .map((item) => {
      const hashtags = Array.isArray(item.hashtags)
        ? item.hashtags.filter((tag): tag is string => typeof tag === 'string' && !!tag.trim())
        : []
      return {
        ...item,
        hashtags,
      }
    })
  return {
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : nowIso(),
    records,
  }
}

function writeStore(workspaceRoot: string, store: StoryPublishCopyStore): void {
  const filePath = copyStorePath(workspaceRoot)
  ensureParentDir(filePath)
  const payload: StoryPublishCopyStore = {
    updatedAt: nowIso(),
    records: store.records,
  }
  writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8')
}

function readStoryPlan(runDir: string): StoryPublishCopyPlanScene[] {
  const planPath = path.join(runDir, '03_story_plan.json')
  if (!existsSync(planPath)) throw new Error(`STORY_PLAN_NOT_FOUND: ${planPath}`)
  const raw = JSON.parse(readFileSync(planPath, 'utf8')) as StoryPublishCopyPlan
  const rows = Array.isArray(raw.scenes) ? raw.scenes : []
  const scenes = rows
    .map((item, index) => {
      const row = item && typeof item === 'object' ? item as Record<string, unknown> : {}
      const idRaw = row.id
      const id = typeof idRaw === 'number' && Number.isFinite(idRaw) ? Math.floor(idRaw) : index + 1
      const summary = typeof row.summary === 'string' ? row.summary.trim() : ''
      const voiceOver = typeof row.voiceOver === 'string' ? row.voiceOver.trim() : ''
      return { id, summary, voiceOver }
    })
    .filter((item) => !!item.voiceOver || !!item.summary)
  if (scenes.length === 0) throw new Error(`STORY_PLAN_SCENES_EMPTY: ${planPath}`)
  return scenes
}

function resolveStoryRecord(workspaceRoot: string, storyId: string): { title: string; runDir: string } {
  let db = readStoryMaterialsDatabase(storyDbPath(workspaceRoot))
  if (!db) {
    db = buildAndPersistStoryMaterialsDatabase({ workspaceRoot }).database
  }
  const record = db.records.find((item) => item.id === storyId)
  if (!record) throw new Error(`STORY_NOT_FOUND: ${storyId}`)
  const runDir = record.latestAsset?.runDir || ''
  if (!runDir) throw new Error(`NO_GENERATED_RUN_FOR_STORY: ${storyId}`)
  return {
    title: record.title || storyId,
    runDir,
  }
}

function resolveRunDir(workspaceRoot: string, storyId: string, runDirInput?: string | null): { storyTitle: string; runDir: string } {
  const storyRecord = resolveStoryRecord(workspaceRoot, storyId)
  if (!runDirInput || !runDirInput.trim()) {
    const runDir = path.resolve(storyRecord.runDir)
    if (!existsSync(runDir)) throw new Error(`RUN_DIR_NOT_FOUND: ${runDir}`)
    return {
      storyTitle: storyRecord.title,
      runDir,
    }
  }
  const runDir = path.resolve(runDirInput.trim())
  if (!existsSync(runDir)) throw new Error(`RUN_DIR_NOT_FOUND: ${runDir}`)
  return {
    storyTitle: storyRecord.title,
    runDir,
  }
}

function readNarration(runDir: string, scenes: StoryPublishCopyPlanScene[]): string {
  const narrationPath = path.join(runDir, '06_narration.txt')
  if (existsSync(narrationPath)) {
    const text = readFileSync(narrationPath, 'utf8').trim()
    if (text) return text
  }
  return scenes.map((scene) => scene.voiceOver).filter((line) => !!line).join('\n')
}

function clampText(input: string, maxChars: number): string {
  if (input.length <= maxChars) return input
  return `${input.slice(0, maxChars)}...`
}

function toPromptPayload(params: {
  storyId: string
  storyTitle: string
  scenes: StoryPublishCopyPlanScene[]
  narration: string
}): string {
  const sceneDigest = params.scenes
    .slice(0, 8)
    .map((scene) => `场景${scene.id}：${scene.summary || scene.voiceOver.slice(0, 50)}`)
    .join('\n')
  const narrationDigest = clampText(params.narration.replace(/\s+/g, ' ').trim(), MAX_INPUT_CHARS)

  return [
    `故事ID：${params.storyId}`,
    `篇名：${params.storyTitle}`,
    `场景摘要：`,
    sceneDigest,
    `叙事文本：`,
    narrationDigest,
  ].join('\n')
}

function extractTextFromChoiceContent(content: unknown): string {
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) {
    const chunks: string[] = []
    for (const item of content) {
      if (!item || typeof item !== 'object') continue
      const row = item as Record<string, unknown>
      const text = row.text
      if (typeof text === 'string' && text.trim()) chunks.push(text.trim())
    }
    return chunks.join('\n').trim()
  }
  return ''
}

function extractFirstJsonObject(raw: string): Record<string, unknown> {
  const direct = raw.trim()
  if (direct.startsWith('{') && direct.endsWith('}')) {
    return JSON.parse(direct) as Record<string, unknown>
  }

  const fencedMatch = raw.match(/```json\s*([\s\S]*?)```/i)
  if (fencedMatch && fencedMatch[1]) {
    const fenced = fencedMatch[1].trim()
    if (fenced.startsWith('{') && fenced.endsWith('}')) {
      return JSON.parse(fenced) as Record<string, unknown>
    }
  }

  let depth = 0
  let start = -1
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i]
    if (ch === '{') {
      if (depth === 0) start = i
      depth += 1
    } else if (ch === '}') {
      depth -= 1
      if (depth === 0 && start >= 0) {
        const candidate = raw.slice(start, i + 1)
        return JSON.parse(candidate) as Record<string, unknown>
      }
      if (depth < 0) break
    }
  }

  throw new Error('COPY_JSON_PARSE_FAILED')
}

function normalizeHashtags(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('COPY_HASHTAGS_INVALID')
  const items = value
    .filter((item): item is string => typeof item === 'string' && !!item.trim())
    .map((tag) => tag.trim())
  if (items.length < 4) throw new Error('COPY_HASHTAGS_TOO_FEW')
  const unique: string[] = []
  const seen = new Set<string>()
  for (const tag of items) {
    if (!tag.startsWith('#')) throw new Error(`COPY_HASHTAG_INVALID: ${tag}`)
    if (seen.has(tag)) continue
    seen.add(tag)
    unique.push(tag)
  }
  return unique
}

const TRADITIONAL_ONLY_CHARACTERS = new Set(
  '與專業東絲兩嚴喪個豐臨為麗舉麼義烏樂喬習鄉書買亂爭於虧雲亞產畝親褻億僅從侖倉儀們價眾優會傘偉傳傷倫偽佇體餘傭傑備傢傾僂僑儂儈儉儒儘償儲兒兇黨蘭關興養獸冪冊寫軍農幣岡凍凈凱別剎剛創刪劃劇劉則劑勁動務勝勞勢勛匯區醫華協單賣盧衛卻厭厲廠歷曆壓厴參雙變敘葉號歎嘆吳呂嗎噸聽啟員唄問啞喚嗚嗶嘍嘩嘯嘰噓噴囑囂囅囉國圖圓聖場壞堅壇壩墳墜墮壟壢壯壺壽夠夢奪奮奧婦媽嫻嬌嬋學孫寧寶實審寬寢對導屆屍屜層屬島嶺嶽峽巒巔幹幾庫廁廂廈廚廝廣彆彈歸錄徵徹憂懷態慶憐懼戀憶應懶戲戶拋擇擊擋撫擁擠撲擴擺擾攏攔攜攝敗敵數斂斃斕斬斷無舊曉暈曠術樸機權條來楊榮構槍樣樹橋檢樓標歐歡歲殘殤殼毀氣氫漢湯溝滅滯滲滾滿漁潔潛澀濃濕濟濤瀉瀋燈爐點牆牘牽犧狀狹獄獨獲獵瑪環現琺甌畫疇癢癥癩癬癮皺盜盞監盤睜瞞矚礎確礙禮禍離稱穀穩窩窪竄競筆築籃籌簽簾簡糧糾紀約紅紋納紐純紗紙級紛細紹紳終組經結絕絞絡給統絨絳綁綉綜綠維綱網緊緒線締編緣縣縱總績織繞繡繩續纏罰罵羥翹聞聯聰聲職聳脅脈脫腎腖腸膽臉臟臺艦艙艱藝節芻苧蘇虛蟲蝕衝補裝裡製複襲見規覓視覽覺觸計訊討訐訓記訛訝訟訣訪設許訴診詁詆詞詠詢詣試詩誠話詭該詳誇詫詮詬譁誄誅認誑誒誕誘誚語誤說誦請諸諾謀謁謂謄謊謎謠謝謹譜譽讀讓讖讚貝貞負財貢貧貨販貪貫責貯貳貴費賀賁賂賃賄資賈賊賑賓賜賞賠賢賬賭賴贈贊趕趙趨跡踐蹤車軋軌軒軟轉輪輯輸輔輕載轄辦辭辯迴連進遊運過達違遙遜遞遠適遲遷選遺邊邏郵鄧鄭醜醞釀釁釋釐鈔鐘鈣鉅銀銅銘銳鋒鋪鍋鍵鎖鎮鏡鐵鑄鑑長門開閃閉閒閣閥閱闆闊隊階際陣陰陳陸陽險雜雞難電靈靜顆額顏顯類風飛飄餃餅餓館騎騙騰驅驚驛驗驟髒鬥鬧魯鮑鮮鯉鯨鰻鱗鳥鳴鴨鷹鹹鹽麥黃齊齋齒龍龜'
)

function containsTraditionalOnlyCharacters(input: string): boolean {
  for (const char of input) {
    if (TRADITIONAL_ONLY_CHARACTERS.has(char)) return true
  }
  return false
}

function parseCopyPayload(payload: Record<string, unknown>): {
  title: string
  hook: string
  content: string
  hashtags: string[]
} {
  const title = typeof payload.title === 'string' ? payload.title.trim() : ''
  const hook = typeof payload.hook === 'string' ? payload.hook.trim() : ''
  const content = typeof payload.content === 'string' ? payload.content.trim() : ''
  const hashtags = normalizeHashtags(payload.hashtags)

  if (!title) throw new Error('COPY_TITLE_EMPTY')
  if (!title.startsWith('子不语 ')) throw new Error('COPY_TITLE_PREFIX_INVALID')
  if (/\d/.test(title)) throw new Error('COPY_TITLE_CONTAINS_DIGIT')
  if (!hook) throw new Error('COPY_HOOK_EMPTY')
  if (!content) throw new Error('COPY_CONTENT_EMPTY')
  if (containsTraditionalOnlyCharacters(title)) throw new Error('COPY_TITLE_NOT_SIMPLIFIED_CHINESE')
  if (containsTraditionalOnlyCharacters(hook)) throw new Error('COPY_HOOK_NOT_SIMPLIFIED_CHINESE')
  if (containsTraditionalOnlyCharacters(content)) throw new Error('COPY_CONTENT_NOT_SIMPLIFIED_CHINESE')
  if (hashtags.some((tag) => containsTraditionalOnlyCharacters(tag))) throw new Error('COPY_HASHTAGS_NOT_SIMPLIFIED_CHINESE')

  return {
    title,
    hook,
    content,
    hashtags,
  }
}

function buildBody(hook: string, content: string, hashtags: string[]): string {
  return `${hook}\n${content}\n${hashtags.join(' ')}`
}

function isSimplifiedChineseValidationError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return (
    error.message === 'COPY_TITLE_NOT_SIMPLIFIED_CHINESE'
    || error.message === 'COPY_HOOK_NOT_SIMPLIFIED_CHINESE'
    || error.message === 'COPY_CONTENT_NOT_SIMPLIFIED_CHINESE'
    || error.message === 'COPY_HASHTAGS_NOT_SIMPLIFIED_CHINESE'
  )
}

async function qwenGenerateCopy(params: {
  apiKey: string
  model: string
  env: NodeJS.ProcessEnv
  storyId: string
  storyTitle: string
  runDir: string
  scenes: StoryPublishCopyPlanScene[]
  narration: string
}): Promise<{ title: string; hook: string; content: string; hashtags: string[] }> {
  const systemPrompt = [
    '你是短视频平台（视频号）运营文案专家。',
    '你只输出 JSON 对象，禁止输出任何额外解释文字。',
    '必须遵循：title, hook, content, hashtags 四个字段。',
    '所有字段必须使用简体中文，严禁输出任何繁体字、繁体词或港澳台书面语写法。',
    '如果你输出了任何繁体字，这份结果就视为不合格。',
    'title 必须是“子不语 {篇名}”格式，不允许出现阿拉伯数字。',
    'hook 1句话，开头就有冲突或反差，适合前3秒抓人。',
    'content 2-4句，讲清剧情卖点，语言口语化但不低俗。',
    'hashtags 4-8个，必须都以 # 开头，且包含 #子不语。',
  ].join('\n')

  const userPrompt = toPromptPayload({
    storyId: params.storyId,
    storyTitle: params.storyTitle,
    scenes: params.scenes,
    narration: params.narration,
  })
  let lastValidationError: Error | null = null
  let retryInstruction = ''

  for (let attempt = 1; attempt <= MAX_SIMPLIFIED_CHINESE_RETRIES; attempt += 1) {
    const requestBody = JSON.stringify({
      model: params.model,
      temperature: 0.7,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: retryInstruction
            ? `${userPrompt}\n\n补充要求：${retryInstruction}`
            : userPrompt,
        },
      ],
    })

    let rawText = ''
    try {
      rawText = execFileSync(
        'curl',
        [
          '-sS',
          '--connect-timeout',
          '15',
          '--max-time',
          '120',
          '-X',
          'POST',
          'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
          '-H',
          `Authorization: Bearer ${params.apiKey}`,
          '-H',
          'Content-Type: application/json',
          '--data',
          requestBody,
        ],
        {
          env: params.env,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`DASHSCOPE_CHAT_FAILED: CURL ${message}`)
    }

    const raw = JSON.parse(rawText || '{}') as DashscopeChatResponse
    const errorCode = typeof raw.code === 'string' ? raw.code : ''
    const errorMessage = typeof raw.message === 'string' ? raw.message : ''
    if (errorCode || errorMessage) {
      const code = errorCode || 'API_ERROR'
      const message = errorMessage || 'DashScope chat failed'
      throw new Error(`DASHSCOPE_CHAT_FAILED: ${code} ${message}`)
    }

    const choicesRaw = Array.isArray(raw.choices) ? raw.choices : []
    const choices = choicesRaw.filter((item): item is DashscopeChatChoice => !!item && typeof item === 'object')
    const firstChoice = choices[0]
    const message = firstChoice?.message
    const text = extractTextFromChoiceContent(message?.content)
    if (!text) throw new Error('DASHSCOPE_EMPTY_RESPONSE')

    const parsed = extractFirstJsonObject(text)
    try {
      return parseCopyPayload(parsed)
    } catch (error) {
      if (!isSimplifiedChineseValidationError(error) || attempt === MAX_SIMPLIFIED_CHINESE_RETRIES) {
        throw error
      }
      lastValidationError = error instanceof Error ? error : new Error(String(error))
      retryInstruction = '你上一轮输出含有繁体字。请严格重写为全简体中文，保留原意，但 title、hook、content、hashtags 四个字段都不得包含任何繁体字。'
    }
  }

  if (lastValidationError) throw lastValidationError
  throw new Error('COPY_GENERATION_RETRY_EXHAUSTED')
}

function buildRecordId(storyId: string): string {
  return `copy-${nowTimestamp()}-${storyId}-${Math.random().toString(36).slice(2, 8)}`
}

function sortByGeneratedAtDesc(records: StoryPublishCopyRecord[]): StoryPublishCopyRecord[] {
  return [...records].sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))
}

export function queryStoryPublishCopies(input: QueryStoryPublishCopiesInput): StoryPublishCopyRecord[] {
  const workspaceRoot = path.resolve(input.workspaceRoot)
  const store = readStore(workspaceRoot)
  const storyId = input.storyId ? validateStoryId(input.storyId) : null
  const limit = Number.isFinite(input.limit) ? Math.max(1, Math.min(1000, input.limit || DEFAULT_LIMIT)) : DEFAULT_LIMIT

  let records = sortByGeneratedAtDesc(store.records)
  if (storyId) {
    records = records.filter((item) => item.storyId === storyId)
  }

  if (input.latestByStory) {
    const latestMap = new Map<string, StoryPublishCopyRecord>()
    for (const row of records) {
      if (!latestMap.has(row.storyId)) {
        latestMap.set(row.storyId, row)
      }
    }
    records = [...latestMap.values()]
  }

  return records.slice(0, limit)
}

export function getLatestStoryPublishCopy(workspaceRootInput: string, storyIdInput: string): StoryPublishCopyRecord | null {
  const workspaceRoot = path.resolve(workspaceRootInput)
  const storyId = validateStoryId(storyIdInput)
  const rows = queryStoryPublishCopies({
    workspaceRoot,
    storyId,
    latestByStory: false,
    limit: 1,
  })
  return rows[0] || null
}

export async function generateStoryPublishCopy(input: GenerateStoryPublishCopyInput): Promise<StoryPublishCopyRecord> {
  const workspaceRoot = path.resolve(input.workspaceRoot)
  const storyId = validateStoryId(input.storyId)
  const model = input.model.trim()
  if (!model) throw new Error('EMPTY_COPY_MODEL')

  const { storyTitle, runDir } = resolveRunDir(workspaceRoot, storyId, input.runDir)
  const store = readStore(workspaceRoot)
  const existing = store.records.find((item) => item.storyId === storyId && path.resolve(item.runDir) === runDir) || null
  if (existing && !input.force) return existing

  const scenes = readStoryPlan(runDir)
  const narration = readNarration(runDir, scenes)
  if (!narration.trim()) throw new Error('EMPTY_NARRATION_TEXT')
  const apiKey = resolveQwenApiKey(workspaceRoot)
  const { localEnv, skillEnv } = readWorkspaceEnvFiles(workspaceRoot)
  const proxy = resolveProxySettings({
    processEnv: process.env,
    localEnv,
    skillEnv,
  })
  const curlEnv = applyProxyEnv(process.env, proxy)
  const generated = await qwenGenerateCopy({
    apiKey,
    model,
    env: curlEnv,
    storyId,
    storyTitle,
    runDir,
    scenes,
    narration,
  })

  const record: StoryPublishCopyRecord = {
    id: buildRecordId(storyId),
    storyId,
    storyTitle,
    runDir,
    title: generated.title,
    hook: generated.hook,
    content: generated.content,
    hashtags: generated.hashtags,
    body: buildBody(generated.hook, generated.content, generated.hashtags),
    model,
    source: input.source,
    generatedAt: nowIso(),
  }

  const filtered = store.records.filter((item) => !(item.storyId === storyId && path.resolve(item.runDir) === runDir))
  writeStore(workspaceRoot, {
    updatedAt: nowIso(),
    records: [record, ...filtered],
  })
  return record
}
