import { describe, expect, it } from 'vitest'
import { buildSubtitleFilter, escapeSubtitleFilterPath } from './subtitle-render'

describe('subtitle render helpers', () => {
  it('escapes special characters for ffmpeg subtitles filter paths', () => {
    const escaped = escapeSubtitleFilterPath("/tmp/a:b,c[1]'x'.ass")
    expect(escaped).toBe("/tmp/a\\:b\\,c\\[1\\]\\'x\\'.ass")
  })

  it('builds ass subtitles filter without force_style override', () => {
    const filter = buildSubtitleFilter('/tmp/subtitles.ass')
    expect(filter).toBe("subtitles=filename='/tmp/subtitles.ass'")
  })

  it('builds srt subtitles filter with explicit force_style', () => {
    const filter = buildSubtitleFilter('/tmp/subtitles.srt')
    expect(filter).toContain("subtitles=filename='/tmp/subtitles.srt'")
    expect(filter).toContain("force_style='FontName=Songti SC")
    expect(filter).toContain('FontSize=36')
  })

  it('uses explicit filename option so absolute ass paths work on ffmpeg 8', () => {
    const filter = buildSubtitleFilter('/Users/gsdata/demo/09_subtitles_auto.ass')
    expect(filter).toBe("subtitles=filename='/Users/gsdata/demo/09_subtitles_auto.ass'")
  })
})
