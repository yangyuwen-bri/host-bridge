import { normalizeDurationSeconds } from './utils'
import { containsLatinLetters } from './language'
import {
  type StoryBlueprint,
  type StoryCharacterAsset as CharacterAsset,
  type StoryScene,
} from './story-image-prompts'

export type AliyunBlueprintPlan = {
  sourceCharCount: number
  sourceParagraphCount: number
  maxSceneCount: number
  minVoiceOverChars: number
  maxVoiceOverChars: number
  sceneCountOverride: number | null
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)))
}

function countStoryParagraphs(storyText: string): number {
  return storyText
    .split(/\n+/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0).length
}

export function estimateAliyunBlueprintPlan(storyText: string, sceneCountOverride: number | null): AliyunBlueprintPlan {
  const sourceCharCount = storyText.replace(/\s+/g, '').length
  if (sourceCharCount === 0) throw new Error('STORY_SOURCE_EMPTY')

  const sourceParagraphCount = countStoryParagraphs(storyText)
  const maxSceneCount = clampInt(Math.max(4, Math.ceil(sourceCharCount / 45), sourceParagraphCount * 3), 4, 48)
  const minVoiceOverChars = sourceCharCount < 180 ? 0 : clampInt(sourceCharCount * 1.05, 180, 9000)
  const maxVoiceOverChars = clampInt(sourceCharCount * 2.4 + 180, 260, 18000)

  return {
    sourceCharCount,
    sourceParagraphCount,
    maxSceneCount,
    minVoiceOverChars,
    maxVoiceOverChars,
    sceneCountOverride,
  }
}

export function buildAliyunBlueprintPrompt(storyText: string, plan: AliyunBlueprintPlan): string {
  const sceneRule = plan.sceneCountOverride === null
    ? `2) scenes 数量由故事本身决定，不设最低场景数；只为原文中真实发生的关键动作、地点变化或转折建 scene，最多 ${plan.maxSceneCount} 个；禁止为了增加时长而拆碎、扩写或虚构画面；`
    : `2) scenes 数量按人工指定生成 ${plan.sceneCountOverride} 个；即便如此也必须覆盖完整起承转合，不能写成梗概；`

  return [
    '你是短剧导演与分镜设计师。请把下面故事改成可直接生产的完整视频方案。',
    '核心目标：讲好完整故事，而不是凑固定时长。禁止把原文压缩成故事梗概。',
    '成片长度由最终配音自然产生；方案只服务于叙事完整度，不写任何时长要求。',
    '严格输出 JSON 对象，字段必须包含：',
    '{',
    '  "title": "故事标题",',
    '  "style": "视觉风格",',
    '  "narration": "现代中文白话口语旁白，按原文事件顺序讲清楚即可；不得新增原文没有的情节、动机、背景或解释",',
    '  "characters": [',
    '    {"id":"c1","name":"角色名","appearance":"脸型发型五官体态","costume":"固定服饰关键词","anchor":"中文唯一锚点词"}',
    '  ],',
    '  "scenes": [',
    '    {"id":1,"summary":"本画面承载的单一叙事节拍","voiceOver":"与本画面对应的白话口播片段","durationSec":10,"charRefs":["c1"],"imagePrompt":"中文电影镜头提示词，必须包含角色锚点与服饰锚点，16:9，禁止水印，禁止任何可读文字、牌匾、招牌、字幕"}',
    '  ]',
    '}',
    '约束：',
    '1) characters 只列故事中真正需要跨场景保持一致的角色，通常 2-6 个；不能虚构无关角色；',
    sceneRule,
    `3) 原文约 ${plan.sourceCharCount} 字、${plan.sourceParagraphCount} 段；请做完整白话改写，不写摘要；所有 scenes.voiceOver 合计${plan.minVoiceOverChars > 0 ? `不得少于 ${plan.minVoiceOverChars} 个汉字，且` : ''}不得超过 ${plan.maxVoiceOverChars} 个汉字；`,
    '4) 人物形象需跨场景一致，imagePrompt 中必须显式重复同一角色的中文 anchor 与 costume 信息；',
    '5) scene 叙事必须覆盖原文已有起承转合；不要为了视频长度添加原文没有的过场、心理描写、铺垫或总结；',
    '6) 旁白与 voiceOver 必须是现代中文白话，句子自然，禁止文言句式，禁止“其、乃、遂、焉、矣”这类文言口吻堆砌；',
    '7) voiceOver 是最终配音文本的分段来源；每段只讲对应画面正在发生的事，不能超前或滞后。',
    '8) narration 可以与 scenes.voiceOver 串联后的内容一致；不得为了让 narration 更“好听”而额外扩写。',
    '9) 除 JSON 字段名、角色 id（如 c1）和比例数字（如 16:9）外，所有字段值都必须使用中文；title、style、narration、characters.name、characters.appearance、characters.costume、characters.anchor、summary、voiceOver、imagePrompt 均禁止出现英文字母或拼音。',
    '10) imagePrompt 禁止要求画面出现任何文字；不要写“牌匾写着”“招牌写着”“字幕”“标题”“logo”等内容。若场景必须有庙宇、官府、船只等，只描述建筑与动作，不描述可读文字。',
    '',
    '故事原文：',
    storyText,
  ].join('\n')
}

