import { describe, expect, it } from 'vitest'
import {
  buildBlueprintPrompt,
  createCharacterImagePrompt,
  createSceneImagePrompt,
  frameHint,
  type StoryCharacterAsset,
  type StoryScene,
} from './story-image-prompts'
import type { StoryNarrationTargets } from './utils'

const targets: StoryNarrationTargets = {
  sourceCharCount: 880,
  targetDurationSec: 96,
  targetSceneCount: 8,
  perSceneDurationSec: 12,
  narrationCharMin: 420,
  narrationCharMax: 560,
  perSceneVoiceMinChars: 45,
  perSceneVoiceMaxChars: 80,
}

const characters: StoryCharacterAsset[] = [
  {
    id: 'c1',
    name: '许善根',
    appearance: '瘦削青年，长脸，乱发，眼窝深，风霜感强',
    costume: '深灰旧棉袍，粗布绑腿，旧草鞋',
    anchor: '许善根灰袍锚点',
  },
  {
    id: 'c2',
    name: '红毛长人',
    appearance: '极高身形，披散红发，惨白长脸，手脚异常修长',
    costume: '破旧兽皮披身，腰间缠麻绳',
    anchor: '红毛长人兽皮锚点',
  },
]

const scene: StoryScene = {
  id: 2,
  summary: '许善根夜宿山沟，忽然看见高大的红毛怪人逼近。',
  voiceOver: '许善根正昏睡，忽听草木乱响，抬头时只见一个红毛长人站在面前。',
  durationSec: 12,
  imagePrompt: '许善根灰袍锚点，深灰旧棉袍；红毛长人兽皮锚点，破旧兽皮披身；夜晚山沟河岸，许善根惊醒，红毛长人从黑森林逼近，中远景，低角度，冷月光，压迫感强，禁止文字。',
  charRefs: ['c1', 'c2'],
}

describe('story image prompts', () => {
  it('builds blueprint prompt with stronger continuity and shot-structure rules', () => {
    const prompt = buildBlueprintPrompt('山中遇怪，夜半惊魂。', true, targets, '16:9', false)

    expect(prompt).toContain('anchor":"中文唯一锚点词')
    expect(prompt).toContain('必须按固定顺序写：主体与动作、环境与时代、镜头景别与角度、光线与氛围、角色连续性锚点')
    expect(prompt).toContain('appearance 要写清脸型、发型、年龄感、体型，并包含至少一个稳定辨识点')
    expect(prompt).toContain('imagePrompt 必须像电影镜头指令')
    expect(prompt).toContain('imagePrompt 必须使用中文')
    expect(prompt).toContain('如果两个角色设定为长相相似或几乎一致')
    expect(prompt).toContain('不能有字幕条、边框、拼贴、多人重复、额外肢体')
    expect(prompt).not.toContain('英文电影级提示词')
    expect(prompt).not.toContain('只有 imagePrompt 和 characters.anchor 要求英文 token')
  })

  it('builds character prompt with immutable identity requirements', () => {
    const prompt = createCharacterImagePrompt(characters[0], '古典志怪电影感', '9:16')

    expect(prompt).toContain('叙事短片角色设定参考图')
    expect(prompt).toContain('固定面部与体态特征：瘦削青年，长脸，乱发，眼窝深，风霜感强。')
    expect(prompt).toContain('固定服装、颜色、材质与配饰：深灰旧棉袍，粗布绑腿，旧草鞋。')
    expect(prompt).toContain('连续性锚点：许善根灰袍锚点。')
    expect(prompt).toContain('后续所有场景都必须保持同一张脸、同一发型、同一年龄感')
    expect(prompt).toContain('9:16竖版画幅')
    expect(prompt).toContain('禁止重复身体部位')
  })

  it('builds scene prompt with character continuity injected from char refs', () => {
    const prompt = createSceneImagePrompt(scene, characters, '古典志怪电影感', '16:9')

    expect(prompt).toContain('本幕叙事节拍：许善根夜宿山沟，忽然看见高大的红毛怪人逼近。')
    expect(prompt).toContain('基础镜头提示：许善根灰袍锚点')
    expect(prompt).toContain('角色连续性要求：许善根；固定锚点：许善根灰袍锚点；固定外形：瘦削青年，长脸，乱发，眼窝深，风霜感强；固定服饰与道具：深灰旧棉袍，粗布绑腿，旧草鞋。')
    expect(prompt).toContain('角色连续性要求：红毛长人；固定锚点：红毛长人兽皮锚点；固定外形：极高身形，披散红发，惨白长脸，手脚异常修长；固定服饰与道具：破旧兽皮披身，腰间缠麻绳。')
    expect(prompt).toContain('必须和角色设定图保持同一张脸、同一发型、同一年龄感')
    expect(prompt).toContain('如果多个相似角色同框，必须保留每个角色的小差异，不要融合成克隆脸。')
    expect(prompt).toContain('16:9横版画幅')
    expect(prompt).toContain('除非原故事明确需要，否则禁止现代道具')
  })

  it('returns the correct frame hint for both aspect ratios', () => {
    expect(frameHint('16:9')).toBe('16:9横版画幅')
    expect(frameHint('9:16')).toBe('9:16竖版画幅')
  })
})
