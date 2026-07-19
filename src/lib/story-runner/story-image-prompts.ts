import type { StoryNarrationTargets } from './utils'

export type StoryImageAspect = '16:9' | '9:16'

export type StoryCharacterAsset = {
  id: string
  name: string
  appearance: string
  costume: string
  anchor: string
}

export type StoryScene = {
  id: number
  summary: string
  voiceOver: string
  durationSec: number
  imagePrompt: string
  charRefs: string[]
}

export type StoryBlueprint = {
  title: string
  style: string
  narration: string
  characters: StoryCharacterAsset[]
  scenes: StoryScene[]
}

const IMAGE_NEGATIVE_CONSTRAINTS = [
  '禁止任何文字',
  '禁止字幕',
  '禁止水印',
  '禁止标志',
  '禁止海报版式',
  '禁止拼贴',
  '禁止分屏',
  '禁止重复人物',
  '禁止重复身体部位',
  '禁止多余手指',
  '禁止多余肢体',
  '禁止裁掉头部',
  '禁止裁掉手部',
  '禁止动漫风',
  '除非原故事明确需要，否则禁止现代道具',
  '除非原故事明确需要，否则禁止现代服装',
  '禁止意外克隆脸',
  '除非原故事明确需要，否则禁止对称重复主体',
].join('，')

type ShotDiscipline = {
  shotType: string | null
  cameraAngle: string | null
  framingGuard: string | null
}

export function frameHint(imageAspect: StoryImageAspect): string {
  return imageAspect === '9:16' ? '9:16竖版画幅' : '16:9横版画幅'
}

export function buildBlueprintPrompt(
  storyText: string,
  colloquial: boolean,
  targets: StoryNarrationTargets,
  imageAspect: StoryImageAspect,
  allowLatinText: boolean,
): string {
  const narrationConstraint = colloquial
    ? `  "narration": "${targets.narrationCharMin}-${targets.narrationCharMax}字完整旁白，必须现代中文白话口语，像真人口播连贯讲故事，禁止文言腔和摘要腔",`
    : `  "narration": "${targets.narrationCharMin}-${targets.narrationCharMax}字完整旁白，要求按事件顺序娓娓道来，禁止只写梗概",`
  const extraColloquialRules = colloquial
    ? [
        '10) narration 与 voiceOver 必须现代白话，句式自然，像口播，不要文绉绉；',
        '11) 禁止使用文言词：其、乃、遂、焉、矣、夫、盖、兹、然则、未几；',
      ]
    : []

  return [
    '你是短剧导演、人物设定师与分镜设计师。请把下面故事改成可直接生产的完整视频方案。',
    '严格输出 JSON 对象，字段必须包含：',
    '{',
    '  "title": "故事标题",',
    '  "style": "视觉风格",',
    narrationConstraint,
    '  "characters": [',
    '    {"id":"c1","name":"角色名","appearance":"不可漂移的脸型发型五官年龄感体态","costume":"固定服饰颜色材质配饰关键词","anchor":"中文唯一锚点词，建议使用角色名加固定特征"}',
    '  ],',
    '  "scenes": [',
    `    {"id":1,"summary":"","voiceOver":"${targets.perSceneVoiceMinChars}-${targets.perSceneVoiceMaxChars}字单镜头口播片段，要求包含具体事件而非评价","durationSec":${targets.perSceneDurationSec},"charRefs":["c1"],"imagePrompt":"中文电影镜头提示词，必须按固定顺序写：主体与动作、环境与时代、镜头景别与角度、光线与氛围、角色连续性锚点；必须显式包含每个 charRef 的 anchor、外形和服饰信息；${imageAspect}；禁止任何文字、牌匾、招牌、字幕、水印"} `,
    '  ]',
    '}',
    '约束：',
    '1) characters 数量 2-4；',
    `2) scenes 数量固定 ${targets.targetSceneCount}；`,
    `3) 总时长目标 ${Math.max(40, targets.targetDurationSec - 12)}-${targets.targetDurationSec + 12} 秒；`,
    '4) 角色设定必须具体、稳定、可复用：appearance 要写清脸型、发型、年龄感、体型，并包含至少一个稳定辨识点；costume 要写清颜色、材质、配饰；anchor 必须唯一且跨场景重复；',
    '5) imagePrompt 必须像电影镜头指令，不要抽象评价词，不要只写文学气氛；必须写清景别、机位/角度、动作、环境、光线；',
    '6) 人物形象需跨场景一致，imagePrompt 中必须显式重复同一角色的 anchor、外形特征与服饰锚点；',
    '7) 如果两个角色设定为长相相似或几乎一致，仍必须给每个角色写出一个稳定可区分的小差异，并在两者同框的 imagePrompt 中明确点出；',
    '8) scene 叙事覆盖完整起承转合，必须包含开端-发展-冲突-反转-收束；',
    '9) narration 必须与 scenes.voiceOver 同步：narration 需要逐段覆盖各 scene 的关键事件，不得写成一句话概述；',
    allowLatinText
      ? '10) 非 imagePrompt 字段以中文为主，允许保留必要术语（如 Level、M.E.G、A/B 等）；'
      : '10) 除 JSON 字段名、角色 id（如 c1）和比例数字（如 16:9）外，所有字段值必须是中文；title/style/narration/summary/voiceOver/name/appearance/costume/anchor/imagePrompt 均禁止英文单词与拼音；',
    '11) imagePrompt 必须使用中文，不得写英文镜头词或英文牌匾；禁止要求画面出现任何可读文字。',
    '12) imagePrompt 必须避免海报感和插画感，要更像单帧电影剧照，不能有字幕条、边框、拼贴、多人重复、额外肢体。',
    ...extraColloquialRules,
    '',
    '故事原文：',
    storyText,
  ].join('\n')
}

