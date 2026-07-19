export type StoryMaterialsStandaloneRouteAction =
  | { kind: 'next' }
  | { kind: 'redirect'; pathname: string }

const LOCALES_WITH_MATERIALS_PATH = /^\/(?:zh|en)\/materials\/?$/
const LOCALES_WITH_STORY_STUDIO_PATH = /^\/(?:zh|en)\/story-studio\/?$/
const LOCALES_WITH_RADIO_PATH = /^\/(?:zh|en)\/radio\/?$/

export function resolveStoryMaterialsStandaloneRoute(pathname: string): StoryMaterialsStandaloneRouteAction {
  if (pathname === '/') {
    return { kind: 'redirect', pathname: '/materials' }
  }

  if (pathname === '/materials' || pathname === '/materials/') {
    return { kind: 'next' }
  }

  if (LOCALES_WITH_MATERIALS_PATH.test(pathname)) {
    return { kind: 'redirect', pathname: '/materials' }
  }

  if (pathname === '/story-studio' || pathname === '/story-studio/') {
    return { kind: 'next' }
  }

  if (LOCALES_WITH_STORY_STUDIO_PATH.test(pathname)) {
    return { kind: 'redirect', pathname: '/story-studio' }
  }

  if (pathname === '/radio' || pathname === '/radio/') {
    return { kind: 'next' }
  }

  if (LOCALES_WITH_RADIO_PATH.test(pathname)) {
    return { kind: 'redirect', pathname: '/radio' }
  }

  return { kind: 'redirect', pathname: '/materials' }
}
