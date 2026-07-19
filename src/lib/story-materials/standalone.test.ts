import { describe, expect, it } from 'vitest'
import {
  STORY_MATERIALS_HOME_PATH,
  STORY_MATERIALS_PRODUCT_NAME,
  getStoryMaterialsProductMetadata,
  isStoryMaterialsStandaloneClient,
  isStoryMaterialsStandaloneRouting,
  isStoryMaterialsStandaloneServer,
} from './standalone'

describe('story materials standalone flags', () => {
  it('accepts only explicit true-like values', () => {
    expect(isStoryMaterialsStandaloneServer({ STORY_MATERIALS_STANDALONE: '1' })).toBe(true)
    expect(isStoryMaterialsStandaloneServer({ STORY_MATERIALS_STANDALONE: 'true' })).toBe(true)
    expect(isStoryMaterialsStandaloneServer({ STORY_MATERIALS_STANDALONE: 'yes' })).toBe(true)
    expect(isStoryMaterialsStandaloneServer({ STORY_MATERIALS_STANDALONE: 'on' })).toBe(true)
    expect(isStoryMaterialsStandaloneServer({ STORY_MATERIALS_STANDALONE: '0' })).toBe(false)
    expect(isStoryMaterialsStandaloneServer({ STORY_MATERIALS_STANDALONE: 'false' })).toBe(false)
    expect(isStoryMaterialsStandaloneServer({})).toBe(false)
  })

  it('reads client flag from next public env only', () => {
    expect(
      isStoryMaterialsStandaloneClient({
        NEXT_PUBLIC_STORY_MATERIALS_STANDALONE: 'true',
        STORY_MATERIALS_STANDALONE: 'false',
      }),
    ).toBe(true)
    expect(
      isStoryMaterialsStandaloneClient({
        NEXT_PUBLIC_STORY_MATERIALS_STANDALONE: 'false',
        STORY_MATERIALS_STANDALONE: 'true',
      }),
    ).toBe(false)
  })

  it('enables standalone routing from either explicit standalone flag', () => {
    expect(isStoryMaterialsStandaloneRouting({ STORY_MATERIALS_STANDALONE: 'true' })).toBe(true)
    expect(isStoryMaterialsStandaloneRouting({ NEXT_PUBLIC_STORY_MATERIALS_STANDALONE: 'true' })).toBe(true)
    expect(
      isStoryMaterialsStandaloneRouting({
        STORY_MATERIALS_STANDALONE: 'false',
        NEXT_PUBLIC_STORY_MATERIALS_STANDALONE: 'false',
      }),
    ).toBe(false)
  })

  it('exposes standalone product identity without waoo branding', () => {
    expect(STORY_MATERIALS_HOME_PATH).toBe('/materials')
    expect(STORY_MATERIALS_PRODUCT_NAME).toBe('故事素材库')
    expect(getStoryMaterialsProductMetadata()).toEqual({
      title: '故事素材库',
      description: '独立故事视频素材生产、追踪与发布文案工作台',
    })
  })
})
