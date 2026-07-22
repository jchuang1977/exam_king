export type QuestionType = 'single' | 'multiple'
export type ExamStatus = 'draft' | 'published'
export type OptionKey = 'A' | 'B' | 'C' | 'D'

export interface QuestionOption {
  key: OptionKey
  text: string
}

export interface SourceRegion {
  pageNumber: number
  left: number
  top: number
  width: number
  height: number
}

export interface Question {
  id: string
  number: number
  group?: string
  type: QuestionType
  prompt: string
  options: QuestionOption[]
  correctAnswers: OptionKey[]
  points: number
  pageNumber: number
  sourceRegions?: SourceRegion[]
  imageDataUrl?: string
  imageAutoCropped?: boolean
  parseWarnings: string[]
  warningSkipped?: boolean
}

export interface Exam {
  id: string
  title: string
  sourceFileName: string
  sourcePdf: Blob
  pageCount: number
  singlePoints: number
  multiplePoints: number
  status: ExamStatus
  version: number
  questions: Question[]
  createdAt: string
  updatedAt: string
  publishedAt?: string
  structuralWarningsSkipped?: boolean
}

export interface AnswerMap {
  [questionId: string]: OptionKey[]
}

export interface QuestionResult {
  questionId: string
  number: number
  selected: OptionKey[]
  correct: OptionKey[]
  earned: number
  possible: number
  isCorrect: boolean
}

export interface ExamSnapshot {
  title: string
  version: number
  questions: Question[]
}

export interface Attempt {
  id: string
  examId: string
  submittedAt: string
  score: number
  total: number
  answers: AnswerMap
  results: QuestionResult[]
  examSnapshot: ExamSnapshot
}

export interface AnswerDraft {
  examId: string
  answers: AnswerMap
  updatedAt: string
}
