import type { AnswerMap, Attempt, Exam, OptionKey, Question } from './types'

export function sameAnswers(left: OptionKey[], right: OptionKey[]): boolean {
  if (left.length !== right.length) return false
  const a = [...left].sort()
  const b = [...right].sort()
  return a.every((value, index) => value === b[index])
}

export function examTotal(questions: Question[]): number {
  return questions.reduce((sum, question) => sum + Number(question.points || 0), 0)
}

export function scoreExam(exam: Exam, answers: AnswerMap): Attempt {
  const results = exam.questions.map((question) => {
    const selected = answers[question.id] ?? []
    const isCorrect = sameAnswers(selected, question.correctAnswers)
    return {
      questionId: question.id,
      number: question.number,
      selected,
      correct: [...question.correctAnswers],
      earned: isCorrect ? question.points : 0,
      possible: question.points,
      isCorrect,
    }
  })
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    examId: exam.id,
    submittedAt: now,
    score: results.reduce((sum, result) => sum + result.earned, 0),
    total: examTotal(exam.questions),
    answers,
    results,
    examSnapshot: {
      title: exam.title,
      version: exam.version,
      questions: structuredClone(exam.questions),
    },
  }
}
