import { openDB, type DBSchema } from 'idb'
import type { AnswerDraft, Attempt, Exam } from './types'

export interface DatabaseContents {
  exams: Exam[]
  attempts: Attempt[]
  drafts: AnswerDraft[]
}

interface ExamMakerDB extends DBSchema {
  exams: {
    key: string
    value: Exam
    indexes: { 'by-updated': string }
  }
  attempts: {
    key: string
    value: Attempt
    indexes: { 'by-exam': string; 'by-submitted': string }
  }
  drafts: {
    key: string
    value: AnswerDraft
  }
}

const dbPromise = openDB<ExamMakerDB>('exam-maker', 1, {
  upgrade(db) {
    const exams = db.createObjectStore('exams', { keyPath: 'id' })
    exams.createIndex('by-updated', 'updatedAt')
    const attempts = db.createObjectStore('attempts', { keyPath: 'id' })
    attempts.createIndex('by-exam', 'examId')
    attempts.createIndex('by-submitted', 'submittedAt')
    db.createObjectStore('drafts', { keyPath: 'examId' })
  },
})

export async function listExams(): Promise<Exam[]> {
  const rows = await (await dbPromise).getAllFromIndex('exams', 'by-updated')
  return rows.reverse()
}

export async function saveExam(exam: Exam): Promise<void> {
  await (await dbPromise).put('exams', exam)
}

export async function removeExam(examId: string): Promise<void> {
  const db = await dbPromise
  const tx = db.transaction(['exams', 'attempts', 'drafts'], 'readwrite')
  await tx.objectStore('exams').delete(examId)
  await tx.objectStore('drafts').delete(examId)
  const attemptKeys = await tx.objectStore('attempts').index('by-exam').getAllKeys(examId)
  await Promise.all(attemptKeys.map((key) => tx.objectStore('attempts').delete(key)))
  await tx.done
}

export async function saveAttempt(attempt: Attempt): Promise<void> {
  await (await dbPromise).put('attempts', attempt)
}

export async function listAttempts(examId: string): Promise<Attempt[]> {
  const rows = await (await dbPromise).getAllFromIndex('attempts', 'by-exam', examId)
  return rows.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
}

export async function saveDraft(draft: AnswerDraft): Promise<void> {
  await (await dbPromise).put('drafts', draft)
}

export async function getDraft(examId: string): Promise<AnswerDraft | undefined> {
  return (await dbPromise).get('drafts', examId)
}

export async function removeDraft(examId: string): Promise<void> {
  await (await dbPromise).delete('drafts', examId)
}

export async function readDatabaseContents(): Promise<DatabaseContents> {
  const db = await dbPromise
  const [exams, attempts, drafts] = await Promise.all([
    db.getAll('exams'),
    db.getAll('attempts'),
    db.getAll('drafts'),
  ])
  return { exams, attempts, drafts }
}

export async function replaceDatabaseContents(contents: DatabaseContents): Promise<void> {
  const db = await dbPromise
  const tx = db.transaction(['exams', 'attempts', 'drafts'], 'readwrite')
  const examStore = tx.objectStore('exams')
  const attemptStore = tx.objectStore('attempts')
  const draftStore = tx.objectStore('drafts')
  await Promise.all([
    examStore.clear(),
    attemptStore.clear(),
    draftStore.clear(),
    ...contents.exams.map((exam) => examStore.put(exam)),
    ...contents.attempts.map((attempt) => attemptStore.put(attempt)),
    ...contents.drafts.map((draft) => draftStore.put(draft)),
  ])
  await tx.done
}
