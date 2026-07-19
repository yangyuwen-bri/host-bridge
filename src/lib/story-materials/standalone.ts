function parseStandaloneFlag(value: string | undefined): boolean {
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

const STORY_MATERIALS_STANDALONE_SERVER = parseStandaloneFlag(process.env.STORY_MATERIALS_STANDALONE)
const STORY_MATERIALS_STANDALONE_CLIENT = parseStandaloneFlag(process.env.NEXT_PUBLIC_STORY_MATERIALS_STANDALONE)
const STORY_MATERIALS_STANDALONE_ROUTING =
  STORY_MATERIALS_STANDALONE_SERVER || STORY_MATERIALS_STANDALONE_CLIENT

export interface StoryMaterialsProductMetadata {
  title: string
  description: string
}

export const STORY_MATERIALS_PRODUCT_NAME = '故事素材库'
export const STORY_MATERIALS_HOME_PATH = '/materials'

export function getStoryMaterialsProductMetadata(): StoryMaterialsProductMetadata {
  return {
    title: STORY_MATERIALS_PRODUCT_NAME,
    description: '独立故事视频素材生产、追踪与发布文案工作台',
  }
}

export function isStoryMaterialsStandaloneServer(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env === process.env) {
    return STORY_MATERIALS_STANDALONE_SERVER
  }
  return parseStandaloneFlag(env.STORY_MATERIALS_STANDALONE)
}

export function isStoryMaterialsStandaloneClient(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env === process.env) {
    return STORY_MATERIALS_STANDALONE_CLIENT
  }
  return parseStandaloneFlag(env.NEXT_PUBLIC_STORY_MATERIALS_STANDALONE)
}

export function isStoryMaterialsStandaloneRouting(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env === process.env) {
    return STORY_MATERIALS_STANDALONE_ROUTING
  }
  return (
    parseStandaloneFlag(env.STORY_MATERIALS_STANDALONE) ||
    parseStandaloneFlag(env.NEXT_PUBLIC_STORY_MATERIALS_STANDALONE)
  )
}
