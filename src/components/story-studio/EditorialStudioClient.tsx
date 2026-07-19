'use client'

import { useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import type { StoryKnowledgeRecord, StoryStudioBrief } from '@/lib/story-knowledge/types'
import type { EditorialSnapshot } from '@/lib/social-news-video/editorial-view'
import { AppIcon } from '@/components/ui/icons'
import { getStoryAngle, getStoryRisk, getStoryStatus, getStorySummary } from './editorial-model'
import styles from './editorial-studio.module.css'

interface StoryGenerationJob {
  id: string
  storyId: string
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  runDir: string
  releaseFile: string | null
  error: string | null
}

interface StoryGenerationResponse {
  success: boolean
  job: StoryGenerationJob
}

interface StoryGenerationStatusResponse {
  success: boolean
  jobs: StoryGenerationJob[]
  error?: { message?: string }
}

interface EditorialStudioClientProps {
  initialBrief: StoryStudioBrief
  initialSnapshot: EditorialSnapshot
}

interface SnapshotResponse {
  success: boolean
  snapshot?: EditorialSnapshot
  error?: { message?: string }
}

interface HostOpeningResponse {
  success: boolean
  opening?: string
  error?: { message?: string }
}

interface PublishCopyResponse {
  success: boolean
  copy?: {
    title: string
    body: string
    hashtags: string[]
  }
  error?: { message?: string }
}

function localFileUrl(filePath: string): string {
  const normalized = filePath.replaceAll('\\', '/')
  const materialsIndex = normalized.indexOf('/materials/')
  const workspaceRelativePath = materialsIndex >= 0
    ? normalized.slice(materialsIndex + 1)
    : normalized.replace(/^\/+/, '')
  return `/api/public/story-materials/local-file?path=${encodeURIComponent(workspaceRelativePath)}`
}

function previewImageUrl(): string {
  return '/logo.png'
}

function formatDateLabel(value: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(value)
}

function formatSnapshotTime(value: string | null): string {
  if (!value) return '未加载'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '时间未知'
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date)
}

function snapshotStatusLabel(status: EditorialSnapshot['status']): string {
  if (status === 'live') return '实时分析'
  if (status === 'local-snapshot') return '本机快照'
  return '未连接'
}

function storySourceLabel(story: StoryKnowledgeRecord): string {
  const fileName = story.sourcePath.split('/').pop()
  return fileName || story.id
}

function splitStoryTags(value: string): string[] {
  return value.split(/[、,，]/u).map((item) => item.trim()).filter((item) => item.length > 0)
}

function storyFromRecommendation(recommendation: EditorialSnapshot['recommendations'][number]): StoryKnowledgeRecord {
  return {
    id: recommendation.storyId,
    titleTraditional: recommendation.storyTitle,
    titleSimplified: recommendation.storyTitle,
    volume: '',
    priority: '',
    textCharCount: recommendation.storyTextCharCount,
    sourcePath: recommendation.storySourcePath,
    isGenerated: false,
    generatedVideoPath: null,
    categoryTags: splitStoryTags(recommendation.storyCategoryTags),
    riskTags: splitStoryTags(recommendation.storyRiskTags),
    recommendedColumn: '',
    modernAngle: recommendation.storyAngle,
    productionScore: 0,
    productionRecommendation: recommendation.storyProductionRecommendation as StoryKnowledgeRecord['productionRecommendation'],
    productionDifficulty: 0,
    difficultyReason: '',
    sourceExcerpt: recommendation.storySummary,
    deepReview: null,
  }
}