function buildCharacterContinuityClause(character: StoryCharacterAsset): string {
  return `角色连续性要求：${character.name}；固定锚点：${character.anchor}；固定外形：${character.appearance}；固定服饰与道具：${character.costume}。`
}

function extractShotDiscipline(imagePrompt: string): ShotDiscipline {
  const normalized = imagePrompt.toLowerCase()
  let shotType: string | null = null
  if (/(extreme close[- ]?up)/u.test(normalized)) {
    shotType = 'extreme close-up'
  } else if (/(medium wide shot)/u.test(normalized)) {
    shotType = 'medium wide shot'
  } else if (/(close[- ]?up|close shot)/u.test(normalized)) {
    shotType = 'close-up'
  } else if (/(medium close[- ]?up)/u.test(normalized)) {
    shotType = 'medium close-up'
  } else if (/(medium shot)/u.test(normalized)) {
    shotType = 'medium shot'
  } else if (/(wide shot|long shot|full shot)/u.test(normalized)) {
    shotType = 'wide shot'
  }

  let cameraAngle: string | null = null
  if (/(low angle)/u.test(normalized)) {
    cameraAngle = 'low angle'
  } else if (/(high angle|bird.?s-eye)/u.test(normalized)) {
    cameraAngle = 'high angle'
  } else if (/(over[- ]the[- ]shoulder)/u.test(normalized)) {
    cameraAngle = 'over-the-shoulder'
  } else if (/(top[- ]down)/u.test(normalized)) {
    cameraAngle = 'top-down'
  }

  let framingGuard: string | null = null
  if (shotType === 'extreme close-up' || shotType === 'close-up' || shotType === 'medium close-up') {
    framingGuard = '不要扩成全身远景，不要增加无关角色或环境。'
  } else if (shotType === 'medium wide shot') {
    framingGuard = '主体和周围叙事环境都要清楚可读，不要变成肖像近景或过远的空镜。'
  } else if (shotType === 'wide shot') {
    framingGuard = '环境必须清楚可读，不要变成肖像式近裁切。'
  } else if (shotType === 'medium shot') {
    framingGuard = '镜头保持在半身到膝部的叙事距离，不要变成近景或远景空镜。'
  }

  return { shotType, cameraAngle, framingGuard }
}

export function createCharacterImagePrompt(
  character: StoryCharacterAsset,
  style: string,
  imageAspect: StoryImageAspect,
): string {
  return [
    '叙事短片角色设定参考图，单人全身，居中构图，手部和鞋履可见，干净中性背景。',
    `视觉风格：${style}。`,
    `角色身份：${character.name}。`,
    `固定面部与体态特征：${character.appearance}。`,
    `固定服装、颜色、材质与配饰：${character.costume}。`,
    `连续性锚点：${character.anchor}。`,
    '后续所有场景都必须保持同一张脸、同一发型、同一年龄感、同一体型、同一服装色彩、同一材质纹理、同一标志性配饰和稳定辨识点。',
    `${frameHint(imageAspect)}，电影感主光，写实人体结构，细节丰富，${IMAGE_NEGATIVE_CONSTRAINTS}。`,
  ].join(' ')
}

export function createSceneImagePrompt(
  scene: StoryScene,
  characters: StoryCharacterAsset[],
  style: string,
  imageAspect: StoryImageAspect,
): string {
  const characterById = new Map<string, StoryCharacterAsset>()
  for (const character of characters) {
    characterById.set(character.id, character)
  }

  const continuityRequirements = scene.charRefs
    .map((charId) => characterById.get(charId))
    .filter((character): character is StoryCharacterAsset => character !== undefined)
    .map((character) => buildCharacterContinuityClause(character))
    .join(' ')
  const shotDiscipline = extractShotDiscipline(scene.imagePrompt)

  return [
    '中国志怪短片的电影感叙事单帧。',
    `视觉风格：${style}。`,
    `本幕叙事节拍：${scene.summary}。`,
    `基础镜头提示：${scene.imagePrompt}。`,
    continuityRequirements,
    '必须和角色设定图保持同一张脸、同一发型、同一年龄感、同一体型、同一服装色彩、同一标志性道具和稳定辨识点。',
    '如果多个相似角色同框，必须保留每个角色的小差异，不要融合成克隆脸。',
    shotDiscipline.shotType ? `必须保持景别：${shotDiscipline.shotType}。` : '',
    shotDiscipline.cameraAngle ? `必须保持机位角度：${shotDiscipline.cameraAngle}。` : '',
    shotDiscipline.framingGuard ?? '',
    '优先保证构图明确、人体可信、动作可读、时代氛围准确、光线有电影感，不要变成抽象绘画。',
    `${frameHint(imageAspect)}, ${IMAGE_NEGATIVE_CONSTRAINTS}.`,
  ]
    .filter((segment) => segment.length > 0)
    .join(' ')
}
