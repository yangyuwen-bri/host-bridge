import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildStoryStudioBrief, readStoryKnowledgeDatabase } from './index'

function makeWorkspace(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'story-knowledge-test-'))
  mkdirSync(path.join(root, 'materials', 'zhiguai', 'analysis', 'content_ops_review'), { recursive: true })
  return root
}

describe('story knowledge database', () => {
  it('merges rule review records with deep review shortlist and ranks pending strong picks first', () => {
    const workspaceRoot = makeWorkspace()
    try {
      const reviewDir = path.join(workspaceRoot, 'materials', 'zhiguai', 'analysis', 'content_ops_review')
      writeFileSync(path.join(reviewDir, 'zby_sa_ops_review_rule_first_pass.json'), JSON.stringify({
        meta: { generated_at: '2026-06-20T17:31:47' },
        records: [
          {
            id: 'zby-v01-001',
            title_trad: '强案',
            volume: '子不语·卷1',
            priority: 'S',
            text_char_count: 300,
            source_path: 'stories/zby-v01-001/source.txt',
            is_generated: false,
            generated_video: '',
            category_tags: '古代社会新闻、民间怪谈强刺激',
            risk_tags: '封建迷信浓度高',
            recommended_column: '古代社会新闻',
            modern_angle: '古代社会新闻：冤案',
            production_score: 81,
            production_recommendation: '推荐',
            production_difficulty: 2,
            difficulty_reason: '常规制作',
            source_excerpt: '原文摘录',
          },
          {
            id: 'zby-v01-002',
            title_trad: '已生成案',
            volume: '子不语·卷1',
            priority: 'S',
            text_char_count: 420,
            source_path: 'stories/zby-v01-002/source.txt',
            is_generated: true,
            generated_video: '/tmp/video.mp4',
            category_tags: '古代社会新闻',
            risk_tags: '',
            recommended_column: '古代社会新闻',
            modern_angle: '古代社会新闻：悬案',
            production_score: 99,
            production_recommendation: '推荐',
            production_difficulty: 1,
            difficulty_reason: '常规制作',
            source_excerpt: '已生成摘录',
          },
        ],
      }), 'utf8')
      writeFileSync(path.join(reviewDir, 'zby_s_priority_shortlist.json'), JSON.stringify({
        records: [
          {
            id: 'zby-v01-001',
            deep: {
              id: 'zby-v01-001',
              title_simplified: '强案',
              one_sentence_summary: '一句话梗概',
              modern_news_angle: '社会新闻角度',
              main_conflict: '主冲突',
              emotional_hook: '情绪钩子',
              account_column: '古代社会新闻',
              video_title_angles: ['标题一', '标题二'],
              risk_notes: '风险低',
              visual_notes: '画面建议',
              production_priority: '强烈推荐',
              production_reason: '值得先拍',
            },
          },
        ],
      }), 'utf8')

      const db = readStoryKnowledgeDatabase(workspaceRoot)
      expect(db.records.length).toBe(2)
      expect(db.records[0].id).toBe('zby-v01-001')
      expect(db.records[0].deepReview?.oneSentenceSummary).toBe('一句话梗概')
      expect(db.records[0].categoryTags).toEqual(['古代社会新闻', '民间怪谈强刺激'])
      expect(db.summary.generatedCount).toBe(1)
      expect(db.summary.pendingCount).toBe(1)

      const brief = buildStoryStudioBrief(workspaceRoot)
      expect(brief.heroPick?.id).toBe('zby-v01-001')
      expect(brief.columns[0].name).toBe('古代社会新闻')
      expect(brief.generatedShowcase[0].generatedVideoPath).toBe('/tmp/video.mp4')
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })
})
