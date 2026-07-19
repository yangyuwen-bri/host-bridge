import { describe, expect, it } from 'vitest'
import { resolveStoryMaterialsStandaloneRoute } from './standalone-routing'

describe('story materials standalone routing', () => {
  it('serves public materials path directly in standalone mode', () => {
    expect(resolveStoryMaterialsStandaloneRoute('/materials')).toEqual({
      kind: 'next',
    })
  })

  it('redirects root and localized material aliases to the standalone public path', () => {
    expect(resolveStoryMaterialsStandaloneRoute('/')).toEqual({
      kind: 'redirect',
      pathname: '/materials',
    })
    expect(resolveStoryMaterialsStandaloneRoute('/zh/materials')).toEqual({
      kind: 'redirect',
      pathname: '/materials',
    })
    expect(resolveStoryMaterialsStandaloneRoute('/en/materials')).toEqual({
      kind: 'redirect',
      pathname: '/materials',
    })
  })

  it('keeps unrelated product routes out of standalone mode', () => {
    expect(resolveStoryMaterialsStandaloneRoute('/workspace')).toEqual({
      kind: 'redirect',
      pathname: '/materials',
    })
  })

  it('redirects localized story studio aliases to the standalone product workspace', () => {
    expect(resolveStoryMaterialsStandaloneRoute('/zh/story-studio')).toEqual({
      kind: 'redirect',
      pathname: '/story-studio',
    })
    expect(resolveStoryMaterialsStandaloneRoute('/en/story-studio')).toEqual({
      kind: 'redirect',
      pathname: '/story-studio',
    })
  })

  it('serves unlocalized story studio directly in standalone mode', () => {
    expect(resolveStoryMaterialsStandaloneRoute('/story-studio')).toEqual({
      kind: 'next',
    })
  })

  it('serves radio as an independent standalone experience', () => {
    expect(resolveStoryMaterialsStandaloneRoute('/radio')).toEqual({
      kind: 'next',
    })
    expect(resolveStoryMaterialsStandaloneRoute('/zh/radio')).toEqual({
      kind: 'redirect',
      pathname: '/radio',
    })
  })
})
