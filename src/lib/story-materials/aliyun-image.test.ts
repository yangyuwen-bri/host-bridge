import { describe, expect, it } from 'vitest'
import {
  isAliyunStoryImageModel,
  isAliyunSyncStoryImageModel,
} from './aliyun-image'

describe('aliyun story image model routing', () => {
  it('recognizes qwen image models without accepting relay or google models', () => {
    expect(isAliyunStoryImageModel('qwen-image-2.0-pro')).toBe(true)
    expect(isAliyunStoryImageModel('qwen-image-2.0')).toBe(true)
    expect(isAliyunStoryImageModel('gpt-image-1')).toBe(false)
    expect(isAliyunStoryImageModel('gemini-3.1-flash-image-preview')).toBe(false)
  })

  it('routes qwen-image-2.0 models through the sync multimodal endpoint', () => {
    expect(isAliyunSyncStoryImageModel('qwen-image-2.0-pro')).toBe(true)
    expect(isAliyunSyncStoryImageModel('qwen-image-max')).toBe(true)
    expect(isAliyunSyncStoryImageModel('qwen-image')).toBe(false)
  })
})
