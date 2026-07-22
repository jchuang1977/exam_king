import type { DatabaseContents } from './db'
import type { AnswerDraft, Attempt, Exam, OptionKey, Question } from './types'

const BACKUP_FORMAT = 'exam-king-backup'
const BACKUP_VERSION = 1
const optionKeys = new Set<OptionKey>(['A', 'B', 'C', 'D'])

interface SerializedPdf {
  type: string
  base64: string
}

type SerializedExam = Omit<Exam, 'sourcePdf'> & { sourcePdf: SerializedPdf }

interface BackupDocument {
  format: typeof BACKUP_FORMAT
  version: typeof BACKUP_VERSION
  exportedAt: string
  data: {
    exams: SerializedExam[]
    attempts: Attempt[]
    drafts: AnswerDraft[]
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunks: string[] = []
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)))
  }
  return btoa(chunks.join(''))
}

function base64ToBlob(value: SerializedPdf): Blob {
  try {
    const binary = atob(value.base64)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    return new Blob([bytes], { type: value.type || 'application/pdf' })
  } catch {
    throw new Error('備份中的 PDF 資料已損壞。')
  }
}

function isQuestion(value: unknown): value is Question {
  if (!isRecord(value)) return false
  if (typeof value.id !== 'string' || typeof value.number !== 'number' || typeof value.prompt !== 'string') return false
  if (value.type !== 'single' && value.type !== 'multiple') return false
  if (typeof value.points !== 'number' || !Array.isArray(value.options) || !Array.isArray(value.correctAnswers)) return false
  if (!value.options.every((option) => isRecord(option) && optionKeys.has(option.key as OptionKey) && typeof option.text === 'string')) return false
  return value.correctAnswers.every((answer) => optionKeys.has(answer as OptionKey))
}

function isSerializedExam(value: unknown): value is SerializedExam {
  if (!isRecord(value) || !isRecord(value.sourcePdf)) return false
  if (typeof value.id !== 'string' || typeof value.title !== 'string' || typeof value.sourceFileName !== 'string') return false
  if (value.status !== 'draft' && value.status !== 'published') return false
  if (typeof value.version !== 'number' || !Array.isArray(value.questions) || !value.questions.every(isQuestion)) return false
  return typeof value.sourcePdf.type === 'string' && typeof value.sourcePdf.base64 === 'string'
}

function isAttempt(value: unknown): value is Attempt {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.examId === 'string'
    && typeof value.submittedAt === 'string'
    && typeof value.score === 'number'
    && typeof value.total === 'number'
    && isRecord(value.answers)
    && Array.isArray(value.results)
    && isRecord(value.examSnapshot)
}

function isDraft(value: unknown): value is AnswerDraft {
  return isRecord(value)
    && typeof value.examId === 'string'
    && typeof value.updatedAt === 'string'
    && isRecord(value.answers)
}

function assertUnique(values: string[], label: string) {
  if (new Set(values).size !== values.length) throw new Error(`備份包含重複的${label}識別碼。`)
}

export async function createBackupJson(contents: DatabaseContents): Promise<string> {
  const exams: SerializedExam[] = await Promise.all(contents.exams.map(async ({ sourcePdf, ...exam }) => ({
    ...exam,
    sourcePdf: {
      type: sourcePdf.type || 'application/pdf',
      base64: bytesToBase64(new Uint8Array(await sourcePdf.arrayBuffer())),
    },
  })))
  const document: BackupDocument = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data: { exams, attempts: contents.attempts, drafts: contents.drafts },
  }
  return JSON.stringify(document)
}

export function parseBackupJson(json: string): DatabaseContents {
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch {
    throw new Error('這不是有效的 JSON 備份檔。')
  }
  if (!isRecord(value) || value.format !== BACKUP_FORMAT) throw new Error('這不是試卷工作台的備份檔。')
  if (value.version !== BACKUP_VERSION) throw new Error(`不支援此備份版本：${String(value.version)}。`)
  if (!isRecord(value.data)) throw new Error('備份缺少資料內容。')
  const { exams, attempts, drafts } = value.data
  if (!Array.isArray(exams) || !exams.every(isSerializedExam)) throw new Error('備份中的試卷資料格式不正確。')
  if (!Array.isArray(attempts) || !attempts.every(isAttempt)) throw new Error('備份中的作答紀錄格式不正確。')
  if (!Array.isArray(drafts) || !drafts.every(isDraft)) throw new Error('備份中的作答草稿格式不正確。')

  assertUnique(exams.map((exam) => exam.id), '試卷')
  assertUnique(attempts.map((attempt) => attempt.id), '作答紀錄')
  assertUnique(drafts.map((draft) => draft.examId), '草稿')
  const examIds = new Set(exams.map((exam) => exam.id))
  if (attempts.some((attempt) => !examIds.has(attempt.examId)) || drafts.some((draft) => !examIds.has(draft.examId))) {
    throw new Error('備份包含找不到所屬試卷的作答資料。')
  }

  return {
    exams: exams.map(({ sourcePdf, ...exam }) => ({ ...exam, sourcePdf: base64ToBlob(sourcePdf) })),
    attempts,
    drafts,
  }
}
