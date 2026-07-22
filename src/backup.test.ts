import { describe, expect, it } from 'vitest'
import { createBackupJson, parseBackupJson } from './backup'
import type { DatabaseContents } from './db'
import type { Exam } from './types'

function sampleExam(): Exam {
  return {
    id: 'exam-1',
    title: '備份測試',
    sourceFileName: 'sample.pdf',
    sourcePdf: new Blob(['%PDF sample'], { type: 'application/pdf' }),
    pageCount: 1,
    singlePoints: 2,
    multiplePoints: 4,
    status: 'published',
    version: 2,
    questions: [{
      id: 'question-1',
      number: 1,
      type: 'single',
      prompt: '測試題目',
      options: [
        { key: 'A', text: '答案 A' }, { key: 'B', text: '答案 B' },
        { key: 'C', text: '答案 C' }, { key: 'D', text: '答案 D' },
      ],
      correctAnswers: ['A'],
      points: 2,
      pageNumber: 1,
      imageDataUrl: 'data:image/png;base64,AA==',
      parseWarnings: [],
    }],
    createdAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-22T00:00:00.000Z',
    publishedAt: '2026-07-22T00:00:00.000Z',
  }
}

describe('complete backup', () => {
  it('round-trips exams, PDFs, images, attempts, and drafts', async () => {
    const exam = sampleExam()
    const contents: DatabaseContents = {
      exams: [exam],
      attempts: [{
        id: 'attempt-1', examId: exam.id, submittedAt: '2026-07-22T01:00:00.000Z', score: 2, total: 2,
        answers: { 'question-1': ['A'] },
        results: [{ questionId: 'question-1', number: 1, selected: ['A'], correct: ['A'], earned: 2, possible: 2, isCorrect: true }],
        examSnapshot: { title: exam.title, version: exam.version, questions: exam.questions },
      }],
      drafts: [{ examId: exam.id, answers: { 'question-1': ['B'] }, updatedAt: '2026-07-22T02:00:00.000Z' }],
    }

    const restored = parseBackupJson(await createBackupJson(contents))

    expect(restored.exams[0].title).toBe(exam.title)
    expect(restored.exams[0].questions[0].imageDataUrl).toBe(exam.questions[0].imageDataUrl)
    expect(await restored.exams[0].sourcePdf.text()).toBe('%PDF sample')
    expect(restored.attempts).toEqual(contents.attempts)
    expect(restored.drafts).toEqual(contents.drafts)
  })

  it('rejects unrelated and unsupported backup files', () => {
    expect(() => parseBackupJson('{"hello":"world"}')).toThrow('不是試卷工作台')
    expect(() => parseBackupJson('{"format":"exam-king-backup","version":99,"data":{}}')).toThrow('不支援此備份版本')
  })

  it('rejects orphan attempt data', async () => {
    const json = await createBackupJson({
      exams: [],
      attempts: [{ id: 'attempt-1', examId: 'missing', submittedAt: '', score: 0, total: 0, answers: {}, results: [], examSnapshot: { title: '', version: 1, questions: [] } }],
      drafts: [],
    })
    expect(() => parseBackupJson(json)).toThrow('找不到所屬試卷')
  })
})
