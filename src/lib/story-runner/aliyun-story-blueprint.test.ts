import { describe, expect, it } from 'vitest'
import {
  buildAliyunBlueprintPrompt,
  estimateAliyunBlueprintPlan,
  normalizeAliyunBlueprint,
} from './aliyun-story-blueprint'

describe('aliyun story blueprint', () => {
  it('builds adaptive prompts without fixed target duration', () => {
    const story = '钟生入冥，先见李王，又见素王。'.repeat(120)
    const plan = estimateAliyunBlueprintPlan(story, null)
    const prompt = buildAliyunBlueprintPrompt(story, plan)

    expect(prompt).toContain('成片长度由最终配音自然产生')
    expect(prompt).toContain('scenes 数量由故事本身决定')
    expect(prompt).toContain('不设最低场景数')
    expect(prompt).toContain('请做白话转述，不做扩写')
    expect(prompt).toContain('imagePrompt":"中文电影镜头提示词')
    expect(prompt).toContain('imagePrompt 禁止要求画面出现任何文字')
    expect(prompt).toContain('所有字段值都必须使用中文')
    expect(prompt).toContain(`最多 ${plan.maxSceneCount} 个`)
    expect(prompt).toContain(`不得超过 ${plan.maxVoiceOverChars} 个汉字`)
    expect(prompt).not.toContain('英文电影级提示词')
    expect(prompt).not.toContain('不少于')
    expect(prompt).not.toContain('不能少于')
    expect(prompt).not.toContain('总时长')
    expect(prompt).not.toContain('目标时长')
  })

  it('accepts compact scene plans when the source story is short', () => {
    const story = '狐仙赐李叟元宝，钟声自鸣，官府查出元宝是库银，归还后钟声停止。'
    const plan = estimateAliyunBlueprintPlan(story, null)

    const result = normalizeAliyunBlueprint({
      title: '狐钟记',
      style: '新中式志怪',
      narration: '狐仙赐给李叟一锭元宝，后来钟声自鸣，官府查出元宝是库银，归还后钟声停止。',
      characters: [
        { id: 'c1', name: '李叟', appearance: '老人', costume: '灰布短褂', anchor: '李叟灰衣锚点' },
      ],
      scenes: [
        {
          id: 1,
          summary: '狐仙赐元宝',
          voiceOver: '狐仙应李叟请求，给了他一锭大元宝。',
          durationSec: 10,
          charRefs: ['c1'],
          imagePrompt: '李叟灰衣锚点，灰布短褂，狐仙递给老人一锭银元宝，古村夜色，中景，暖烛光，禁止文字',
        },
        {
          id: 2,
          summary: '钟声自鸣',
          voiceOver: '后来钟楼无人撞钟，钟声却自己响起来。',
          durationSec: 10,
          charRefs: ['c1'],
          imagePrompt: '李叟灰衣锚点，灰布短褂，老人仰头听见钟楼自鸣，古镇清晨，中远景，雾气微亮，禁止文字',
        },
        {
          id: 3,
          summary: '库银归还',
          voiceOver: '官府查出元宝是库银，拿回去后钟声就停了。',
          durationSec: 10,
          charRefs: ['c1'],
          imagePrompt: '李叟灰衣锚点，灰布短褂，老人把银元宝交还官府，古代衙门内，中景，肃穆光线，禁止文字',
        },
      ],
    }, plan)

    expect(result.scenes.length).toBe(3)
  })

  it('accepts variable scene count when no manual scene override is set', () => {
    const story = '钟生入冥，见二神争理与数，周昭王也来诉冤。'.repeat(120)
    const plan = estimateAliyunBlueprintPlan(story, null)
    const sceneCount = Math.min(8, plan.maxSceneCount)
    const scenes = Array.from({ length: sceneCount }, (_, index) => ({
      id: index + 1,
      summary: `事件${index + 1}`,
      voiceOver: `这是第${index + 1}个关键事件。`,
      durationSec: 12,
      charRefs: ['c1'],
      imagePrompt: `钟生青衫锚点，青布长衫，第${index + 1}个关键事件，古代冥府环境，中景，冷色光线，禁止文字`,
    }))

    const result = normalizeAliyunBlueprint({
      title: '阴间告状记',
      style: '新中式志怪',
      narration: scenes.map((scene) => scene.voiceOver).join(''),
      characters: [
        { id: 'c1', name: '钟生', appearance: '老人', costume: '青布长衫', anchor: '钟生青衫锚点' },
      ],
      scenes,
    }, plan)

    expect(result.scenes.length).toBe(sceneCount)
  })

  it('rejects over-expanded voiceOver that exceeds source-driven maximum', () => {
    const story = '钟生入冥，见二神争理与数，周昭王也来诉冤。'
    const plan = estimateAliyunBlueprintPlan(story, null)
    const longVoiceOver = '钟生被铺陈了许多原文没有的背景、心理、动作和解释，明显是在为了增加时长而扩写。'.repeat(20)
    const scenes = [
      {
        id: 1,
        summary: '过度扩写',
        voiceOver: longVoiceOver,
        durationSec: 10,
        charRefs: ['c1'],
        imagePrompt: '钟生青衫锚点，青布长衫，过度扩写画面，古代冥府环境，中景，冷色光线，禁止文字',
      },
    ]

    expect(() => normalizeAliyunBlueprint({
      title: '阴间告状记',
      style: '新中式志怪',
      narration: longVoiceOver,
      characters: [
        { id: 'c1', name: '钟生', appearance: '老人', costume: '青布长衫', anchor: '钟生青衫锚点' },
      ],
      scenes,
    }, plan)).toThrow('BLUEPRINT_VOICEOVER_TOO_LONG_FOR_SOURCE')
  })

  it('rejects Latin letters in image prompts before image generation', () => {
    const story = '乡民为小神立庙，香火渐盛。'
    const plan = estimateAliyunBlueprintPlan(story, null)

    expect(() => normalizeAliyunBlueprint({
      title: '小神庙',
      style: '古装志怪写实风',
      narration: '乡民为小神立起庙宇，从此香火越来越盛。',
      characters: [
        { id: 'c1', name: '小神', appearance: '年轻男子神像', costume: '红色官袍', anchor: '小神红袍锚点' },
      ],
      scenes: [
        {
          id: 1,
          summary: '乡民立庙',
          voiceOver: '乡民给小神立起庙宇，远近都来烧香。',
          durationSec: 10,
          charRefs: ['c1'],
          imagePrompt: 'Temple sign reads Poyang Small God Temple',
        },
      ],
    }, plan)).toThrow('BLUEPRINT_LATIN_TEXT_FORBIDDEN: scenes[0].imagePrompt')
  })
})