function assertNoLatinLetters(value: string, context: string): void {
  if (containsLatinLetters(value)) {
    throw new Error(`BLUEPRINT_LATIN_TEXT_FORBIDDEN: ${context}`)
  }
}

function readRequiredString(row: Record<string, unknown>, field: string, context: string): string {
  const value = row[field]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`BLUEPRINT_REQUIRED_FIELD_EMPTY: ${context}.${field}`)
  }
  return value.trim()
}

function normalizeCharacters(raw: unknown): CharacterAsset[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('BLUEPRINT_CHARACTERS_EMPTY')
  }

  return raw.map((item, idx) => {
    const row = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : null
    if (!row) throw new Error(`BLUEPRINT_CHARACTER_INVALID: ${idx}`)
    const character = {
      id: readRequiredString(row, 'id', `characters[${idx}]`),
      name: readRequiredString(row, 'name', `characters[${idx}]`),
      appearance: readRequiredString(row, 'appearance', `characters[${idx}]`),
      costume: readRequiredString(row, 'costume', `characters[${idx}]`),
      anchor: readRequiredString(row, 'anchor', `characters[${idx}]`),
    }
    assertNoLatinLetters(character.name, `characters[${idx}].name`)
    assertNoLatinLetters(character.appearance, `characters[${idx}].appearance`)
    assertNoLatinLetters(character.costume, `characters[${idx}].costume`)
    assertNoLatinLetters(character.anchor, `characters[${idx}].anchor`)
    return character
  })
}

function normalizeScenes(raw: unknown, plan: AliyunBlueprintPlan, characterIds: Set<string>): StoryScene[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('BLUEPRINT_SCENES_EMPTY')
  }
  if (plan.sceneCountOverride !== null && raw.length !== plan.sceneCountOverride) {
    throw new Error(`BLUEPRINT_SCENE_COUNT_MISMATCH: expected ${plan.sceneCountOverride}, got ${raw.length}`)
  }
  if (plan.sceneCountOverride === null && raw.length > plan.maxSceneCount) {
    throw new Error(`BLUEPRINT_SCENE_COUNT_TOO_HIGH_FOR_STORY: max ${plan.maxSceneCount}, got ${raw.length}`)
  }

  return raw.map((item, idx) => {
    const row = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : null
    if (!row) throw new Error(`BLUEPRINT_SCENE_INVALID: ${idx}`)
    const charRefsRaw = row.charRefs
    if (!Array.isArray(charRefsRaw)) throw new Error(`BLUEPRINT_SCENE_CHAR_REFS_INVALID: scenes[${idx}].charRefs`)
    const charRefs = charRefsRaw.map((value, charRefIdx) => {
      if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error(`BLUEPRINT_SCENE_CHAR_REF_INVALID: scenes[${idx}].charRefs[${charRefIdx}]`)
      }
      const charRef = value.trim()
      if (!characterIds.has(charRef)) {
        throw new Error(`BLUEPRINT_SCENE_CHAR_REF_UNKNOWN: scenes[${idx}].charRefs[${charRefIdx}]=${charRef}`)
      }
      return charRef
    })

    const durationSec = row.durationSec
    if (typeof durationSec !== 'number' || !Number.isFinite(durationSec)) {
      throw new Error(`BLUEPRINT_SCENE_DURATION_INVALID: scenes[${idx}].durationSec`)
    }

    const scene = {
      id: idx + 1,
      summary: readRequiredString(row, 'summary', `scenes[${idx}]`),
      voiceOver: readRequiredString(row, 'voiceOver', `scenes[${idx}]`),
      durationSec: normalizeDurationSeconds(durationSec, 12),
      imagePrompt: readRequiredString(row, 'imagePrompt', `scenes[${idx}]`),
      charRefs,
    }
    assertNoLatinLetters(scene.summary, `scenes[${idx}].summary`)
    assertNoLatinLetters(scene.voiceOver, `scenes[${idx}].voiceOver`)
    assertNoLatinLetters(scene.imagePrompt, `scenes[${idx}].imagePrompt`)
    return scene
  })
}

export function normalizeAliyunBlueprint(raw: Record<string, unknown>, plan: AliyunBlueprintPlan): StoryBlueprint {
  const title = readRequiredString(raw, 'title', 'root')
  const style = readRequiredString(raw, 'style', 'root')
  const narration = readRequiredString(raw, 'narration', 'root')
  assertNoLatinLetters(title, 'root.title')
  assertNoLatinLetters(style, 'root.style')
  assertNoLatinLetters(narration, 'root.narration')

  const characters = normalizeCharacters(raw.characters)
  const characterIds = new Set(characters.map((character) => character.id))
  const scenes = normalizeScenes(raw.scenes, plan, characterIds)
  const voiceOverChars = scenes.reduce((sum, scene) => sum + scene.voiceOver.replace(/\s+/gu, '').length, 0)
  if (voiceOverChars < plan.minVoiceOverChars) {
    throw new Error(`BLUEPRINT_VOICEOVER_TOO_SHORT_FOR_SOURCE: min ${plan.minVoiceOverChars}, got ${voiceOverChars}`)
  }
  if (voiceOverChars > plan.maxVoiceOverChars) {
    throw new Error(`BLUEPRINT_VOICEOVER_TOO_LONG_FOR_SOURCE: max ${plan.maxVoiceOverChars}, got ${voiceOverChars}`)
  }

  return { title, style, narration, characters, scenes }
}
