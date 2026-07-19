import { describe, expect, it } from 'vitest'
import { deepConvertTraditionalToSimplified, toSimplifiedChinese } from './chinese-script'

describe('story runner chinese script normalization', () => {
  it('converts traditional chinese source text into simplified chinese', () => {
    expect(toSimplifiedChinese('漢語與廣東話，陳生見屍體後說這裡太怪了。')).toBe(
      '汉语与广东话，陈生见尸体后说这里太怪了。',
    )
  })

  it('deeply normalizes nested blueprint-like text fields without mutating ids or numbers', () => {
    const input = {
      title: '南山頑石',
      style: '古典志怪',
      characters: [
        { id: 'c1', name: '陳秀才', appearance: '瘦削書生', costume: '青衫長袍', anchor: '古廟書生' },
      ],
      scenes: [
        {
          id: 1,
          summary: '見怪石',
          voiceOver: '陳秀才見著怪石，心裡驚惶。',
          durationSec: 17,
          imagePrompt: 'cinematic close-up of a scholar in an old temple',
          charRefs: ['c1'],
        },
      ],
    }

    const normalized = deepConvertTraditionalToSimplified(input)

    expect(normalized.title).toBe('南山顽石')
    expect(normalized.characters[0].name).toBe('陈秀才')
    expect(normalized.characters[0].costume).toBe('青衫长袍')
    expect(normalized.scenes[0].summary).toBe('见怪石')
    expect(normalized.scenes[0].voiceOver).toBe('陈秀才见着怪石，心里惊惶。')
    expect(normalized.scenes[0].imagePrompt).toBe('cinematic close-up of a scholar in an old temple')
    expect(normalized.scenes[0].charRefs).toEqual(['c1'])
    expect(normalized.scenes[0].durationSec).toBe(17)
  })
})
