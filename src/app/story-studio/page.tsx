import { EditorialStudioClient } from '@/components/story-studio/EditorialStudioClient'
import { readLatestEditorialSnapshot } from '@/lib/social-news-video/editorial-view'
import { buildStoryStudioBrief } from '@/lib/story-knowledge'

export const dynamic = 'force-dynamic'

export default function StoryStudioPage() {
  const brief = buildStoryStudioBrief(process.cwd())
  const snapshot = readLatestEditorialSnapshot(process.cwd())
  return <EditorialStudioClient initialBrief={brief} initialSnapshot={snapshot} />
}
