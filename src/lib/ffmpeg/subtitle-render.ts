import path from 'node:path'

export function escapeSubtitleFilterPath(input: string): string {
  return input
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/,/g, '\\,')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
}

export function buildSubtitleFilter(subtitleFile: string): string {
  const escapedPath = escapeSubtitleFilterPath(subtitleFile)
  const extension = path.extname(subtitleFile).toLowerCase()
  if (extension === '.ass') {
    return `subtitles=filename='${escapedPath}'`
  }

  return `subtitles=filename='${escapedPath}':force_style='FontName=Songti SC,FontSize=36,PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BorderStyle=1,Outline=2,Shadow=0,Alignment=2,MarginV=36'`
}