export function EditorialStudioClient({ initialBrief, initialSnapshot }: EditorialStudioClientProps) {
  const records = initialBrief.editorialPicks
  const [dateLabel, setDateLabel] = useState('今日编辑台')
  const [snapshot, setSnapshot] = useState(initialSnapshot)
  const [activeSource, setActiveSource] = useState<'全部' | string>('全部')
  const initialRecommendation = initialSnapshot.recommendations[0]
  const initialResult = initialSnapshot.latestResult
  const [selectedHotId, setSelectedHotId] = useState(initialResult?.hotItem.id || initialRecommendation?.hotId || initialSnapshot.hotItems[0]?.id || '')
  const [selectedStoryId, setSelectedStoryId] = useState(initialResult?.storyId || initialRecommendation?.storyId || records[0]?.id || '')
  const [opening, setOpening] = useState(initialResult?.hostOpening || '')
  const [confirmedStoryId, setConfirmedStoryId] = useState<string | null>(initialResult?.storyId || null)
  const [openingState, setOpeningState] = useState<'idle' | 'loading' | 'ready' | 'failed'>(initialResult?.hostOpening ? 'ready' : 'idle')
  const [openingMessage, setOpeningMessage] = useState('')
  const [copyTitle, setCopyTitle] = useState(initialRecommendation?.publishTitle || '')
  const [copyBody, setCopyBody] = useState(initialRecommendation?.publishBody || '')
  const [copyHashtags, setCopyHashtags] = useState<string[]>(initialRecommendation?.hashtags || [])
  const [copyState, setCopyState] = useState<'idle' | 'loading' | 'ready' | 'failed'>(initialRecommendation?.publishBody && initialRecommendation.hashtags.length === 10 ? 'ready' : 'idle')
  const [copyMessage, setCopyMessage] = useState('')
  const [copyFeedback, setCopyFeedback] = useState('')
  const [launchState, setLaunchState] = useState<'idle' | 'starting' | 'queued' | 'succeeded' | 'failed'>(initialResult?.status === 'succeeded' ? 'succeeded' : initialResult ? 'queued' : 'idle')
  const [launchMessage, setLaunchMessage] = useState(initialResult?.status === 'succeeded' ? '成片已完成，可直接预览' : '')
  const [activeJobId, setActiveJobId] = useState<string | null>(initialResult?.jobId || null)
  const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(initialResult?.status === 'succeeded' ? localFileUrl(initialResult.videoPath) : null)
  const [refreshState, setRefreshState] = useState<'idle' | 'loading' | 'failed'>('idle')
  const [refreshMessage, setRefreshMessage] = useState('')

  const selectedHot = snapshot.hotItems.find((item) => item.id === selectedHotId)
  const selectedRecommendation = snapshot.recommendations.find((item) => item.hotId === selectedHotId) || null
  const recommendationStory = selectedRecommendation ? storyFromRecommendation(selectedRecommendation) : null
  const selectedStory = records.find((record) => record.id === selectedStoryId) || recommendationStory || records[0] || null
  const visibleHotItems = useMemo(() => {
    const filtered = activeSource === '全部'
      ? snapshot.hotItems
      : snapshot.hotItems.filter((item) => item.sourceLabel === activeSource)
    const visible = filtered.slice(0, 14)
    const selected = filtered.find((item) => item.id === selectedHotId)
    if (selected && !visible.some((item) => item.id === selected.id)) visible.push(selected)
    return visible
  }, [activeSource, selectedHotId, snapshot.hotItems])
  const sourceTabs = useMemo(() => [
    '全部',
    ...new Set(snapshot.hotItems.map((item) => item.sourceLabel)),
  ], [snapshot.hotItems])
  const storyMatchesSelectedRecommendation = Boolean(
    selectedRecommendation && selectedStory && selectedRecommendation.storyId === selectedStory.id,
  )
  const storyReadyForVideo = Boolean(
    storyMatchesSelectedRecommendation
    && confirmedStoryId === selectedStory?.id
    && openingState === 'ready'
    && opening.trim()
    && copyState === 'ready'
    && copyBody.trim()
    && copyHashtags.length === 10
  )
  const publishPackageText = copyBody.trim() && copyHashtags.length > 0
    ? `${copyBody.trim()}\n\n${copyHashtags.join(' ')}`
    : ''

  useEffect(() => {
    setDateLabel(formatDateLabel(new Date()))
  }, [])

  useEffect(() => {
    const production = snapshot.latestResult?.storyId === selectedRecommendation?.storyId
      ? snapshot.latestResult
      : null
    setSelectedStoryId(selectedRecommendation?.storyId || '')
    setConfirmedStoryId(production?.storyId || null)
    setOpening(production?.hostOpening || '')
    setOpeningState(production?.hostOpening ? 'ready' : 'idle')
    setOpeningMessage(production ? '本次制作已恢复，可继续编辑' : '')
    setCopyTitle(selectedRecommendation?.publishTitle || '')
    setCopyBody(selectedRecommendation?.publishBody || '')
    setCopyHashtags(selectedRecommendation?.hashtags || [])
    setCopyState(selectedRecommendation?.publishBody && selectedRecommendation.hashtags.length === 10 ? 'ready' : 'idle')
    setCopyMessage(production ? '已恢复本次视频号文案和标签' : '')
    setCopyFeedback('')
    setLaunchState(production?.status === 'succeeded' ? 'succeeded' : production ? 'queued' : 'idle')
    setLaunchMessage(production?.status === 'succeeded' ? '成片已完成，可直接预览' : '')
    setActiveJobId(production?.jobId || null)
    setPreviewVideoUrl(production?.status === 'succeeded' ? localFileUrl(production.videoPath) : null)
  }, [selectedRecommendation?.hashtags, selectedRecommendation?.hotId, selectedRecommendation?.publishBody, selectedRecommendation?.publishTitle, selectedRecommendation?.storyId, snapshot.latestResult])

  useEffect(() => {
    if (!activeJobId) return
    let cancelled = false
    const jobId = activeJobId

    async function pollGenerationJob(): Promise<void> {
      for (let attempt = 0; attempt < 180; attempt += 1) {
        if (cancelled) return
        const response = await fetch(`/api/public/story-materials/generate/status?jobId=${encodeURIComponent(jobId)}`)
        const payload = (await response.json()) as StoryGenerationStatusResponse
        if (!response.ok || !payload.success || !payload.jobs[0]) {
          throw new Error(payload.error?.message || `HTTP ${response.status}`)
        }
        const job = payload.jobs[0]
        if (job.status === 'succeeded') {
          const videoPath = job.releaseFile || `${job.runDir}/10_final_story_hardsub.mp4`
          setPreviewVideoUrl(localFileUrl(videoPath))
          setLaunchState('succeeded')
          setLaunchMessage('成片已完成，可直接预览')
          return
        }
        if (job.status === 'failed') {
          throw new Error(job.error || 'VIDEO_GENERATION_FAILED')
        }
        setLaunchState('queued')
        setLaunchMessage(job.status === 'running' ? '正在生成画面、配音与字幕' : '等待进入制作进程')
        await new Promise((resolve) => setTimeout(resolve, 2000))
      }
      throw new Error('VIDEO_GENERATION_STATUS_TIMEOUT')
    }

    void pollGenerationJob().catch((error: unknown) => {
      if (cancelled) return
      setLaunchState('failed')
      setLaunchMessage(error instanceof Error ? error.message : String(error))
    })

    return () => {
      cancelled = true
    }
  }, [activeJobId])

  function clearOpeningConfirmation(): void {
    setConfirmedStoryId(null)
    setOpening('')
    setOpeningState('idle')
    setOpeningMessage('')
    setCopyTitle('')
    setCopyBody('')
    setCopyHashtags([])
    setCopyState('idle')
    setCopyMessage('')
    setCopyFeedback('')
    setLaunchState('idle')
    setLaunchMessage('')
    setActiveJobId(null)
    setPreviewVideoUrl(null)
  }

  function selectHotItem(hotId: string): void {
    clearOpeningConfirmation()
    setSelectedHotId(hotId)
  }

  function selectStory(storyId: string): void {
    clearOpeningConfirmation()
    setSelectedStoryId(storyId)
  }

  async function refreshSnapshot(): Promise<void> {
    setRefreshState('loading')
    setRefreshMessage('正在抓取热榜并请求阿里云分析')
    try {
      const response = await fetch('/api/public/story-studio/snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const payload = (await response.json()) as SnapshotResponse
      if (!response.ok || !payload.success || !payload.snapshot) {
        throw new Error(payload.error?.message || `HTTP ${response.status}`)
      }
      setSnapshot(payload.snapshot)
      setSelectedHotId(payload.snapshot.recommendations[0]?.hotId || payload.snapshot.hotItems[0]?.id || '')
      setSelectedStoryId(payload.snapshot.recommendations[0]?.storyId || '')
      setConfirmedStoryId(null)
      setOpening('')
      setOpeningState('idle')
      setOpeningMessage('')
      setCopyTitle('')
      setCopyBody('')
      setCopyHashtags([])
      setCopyState('idle')
      setCopyMessage('')
      setCopyFeedback('')
      setRefreshState('idle')
      setRefreshMessage('已完成实时分析')
    } catch (error) {
      setRefreshState('failed')
      setRefreshMessage(error instanceof Error ? error.message : String(error))
    }
  }

  async function confirmStoryAndGenerateOpening(): Promise<void> {
    if (!selectedHot || !selectedStory || !selectedRecommendation || !storyMatchesSelectedRecommendation) return
    setOpeningState('loading')
    setOpeningMessage('故事已确认，正在生成主播开场')
    try {
      const response = await fetch('/api/public/story-studio/host-opening', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storyId: selectedStory.id,
          socialIssue: selectedRecommendation.socialIssue,
          matchReason: selectedRecommendation.matchReason,
          hotNews: {
            source: selectedHot.source,
            rank: selectedHot.rank,
            title: selectedHot.title,
            url: selectedHot.url,
            hot: selectedHot.heat,
            fetchedAt: selectedHot.fetchedAt,
          },
        }),
      })
      const payload = (await response.json()) as HostOpeningResponse
      if (!response.ok || !payload.success || !payload.opening) {
        throw new Error(payload.error?.message || `HTTP ${response.status}`)
      }
      setOpening(payload.opening)
      setConfirmedStoryId(selectedStory.id)
      setOpeningState('ready')
      setOpeningMessage('主播开场已生成，可以编辑后确认并生成视频')
    } catch (error) {
      setOpeningState('failed')
      setOpeningMessage(error instanceof Error ? error.message : String(error))
    }
  }

  async function generatePublishCopy(): Promise<void> {
    if (!selectedHot || !selectedStory || !selectedRecommendation || !storyMatchesSelectedRecommendation) return
    setCopyState('loading')
    setCopyMessage('正在根据已确认故事生成视频号文案')
    try {
      const response = await fetch('/api/public/story-studio/publish-copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storyId: selectedStory.id,
          socialIssue: selectedRecommendation.socialIssue,
          matchReason: selectedRecommendation.matchReason,
          hostOpening: opening.trim(),
          hotNews: {
            source: selectedHot.source,
            rank: selectedHot.rank,
            title: selectedHot.title,
            url: selectedHot.url,
            hot: selectedHot.heat,
            fetchedAt: selectedHot.fetchedAt,
          },
        }),
      })
      const payload = (await response.json()) as PublishCopyResponse
      if (!response.ok || !payload.success || !payload.copy) {
        throw new Error(payload.error?.message || `HTTP ${response.status}`)
      }
      setCopyTitle(payload.copy.title)
      setCopyBody(payload.copy.body)
      setCopyHashtags(payload.copy.hashtags)
      setCopyState('ready')
      setCopyMessage('视频号文案已生成，可以编辑后确认')
    } catch (error) {
      setCopyState('failed')
      setCopyMessage(error instanceof Error ? error.message : String(error))
    }
  }

  async function copyPublishPackage(): Promise<void> {
    if (!publishPackageText) return
    try {
      await navigator.clipboard.writeText(publishPackageText)
      setCopyFeedback('已复制正文和全部标签')
    } catch (error) {
      setCopyFeedback(error instanceof Error ? error.message : String(error))
    }
  }

  async function launchStory(): Promise<void> {
    if (!selectedStory || !storyReadyForVideo) return
    setLaunchState('starting')
    setLaunchMessage('正在送入制作队列')
    try {
      const response = await fetch('/api/public/story-materials/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storyId: selectedStory.id, hostOpening: opening.trim(), mode: 'canonical_long' }),
      })
      const payload = (await response.json()) as Partial<StoryGenerationResponse> & { error?: { message?: string } }
      if (!response.ok || !payload.success || !payload.job) {
        throw new Error(payload.error?.message || `HTTP ${response.status}`)
      }
      const job = payload.job
      const persistResponse = await fetch('/api/public/story-studio/latest-result', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: job.id,
          status: job.status,
          storyId: selectedStory.id,
          runDir: job.runDir,
          videoPath: `${job.runDir}/10_final_story_hardsub.mp4`,
          hostOpening: opening.trim(),
          hotNews: {
            source: selectedHot?.source,
            rank: selectedHot?.rank,
            title: selectedHot?.title,
            url: selectedHot?.url,
            hot: selectedHot?.heat,
            fetchedAt: selectedHot?.fetchedAt,
          },
          socialIssue: selectedRecommendation?.socialIssue,
          matchReason: selectedRecommendation?.matchReason,
          matchScore: selectedRecommendation?.matchScore,
          matchEvidence: selectedRecommendation?.matchEvidence,
          storyEvidence: selectedRecommendation?.storyEvidence,
          comparisonNote: selectedRecommendation?.comparisonNote,
          riskLevel: selectedRecommendation?.riskLevel,
          riskNotes: selectedRecommendation?.riskNotes,
          copy: { title: copyTitle, body: copyBody, hashtags: copyHashtags },
        }),
      })
      const persistPayload = (await persistResponse.json().catch(() => null)) as { error?: { message?: string } } | null
      if (!persistResponse.ok) {
        throw new Error(persistPayload?.error?.message || `HTTP ${persistResponse.status}`)
      }
      setLaunchState('queued')
      setActiveJobId(job.id)
      setLaunchMessage(`已入队：${job.status}`)
    } catch (error) {
      setLaunchState('failed')
      setLaunchMessage(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <main className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <span>EDITORIAL WORKSPACE</span>
          <strong>子不语·故事编辑部</strong>
        </div>
        <div className={styles.topbarMeta}>
          <span>{dateLabel}</span>
          <span>数据更新：{formatSnapshotTime(snapshot.fetchedAt)}</span>
          <span className={styles.liveMark}>{snapshotStatusLabel(snapshot.status)}</span>
          <button type="button" aria-label="打开设置" title="设置" className={styles.iconButton}>
            <AppIcon name="settingsHex" size={16} />
          </button>
        </div>
      </header>

      <div className={styles.workspace}>
        <aside className={styles.hotRail} aria-label="今日热点">
          <div className={styles.railHeader}>
            <div>
              <div className={styles.eyebrow}>Daily signal</div>
              <h1>今日热榜</h1>
              <p className={styles.demoNote}>
                {snapshot.status === 'local-snapshot'
                  ? `显示最近一次本机快照：${formatSnapshotTime(snapshot.fetchedAt)}`
                  : snapshot.status === 'live'
                    ? '热点已由 NewsNow 抓取，匹配由阿里云模型完成。'
                    : '暂无可用热点；请重新抓取并查看失败原因。'}
              </p>
            </div>
            <button
              type="button"
              aria-label="重新分析热点"
              title="重新抓取并分析"
              className={styles.iconButtonLight}
              onClick={() => void refreshSnapshot()}
              disabled={refreshState === 'loading'}
            >
              <AppIcon name="refresh" size={17} />
            </button>
          </div>

          <div className={styles.sourceTabs} role="tablist" aria-label="热点来源">
            {sourceTabs.map((source) => (
              <button
                key={source}
                type="button"
                role="tab"
                aria-selected={activeSource === source}
                data-active={activeSource === source}
                onClick={() => setActiveSource(source)}
              >
                {source}
              </button>
            ))}
          </div>

          <div className={styles.hotList}>
            {visibleHotItems.length > 0 ? visibleHotItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={styles.hotItem}
                data-active={selectedHot?.id === item.id}
                onClick={() => selectHotItem(item.id)}
              >
                <span className={styles.hotRank}>{item.rank}</span>
                <span className={styles.hotBody}>
                  <strong>{item.title}</strong>
                  <span className={styles.hotMeta}>
                    <span>{item.sourceLabel}</span>
                    <span>{item.heat}</span>
                    <span className={item.trend === '上升' ? styles.trendUp : styles.trendFlat}>{item.trend}</span>
                  </span>
                </span>
              </button>
            )) : <p className={styles.emptyState}>当前来源没有热点。</p>}
          </div>
          {refreshMessage ? <p className={refreshState === 'failed' ? styles.statusMessage : styles.successMessage}>{refreshMessage}</p> : null}
        </aside>

        <section className={styles.editor} aria-label="故事编辑区">
          <div className={styles.editorTopline}>
            <div className={styles.selectedHot}>
              <div className={styles.sectionKicker}>Selected signal / {selectedHot?.issue || '社会议题'}</div>
              <p>{selectedHot?.title || '请选择一个热点'}</p>
            </div>
            <div className={styles.distance} aria-label="热点与故事的距离">
              <span>现实</span>
              <span className={styles.distanceLine} />
              <span>故事 · {selectedRecommendation ? '已匹配' : '待分析'}</span>
            </div>
          </div>

          {selectedStory && selectedHot ? (
            <>
              <section className={styles.editorSection}>
                <div className={styles.sectionHeader}>
                  <div>
                    <div className={styles.sectionKicker}>Host bridge</div>
                    <h2>主播开场</h2>
                  </div>
                  <AppIcon name="sparkles" size={18} color="#b73c2e" />
                </div>
                <p className={styles.issueLine}>提炼议题：{selectedHot.issue} · 不替现实下结论，只把观众带到故事门口。</p>
                <textarea aria-label="主播开场" className={styles.hostTextarea} value={opening} onChange={(event) => setOpening(event.target.value)} disabled={openingState !== 'ready'} placeholder="请先确认故事，再生成主播开场。" />
                <div className={styles.editorFooter}>
                  <p className={styles.editorFooterNote}>{openingMessage || '主播开场会在确认故事后，结合热点和完整故事原文生成。'}</p>
                  <button type="button" className={styles.secondaryButton} onClick={() => void confirmStoryAndGenerateOpening()} disabled={!storyMatchesSelectedRecommendation || openingState === 'loading'}>
                    <AppIcon name="sparkles" size={14} />
                    {openingState === 'loading' ? '正在生成' : '确认故事并生成开场'}
                  </button>
                </div>
                <p className={styles.characterCount}>{opening.length} 字 · 建议控制在 80–130 字</p>
              </section>

              <section className={styles.editorSection}>
                <div className={styles.sectionHeader}>
                  <div>
                    <div className={styles.sectionKicker}>Story source</div>
                    <h2>{selectedStory.titleSimplified}</h2>
                  </div>
                  <AppIcon name="bookOpen" size={18} color="#69704c" />
                </div>
                <div className={styles.storyHeaderMeta}>
                  <span>{selectedStory.id}</span>
                  <span>{storySourceLabel(selectedStory)}</span>
                  <span>{selectedStory.textCharCount} 字原文</span>
                  <span>{getStoryStatus(selectedStory)}</span>
                </div>
                <p className={styles.storyText}>{getStorySummary(selectedStory)}{`\n\n`}{selectedStory.deepReview?.emotionalHook || getStoryAngle(selectedStory)}{`\n\n`}正文将在生成时依据原始素材完整展开。</p>
                <div className={styles.matchStrip}>
                  <strong>{selectedRecommendation ? '已配' : '待配'}</strong>
                  <p>
                    <b>为什么联想到它：</b>
                    {selectedRecommendation?.matchReason || '这条热点暂未通过大模型匹配，不能直接进入生产。'}
                    {selectedRecommendation?.matchScore !== null && selectedRecommendation?.matchScore !== undefined ? `（匹配度 ${selectedRecommendation.matchScore}）` : ''}
                    {selectedRecommendation?.comparisonNote ? ` ${selectedRecommendation.comparisonNote}` : ''}
                  </p>
                </div>
              </section>

              <div className={styles.editorFooter}>
                <p className={styles.editorFooterNote}>
                  {storyReadyForVideo
                    ? '故事、主播开场和视频号文案已确认，可以进入阿里云视频制作。'
                    : storyMatchesSelectedRecommendation
                      ? openingState !== 'ready'
                        ? '故事已匹配，请先确认故事并生成主播开场。'
                        : '主播开场已完成，请生成视频号文案后再进入视频制作。'
                    : '请先选择模型匹配的故事，或重新分析热点；不能把未匹配的故事直接送入制作。'}
                </p>
                <button type="button" className={styles.primaryButton} onClick={() => void launchStory()} disabled={launchState === 'starting' || !storyReadyForVideo}>
                  <AppIcon name="clapperboard" size={15} />
                  {launchState === 'starting' ? '正在入队' : '生成视频'}
                </button>
              </div>
              {launchMessage ? <p className={styles.statusMessage}>{launchMessage}</p> : null}
            </>
          ) : (
            <div className={styles.editorSection}>素材库暂无可用故事。</div>
          )}
        </section>

        <aside className={styles.previewRail} aria-label="成片预览">
          <div className={styles.previewHeader}>
            <div>
              <div className={styles.sectionKicker}>Output desk</div>
              <h2>成片预览</h2>
            </div>
            <button type="button" aria-label="查看作品档案" title="作品档案"><AppIcon name="externalLink" size={16} /></button>
          </div>

          <div className={styles.previewFrame}>
            {previewVideoUrl ? (
              <video src={previewVideoUrl} controls playsInline preload="metadata" aria-label="生成完成的故事视频" />
            ) : (
              <>
                <Image src={previewImageUrl()} alt="志怪故事场景预览" fill sizes="(max-width: 820px) 260px, 300px" priority unoptimized />
                <span className={styles.previewPlay}><AppIcon name="play" size={17} fill="currentColor" /></span>
              </>
            )}
            <div className={styles.previewCaption}>
              <span>子不语 / daily story</span>
              <strong>{selectedStory?.titleSimplified || '待选故事'}</strong>
            </div>
          </div>

          <div className={styles.previewStatus}>
            <div className={styles.statusRow}><span>制作阶段</span><strong>{launchState === 'queued' ? '制作中' : launchState === 'succeeded' ? '已完成' : launchState === 'failed' ? '失败' : '待确认'}</strong></div>
            <div className={styles.progressTrack}><span data-state={launchState} /></div>
            <div className={styles.statusRow}><span><AppIcon name="fileText" size={13} /> 旁白</span><strong>{selectedStory ? `${Math.max(380, Math.round(selectedStory.textCharCount * 0.46))} 字` : '—'}</strong></div>
            <div className={styles.statusRow}><span>场景</span><strong>7</strong></div>
            <div className={styles.statusRow}><span>匹配风险</span><strong>{selectedRecommendation?.riskLevel || '—'}</strong></div>
            <div className={styles.statusRow}><span>原始风险</span><strong>{selectedStory ? getStoryRisk(selectedStory) : '—'}</strong></div>
          </div>

          <div className={styles.copyPreview}>
            <h3>视频号文案</h3>
            {copyTitle ? <strong>{copyTitle}</strong> : null}
            <textarea
              aria-label="视频号正文"
              className={styles.hostTextarea}
              value={copyBody}
              onChange={(event) => setCopyBody(event.target.value)}
              disabled={copyState !== 'ready'}
              placeholder="确认故事后，可单独生成视频号文案。"
            />
            <div className={styles.tagLine}>
              {copyHashtags.map((tag) => <span key={tag}>{tag}</span>)}
            </div>
            <p className={copyState === 'failed' ? styles.statusMessage : styles.successMessage}>{copyMessage || '文案生成不会重新抓取热点，也不会重新匹配故事。'}</p>
            <div className={styles.editorFooter}>
              <button type="button" className={styles.secondaryButton} onClick={() => void generatePublishCopy()} disabled={!storyMatchesSelectedRecommendation || copyState === 'loading'}>
                <AppIcon name="fileText" size={14} />
                {copyState === 'loading' ? '正在生成' : copyState === 'ready' ? '重新生成文案' : '生成视频号文案'}
              </button>
              <button type="button" className={styles.secondaryButton} onClick={() => void copyPublishPackage()} disabled={!publishPackageText}>
                <AppIcon name="copy" size={14} />
                {copyFeedback || '复制文案和标签'}
              </button>
            </div>
          </div>

          <div className={styles.previewHeader} style={{ marginTop: 24 }}>
            <button type="button" className={styles.secondaryButton} onClick={() => selectedRecommendation && selectStory(selectedRecommendation.storyId)} disabled={!selectedRecommendation}><AppIcon name="check" size={14} /> 使用匹配故事</button>
            <span className={styles.sectionKicker}>{records.length} 个候选</span>
          </div>
          <div className={styles.hotList} style={{ marginTop: 14 }}>
            {records.slice(0, 4).map((record, index) => (
              <button key={record.id} type="button" className={styles.hotItem} data-active={record.id === selectedStory?.id} onClick={() => selectStory(record.id)}>
                <span className={styles.hotRank}>{index + 1}</span>
                <span className={styles.hotBody}><strong>{record.titleSimplified}</strong><span className={styles.hotMeta}><span>{record.productionScore} 分</span><AppIcon name="chevronRight" size={12} /></span></span>
              </button>
            ))}
          </div>
        </aside>
      </div>
    </main>
  )
}
