import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { createBackupJson, parseBackupJson } from './backup'
import { getDraft, listAttempts, listExams, readDatabaseContents, removeDraft, removeExam, replaceDatabaseContents, saveAttempt, saveDraft, saveExam } from './db'
import { parsePdf, validateQuestion } from './pdfParser'
import { PdfCropper } from './PdfCropper'
import { examTotal, scoreExam } from './scoring'
import type { AnswerMap, Attempt, Exam, OptionKey, Question, QuestionType } from './types'

type Screen = 'library' | 'review' | 'take' | 'result' | 'stats'
const optionKeys: OptionKey[] = ['A', 'B', 'C', 'D']

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-TW', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function answerLabel(values: OptionKey[]) {
  return values.length ? values.sort().join('、') : '未作答'
}

function App() {
  const [exams, setExams] = useState<Exam[]>([])
  const [selectedExamId, setSelectedExamId] = useState<string>()
  const [screen, setScreen] = useState<Screen>('library')
  const [result, setResult] = useState<Attempt>()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const pdfFileRef = useRef<HTMLInputElement>(null)
  const backupFileRef = useRef<HTMLInputElement>(null)

  useEffect(() => { void listExams().then(setExams) }, [])
  const selectedExam = exams.find((exam) => exam.id === selectedExamId)

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setBusy(true)
    setMessage('正在讀取文字層、題號與答案…')
    try {
      const exam = await parsePdf(file)
      await saveExam(exam)
      setExams((current) => [exam, ...current])
      setSelectedExamId(exam.id)
      setScreen('review')
      setMessage('')
    } catch (reason) {
      setMessage(reason instanceof Error ? `匯入失敗：${reason.message}` : '匯入失敗，請確認 PDF 是否可讀取。')
    } finally {
      setBusy(false)
    }
  }

  async function updateExam(updated: Exam) {
    await saveExam(updated)
    setExams((current) => current.map((exam) => exam.id === updated.id ? updated : exam))
  }

  async function exportBackup() {
    setBusy(true)
    setMessage('正在整理題庫、PDF、草稿與成績…')
    try {
      const contents = await readDatabaseContents()
      const json = await createBackupJson(contents)
      const timestamp = new Date().toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z')
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = `exam-king-backup-${timestamp}.json`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
      setMessage(`完整備份已匯出：${contents.exams.length} 份試卷、${contents.attempts.length} 次作答。`)
    } catch (reason) {
      setMessage(reason instanceof Error ? `備份匯出失敗：${reason.message}` : '備份匯出失敗。')
    } finally {
      setBusy(false)
    }
  }

  async function importBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setBusy(true)
    setMessage('正在檢查完整備份…')
    try {
      const contents = parseBackupJson(await file.text())
      const confirmed = window.confirm(
        `備份包含 ${contents.exams.length} 份試卷、${contents.attempts.length} 次作答及 ${contents.drafts.length} 份作答草稿。\n\n繼續後會清除並取代目前瀏覽器中的全部題庫與成績，確定要還原嗎？`,
      )
      if (!confirmed) {
        setMessage('已取消匯入備份，目前資料沒有變更。')
        return
      }
      await replaceDatabaseContents(contents)
      setExams(await listExams())
      setSelectedExamId(undefined)
      setResult(undefined)
      setScreen('library')
      setMessage(`備份還原完成：${contents.exams.length} 份試卷、${contents.attempts.length} 次作答。`)
    } catch (reason) {
      setMessage(reason instanceof Error ? `備份匯入失敗：${reason.message}` : '備份匯入失敗。')
    } finally {
      setBusy(false)
    }
  }

  function openExam(exam: Exam, target: Screen) {
    setSelectedExamId(exam.id)
    setScreen(target)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function deleteExam(exam: Exam) {
    if (!window.confirm(`確定刪除「${exam.title}」及其全部作答紀錄？`)) return
    await removeExam(exam.id)
    setExams((current) => current.filter((item) => item.id !== exam.id))
  }

  function goHome() {
    setScreen('library')
    setSelectedExamId(undefined)
    setResult(undefined)
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={goHome} aria-label="回到題庫">
          <span className="brand-mark">卷</span>
          <span><strong>試卷工作台</strong><small>LOCAL EXAM DESK</small></span>
        </button>
        <div className="privacy-chip"><span /> 僅儲存在這個瀏覽器</div>
      </header>

      {screen === 'library' && (
        <Library
          exams={exams}
          busy={busy}
          message={message}
          onImport={() => pdfFileRef.current?.click()}
          onExportBackup={() => void exportBackup()}
          onImportBackup={() => backupFileRef.current?.click()}
          onOpen={openExam}
          onDelete={deleteExam}
        />
      )}
      {screen === 'review' && selectedExam && <ReviewPage exam={selectedExam} onChange={updateExam} onBack={goHome} onTake={() => openExam(selectedExam, 'take')} />}
      {screen === 'take' && selectedExam && <TakePage exam={selectedExam} onBack={goHome} onSubmit={(attempt) => { setResult(attempt); setScreen('result') }} />}
      {screen === 'result' && result && <ResultPage attempt={result} onBack={goHome} onRetry={() => selectedExam && openExam(selectedExam, 'take')} onStats={() => setScreen('stats')} />}
      {screen === 'stats' && selectedExam && <StatsPage exam={selectedExam} onBack={goHome} onAttempt={(attempt) => { setResult(attempt); setScreen('result') }} onRetry={() => openExam(selectedExam, 'take')} />}

      <input ref={pdfFileRef} className="visually-hidden" type="file" accept="application/pdf,.pdf" onChange={handleImport} />
      <input ref={backupFileRef} className="visually-hidden" type="file" accept="application/json,.json" onChange={importBackup} />
    </div>
  )
}

function Library({ exams, busy, message, onImport, onExportBackup, onImportBackup, onOpen, onDelete }: {
  exams: Exam[]
  busy: boolean
  message: string
  onImport: () => void
  onExportBackup: () => void
  onImportBackup: () => void
  onOpen: (exam: Exam, screen: Screen) => void
  onDelete: (exam: Exam) => void
}) {
  return (
    <main>
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">PDF → 校對 → 作答 → 統計</span>
          <h1>把公告試題，整理成<br /><em>真正能練習</em>的考卷。</h1>
          <p>答案、單複選與配分自動帶入；附圖與特殊版面由你在原卷上精準框選。所有資料留在本機。</p>
          <button className="button button-primary button-large" onClick={onImport} disabled={busy}>
            {busy ? '正在處理資料…' : '匯入 PDF 試卷'}
          </button>
          {message && <div className={`notice ${message.includes('失敗') ? 'notice-error' : ''}`}>{message}</div>}
        </div>
        <div className="hero-sheet" aria-hidden="true">
          <div className="sheet-header"><span>115</span><span>資訊安全規劃實務</span></div>
          {[1, 2, 3, 4].map((number) => (
            <div className="sheet-question" key={number}>
              <b>{String(number).padStart(2, '0')}</b>
              <div><i /><i /><i className="short" /></div>
            </div>
          ))}
          <div className="score-stamp">100<span>分</span></div>
        </div>
      </section>

      <section className="library-section">
        <div className="section-title">
          <div><span className="eyebrow">你的題庫</span><h2>{exams.length ? `${exams.length} 份試卷` : '尚未匯入試卷'}</h2></div>
          <div className="library-actions">
            {exams.length > 0 && <button className="button" onClick={onImport} disabled={busy}>＋ 匯入另一份</button>}
            <button className="button" onClick={onExportBackup} disabled={busy || exams.length === 0}>匯出完整備份</button>
            <button className="button" onClick={onImportBackup} disabled={busy}>匯入備份</button>
          </div>
        </div>
        {exams.length === 0 ? (
          <button className="empty-library" onClick={onImport}>
            <span className="empty-icon">PDF</span>
            <strong>從第一份公告試題開始</strong>
            <small>支援文字層 PDF、單選、複選、題組及附圖</small>
          </button>
        ) : (
          <div className="exam-grid">
            {exams.map((exam, index) => {
              const warnings = exam.questions.reduce((sum, question) => sum + (question.warningSkipped ? 0 : validateQuestion(question).length), 0)
              return (
                <article className="exam-card" key={exam.id} style={{ animationDelay: `${index * 70}ms` }}>
                  <div className="card-topline"><span className={`status ${exam.status}`}>{exam.status === 'published' ? '已發布' : '待校對'}</span><span>v{exam.version}</span></div>
                  <h3>{exam.title}</h3>
                  <p className="file-name">{exam.sourceFileName}</p>
                  <div className="exam-metrics"><span><b>{exam.questions.length}</b> 題</span><span><b>{examTotal(exam.questions)}</b> 分</span><span><b>{warnings}</b> 項待確認</span></div>
                  <div className="card-actions">
                    <button className="button button-primary" onClick={() => onOpen(exam, 'review')}>{exam.status === 'published' ? '檢視與編輯' : '繼續校對'}</button>
                    {exam.status === 'published' && <button className="button" onClick={() => onOpen(exam, 'take')}>開始作答</button>}
                    <button className="icon-button danger" title="刪除試卷" onClick={() => onDelete(exam)}>×</button>
                  </div>
                  {exam.status === 'published' && <button className="stats-link" onClick={() => onOpen(exam, 'stats')}>查看歷次成績與錯題統計 →</button>}
                </article>
              )
            })}
          </div>
        )}
      </section>
    </main>
  )
}

function ReviewPage({ exam, onChange, onBack, onTake }: { exam: Exam; onChange: (exam: Exam) => Promise<void>; onBack: () => void; onTake: () => void }) {
  const [activeIndex, setActiveIndex] = useState(0)
  const [reparsing, setReparsing] = useState(false)
  const question = exam.questions[activeIndex]
  const singlePoints = exam.singlePoints ?? 2
  const multiplePoints = exam.multiplePoints ?? 4
  const warnings = question ? validateQuestion(question) : []
  const questionWarnings = exam.questions.flatMap((item) => item.warningSkipped ? [] : validateQuestion(item).map((warning) => ({ number: item.number, warning })))
  const numberCounts = new Map<number, number>()
  exam.questions.forEach((item) => numberCounts.set(item.number, (numberCounts.get(item.number) ?? 0) + 1))
  const maxQuestionNumber = Math.max(0, ...exam.questions.map((item) => item.number))
  const missingNumbers = Array.from({ length: maxQuestionNumber }, (_, index) => index + 1).filter((number) => !numberCounts.has(number))
  const duplicateNumbers = [...numberCounts.entries()].filter(([, count]) => count > 1).map(([number]) => number)
  const structuralWarnings = [
    ...missingNumbers.map((number) => ({ number, warning: `缺少第 ${number} 題，請重新解析原 PDF` })),
    ...duplicateNumbers.map((number) => ({ number, warning: `第 ${number} 題重複，請重新解析原 PDF` })),
  ]
  const pendingStructuralWarnings = exam.structuralWarningsSkipped ? [] : structuralWarnings
  const allWarnings = [...pendingStructuralWarnings, ...questionWarnings]
  const skippedWarnings = exam.questions.reduce((sum, item) => sum + (item.warningSkipped ? validateQuestion(item).length : 0), 0)
    + (exam.structuralWarningsSkipped ? structuralWarnings.length : 0)

  async function patchQuestion(patch: Partial<Question>) {
    const questions = exam.questions.map((item, index) => index === activeIndex
      ? { ...item, ...patch, warningSkipped: 'warningSkipped' in patch ? patch.warningSkipped : false }
      : item)
    await onChange({ ...exam, status: 'draft', questions, updatedAt: new Date().toISOString() })
  }

  async function toggleStructuralWarnings() {
    await onChange({
      ...exam,
      status: 'draft',
      structuralWarningsSkipped: !exam.structuralWarningsSkipped,
      updatedAt: new Date().toISOString(),
    })
  }

  async function publish() {
    if (allWarnings.length) {
      window.alert(`仍有 ${allWarnings.length} 項需要確認，請先完成校對。`)
      return
    }
    const now = new Date().toISOString()
    await onChange({ ...exam, status: 'published', version: exam.version + 1, publishedAt: now, updatedAt: now })
  }

  async function applyPoints(type: QuestionType, value: number) {
    if (!Number.isFinite(value) || value <= 0) return
    const questions = exam.questions.map((item) => item.type === type ? { ...item, points: value } : item)
    await onChange({
      ...exam,
      status: 'draft',
      singlePoints: type === 'single' ? value : singlePoints,
      multiplePoints: type === 'multiple' ? value : multiplePoints,
      questions,
      updatedAt: new Date().toISOString(),
    })
  }

  async function reparseSourcePdf() {
    if (!window.confirm('系統會重新解析原始 PDF，補回缺少的題目並更新自動附圖；已完成校對的其他題目會盡量保留。確定繼續嗎？')) return
    setReparsing(true)
    try {
      const sourceFile = new File([exam.sourcePdf], exam.sourceFileName, { type: 'application/pdf' })
      const fresh = await parsePdf(sourceFile)
      const existingQuestions = new Map(exam.questions.map((item) => [item.number, item]))
      const missingSet = new Set(missingNumbers)
      const questions = fresh.questions.map((item) => {
        const existing = existingQuestions.get(item.number)
        const mustUseFreshText = !existing || missingSet.has(item.number) || missingSet.has(item.number + 1)
        if (mustUseFreshText) {
          return {
            ...item,
            id: existing?.id ?? item.id,
            points: item.type === 'single' ? singlePoints : multiplePoints,
            warningSkipped: false,
          }
        }
        return {
          ...existing,
          pageNumber: item.pageNumber,
          sourceRegions: item.sourceRegions,
          imageDataUrl: existing.imageDataUrl ?? item.imageDataUrl,
          imageAutoCropped: existing.imageDataUrl ? existing.imageAutoCropped : item.imageAutoCropped,
          points: existing.type === 'single' ? singlePoints : multiplePoints,
          parseWarnings: validateQuestion({ ...existing, imageDataUrl: existing.imageDataUrl ?? item.imageDataUrl }),
          warningSkipped: false,
        }
      })
      await onChange({
        ...fresh,
        id: exam.id,
        title: exam.title,
        createdAt: exam.createdAt,
        version: exam.version,
        singlePoints,
        multiplePoints,
        questions,
        status: 'draft',
        structuralWarningsSkipped: false,
        updatedAt: new Date().toISOString(),
      })
      setActiveIndex(0)
    } catch (reason) {
      window.alert(reason instanceof Error ? `重新解析失敗：${reason.message}` : '重新解析失敗。')
    } finally {
      setReparsing(false)
    }
  }

  function setType(type: QuestionType) {
    const answers = type === 'single' ? question.correctAnswers.slice(0, 1) : question.correctAnswers
    void patchQuestion({ type, correctAnswers: answers, points: type === 'single' ? singlePoints : multiplePoints })
  }

  function toggleCorrect(key: OptionKey) {
    const current = question.correctAnswers
    const next = question.type === 'single'
      ? [key]
      : current.includes(key) ? current.filter((item) => item !== key) : [...current, key]
    void patchQuestion({ correctAnswers: next })
  }

  if (!question) return <main className="centered-page"><div className="notice notice-error">這份 PDF 沒有解析到題目。</div><button className="button" onClick={onBack}>返回題庫</button></main>

  return (
    <main className="review-page">
      <div className="workspace-toolbar">
        <button className="back-link" onClick={onBack}>← 題庫</button>
        <div className="toolbar-title"><span className="eyebrow">校對工作區</span><strong>{exam.title}</strong></div>
        <div className="score-settings" aria-label="整份試卷配分">
          <label>單選每題<input type="number" min="0.5" step="0.5" value={singlePoints} onChange={(event) => void applyPoints('single', Number(event.target.value))} /></label>
          <label>複選每題<input type="number" min="0.5" step="0.5" value={multiplePoints} onChange={(event) => void applyPoints('multiple', Number(event.target.value))} /></label>
        </div>
        <div className="toolbar-summary"><span>{exam.questions.length} 題</span><span>{examTotal(exam.questions)} 分</span><span className={allWarnings.length ? 'has-warnings' : 'is-ready'}>{allWarnings.length ? `${allWarnings.length} 項待確認` : skippedWarnings ? `可以發布（已略過 ${skippedWarnings} 項）` : '可以發布'}</span></div>
        <button className="button" onClick={() => void reparseSourcePdf()} disabled={reparsing}>{reparsing ? '重新解析中…' : '重新解析原 PDF'}</button>
        <button className="button button-primary" onClick={publish} disabled={allWarnings.length > 0}>發布考試</button>
        {exam.status === 'published' && <button className="button" onClick={onTake}>開始作答</button>}
      </div>

      {structuralWarnings.length > 0 && (
        <div className={`structural-warning ${exam.structuralWarningsSkipped ? 'is-skipped' : ''}`} role="alert">
          <strong>{exam.structuralWarningsSkipped ? '已略過試卷結構警告' : '試卷結構尚未完整'}</strong>
          <span>{structuralWarnings.map((item) => item.warning).join('；')}</span>
          <button className="button button-small" onClick={() => void reparseSourcePdf()} disabled={reparsing}>重新解析並補回缺題</button>
          <button className="button button-small" onClick={() => void toggleStructuralWarnings()}>{exam.structuralWarningsSkipped ? '恢復阻擋發布' : '略過結構警告'}</button>
        </div>
      )}

      <div className="review-grid">
        <nav className="question-nav" aria-label="題號">
          <div className="nav-heading"><strong>題號</strong><small>點選進行校對</small></div>
          <div className="number-grid">
            {exam.questions.map((item, index) => {
              const count = validateQuestion(item).length
              const state = count ? item.warningSkipped ? 'skipped' : 'warning' : 'clean'
              return <button key={item.id} className={`${index === activeIndex ? 'active' : ''} ${state}`} onClick={() => setActiveIndex(index)}>{item.number}{count > 0 && <span />}</button>
            })}
          </div>
          <div className="legend"><span><i className="dot warning" /> 待確認</span><span><i className="dot skipped" /> 已略過</span><span><i className="dot clean" /> 已完成</span></div>
        </nav>

        <section className="editor-panel">
          <div className="question-heading">
            <div><span className="eyebrow">QUESTION</span><h2>第 {question.number} 題</h2></div>
            <span className="question-points">{question.type === 'single' ? '單選' : '複選'} · {question.points} 分</span>
          </div>

          {warnings.length > 0 && <div className={`warning-box ${question.warningSkipped ? 'is-skipped' : ''}`}>
            <strong>{question.warningSkipped ? '這題的待確認已略過' : '這題需要確認'}</strong>
            {warnings.map((warning) => <span key={warning}>• {warning}</span>)}
            <button className="button button-small" onClick={() => void patchQuestion({ warningSkipped: !question.warningSkipped })}>{question.warningSkipped ? '恢復阻擋發布' : '跳過此題待確認'}</button>
          </div>}

          <div className="segmented" aria-label="題型">
            <button className={question.type === 'single' ? 'active' : ''} onClick={() => setType('single')}>單選題</button>
            <button className={question.type === 'multiple' ? 'active' : ''} onClick={() => setType('multiple')}>複選題</button>
          </div>

          <label className="field-label">題組標記（選填）<input value={question.group ?? ''} onChange={(event) => void patchQuestion({ group: event.target.value || undefined })} placeholder="例如：【題組1】" /></label>
          <label className="field-label">題目<textarea rows={6} value={question.prompt} onChange={(event) => void patchQuestion({ prompt: event.target.value })} /></label>

          <div className="options-editor">
            <div className="options-title"><strong>選項與正確答案</strong><small>{question.type === 'single' ? '選擇一個正確答案' : '勾選所有正確答案'}</small></div>
            {optionKeys.map((key) => {
              const option = question.options.find((item) => item.key === key)
              return (
                <div className={`option-edit ${question.correctAnswers.includes(key) ? 'is-correct' : ''}`} key={key}>
                  <button className="answer-toggle" title={`設為正確答案 ${key}`} onClick={() => toggleCorrect(key)}>{question.correctAnswers.includes(key) ? '✓' : key}</button>
                  <textarea rows={2} value={option?.text ?? ''} placeholder={`選項 ${key} 文字`} onChange={(event) => {
                    const options = optionKeys.map((optionKey) => ({ key: optionKey, text: optionKey === key ? event.target.value : question.options.find((item) => item.key === optionKey)?.text ?? '' }))
                    void patchQuestion({ options })
                  }} />
                </div>
              )
            })}
          </div>

          {question.imageDataUrl && (
            <div className="attached-image"><div><strong>已附加圖像</strong><button className="text-button danger" onClick={() => void patchQuestion({ imageDataUrl: undefined })}>移除</button></div><img src={question.imageDataUrl} alt={`第 ${question.number} 題附圖`} /></div>
          )}
          <div className="editor-pagination">
            <button className="button" disabled={activeIndex === 0} onClick={() => setActiveIndex((index) => index - 1)}>← 上一題</button>
            <span>{activeIndex + 1} / {exam.questions.length}</span>
            <button className="button" disabled={activeIndex === exam.questions.length - 1} onClick={() => setActiveIndex((index) => index + 1)}>下一題 →</button>
          </div>
        </section>

        <PdfCropper pdf={exam.sourcePdf} pageNumber={question.pageNumber} onCrop={(imageDataUrl) => void patchQuestion({ imageDataUrl })} />
      </div>
    </main>
  )
}

function TakePage({ exam, onBack, onSubmit }: { exam: Exam; onBack: () => void; onSubmit: (attempt: Attempt) => void }) {
  const [answers, setAnswers] = useState<AnswerMap>({})
  const [loaded, setLoaded] = useState(false)
  useEffect(() => { void getDraft(exam.id).then((draft) => { setAnswers(draft?.answers ?? {}); setLoaded(true) }) }, [exam.id])
  useEffect(() => {
    if (!loaded) return
    const timer = window.setTimeout(() => void saveDraft({ examId: exam.id, answers, updatedAt: new Date().toISOString() }), 250)
    return () => window.clearTimeout(timer)
  }, [answers, exam.id, loaded])

  const answered = Object.values(answers).filter((values) => values.length).length
  const unanswered = exam.questions.length - answered

  function choose(question: Question, key: OptionKey) {
    setAnswers((current) => {
      const selected = current[question.id] ?? []
      const next = question.type === 'single' ? [key] : selected.includes(key) ? selected.filter((item) => item !== key) : [...selected, key]
      return { ...current, [question.id]: next }
    })
  }

  async function submit() {
    if (unanswered > 0 && !window.confirm(`還有 ${unanswered} 題未作答，仍要交卷嗎？`)) return
    if (unanswered === 0 && !window.confirm('確定送出答案並結束本次考試？')) return
    const attempt = scoreExam(exam, answers)
    await saveAttempt(attempt)
    await removeDraft(exam.id)
    onSubmit(attempt)
    window.scrollTo({ top: 0 })
  }

  return (
    <main className="exam-page">
      <section className="exam-cover">
        <button className="back-link" onClick={onBack}>← 離開考試</button>
        <span className="eyebrow">個人練習測驗</span>
        <h1>{exam.title}</h1>
        <div className="cover-meta"><span>{exam.questions.length} 題</span><span>滿分 {examTotal(exam.questions)} 分</span><span>第 {exam.version} 版</span></div>
      </section>
      <div className="exam-progress-sticky"><div><strong>{answered}</strong> / {exam.questions.length} 已作答</div><div className="progress-track"><i style={{ width: `${answered / exam.questions.length * 100}%` }} /></div><span>{unanswered ? `尚有 ${unanswered} 題` : '已全部完成'}</span></div>
      <div className="question-stack">
        {exam.questions.map((question) => (
          <fieldset className="question-card" key={question.id}>
            <legend><span>{String(question.number).padStart(2, '0')}</span><div>{question.group && <small>{question.group}</small>}<strong>{question.prompt}</strong></div><em>{question.points} 分</em></legend>
            {question.imageDataUrl && <img className="question-image" src={question.imageDataUrl} alt={`第 ${question.number} 題附圖`} />}
            <div className="answer-options">
              {question.options.map((option) => {
                const checked = (answers[question.id] ?? []).includes(option.key)
                return (
                  <label className={checked ? 'selected' : ''} key={option.key}>
                    <input type={question.type === 'single' ? 'radio' : 'checkbox'} name={question.id} checked={checked} onChange={() => choose(question, option.key)} />
                    <b>{option.key}</b><span>{option.text || `選項 ${option.key}（請參考附圖）`}</span>
                  </label>
                )
              })}
            </div>
          </fieldset>
        ))}
      </div>
      <section className="submit-panel"><div><span className="eyebrow">完成作答</span><strong>{unanswered ? `仍有 ${unanswered} 題未作答` : '所有題目都已填寫'}</strong><small>送出後會立即顯示分數與錯題。</small></div><button className="button button-primary button-large" onClick={() => void submit()}>送出答案</button></section>
    </main>
  )
}

function ResultPage({ attempt, onBack, onRetry, onStats }: { attempt: Attempt; onBack: () => void; onRetry: () => void; onStats: () => void }) {
  const wrong = attempt.results.filter((result) => !result.isCorrect)
  const correctCount = attempt.results.length - wrong.length
  const questionMap = new Map(attempt.examSnapshot.questions.map((question) => [question.id, question]))
  return (
    <main className="result-page">
      <section className="result-hero">
        <span className="eyebrow">作答完成 · {formatDate(attempt.submittedAt)}</span>
        <h1>{attempt.examSnapshot.title}</h1>
        <div className="score-orbit"><strong>{attempt.score}</strong><span>/ {attempt.total} 分</span></div>
        <div className="result-metrics"><span><b>{correctCount}</b> 答對</span><span><b>{wrong.length}</b> 答錯</span><span><b>{Math.round(attempt.score / attempt.total * 100)}%</b> 得分率</span></div>
        <div className="result-actions"><button className="button button-primary" onClick={onRetry}>再考一次</button><button className="button" onClick={onStats}>查看歷史統計</button><button className="button" onClick={onBack}>回到題庫</button></div>
      </section>
      <section className="review-results">
        <div className="section-title"><div><span className="eyebrow">錯題檢討</span><h2>{wrong.length ? `${wrong.length} 題需要再看一次` : '全部答對'}</h2></div></div>
        {wrong.length === 0 ? <div className="perfect-card">沒有錯題，這次表現非常完整。</div> : wrong.map((item) => {
          const question = questionMap.get(item.questionId)!
          return <article className="wrong-card" key={item.questionId}><div className="wrong-number">{String(item.number).padStart(2, '0')}</div><div><h3>{question.prompt}</h3>{question.imageDataUrl && <img className="question-image" src={question.imageDataUrl} alt="題目附圖" />}<div className="answer-compare"><span className="your-answer">你的答案 <b>{answerLabel([...item.selected])}</b></span><span className="correct-answer">正確答案 <b>{answerLabel([...item.correct])}</b></span><span>得分 <b>{item.earned} / {item.possible}</b></span></div></div></article>
        })}
      </section>
    </main>
  )
}

function StatsPage({ exam, onBack, onAttempt, onRetry }: { exam: Exam; onBack: () => void; onAttempt: (attempt: Attempt) => void; onRetry: () => void }) {
  const [attempts, setAttempts] = useState<Attempt[]>([])
  useEffect(() => { void listAttempts(exam.id).then(setAttempts) }, [exam.id])
  const average = attempts.length ? attempts.reduce((sum, item) => sum + item.score / item.total * 100, 0) / attempts.length : 0
  const stats = useMemo(() => exam.questions.map((question) => {
    const seen = attempts.filter((attempt) => attempt.results.some((result) => result.questionId === question.id))
    const wrong = seen.filter((attempt) => !attempt.results.find((result) => result.questionId === question.id)?.isCorrect).length
    return { question, attempts: seen.length, wrong, rate: seen.length ? wrong / seen.length : 0 }
  }).filter((item) => item.attempts > 0).sort((a, b) => b.rate - a.rate || b.wrong - a.wrong), [attempts, exam.questions])

  return (
    <main className="stats-page">
      <div className="workspace-toolbar"><button className="back-link" onClick={onBack}>← 題庫</button><div className="toolbar-title"><span className="eyebrow">個人成績</span><strong>{exam.title}</strong></div><button className="button button-primary" onClick={onRetry}>再考一次</button></div>
      <section className="stats-content">
        <div className="stat-cards"><article><span>作答次數</span><strong>{attempts.length}</strong><small>次完整交卷</small></article><article><span>平均得分率</span><strong>{Math.round(average)}%</strong><small>所有歷次成績</small></article><article><span>最高分</span><strong>{attempts.length ? Math.max(...attempts.map((item) => item.score)) : 0}</strong><small>目前個人紀錄</small></article></div>
        <div className="stats-columns">
          <section className="attempt-list"><div className="section-title"><div><span className="eyebrow">歷次成績</span><h2>作答紀錄</h2></div></div>{attempts.length === 0 ? <div className="empty-state">還沒有作答紀錄。</div> : attempts.map((attempt) => <button key={attempt.id} onClick={() => onAttempt(attempt)}><span>{formatDate(attempt.submittedAt)}</span><strong>{attempt.score}<small> / {attempt.total}</small></strong><em>查看 →</em></button>)}</section>
          <section className="mistake-table"><div className="section-title"><div><span className="eyebrow">容易答錯</span><h2>錯題排名</h2></div></div>{stats.length === 0 ? <div className="empty-state">完成考試後，這裡會累積各題錯誤率。</div> : <div className="table-wrap"><table><thead><tr><th>題號</th><th>題目</th><th>答錯</th><th>錯誤率</th></tr></thead><tbody>{stats.map(({ question, wrong, attempts: count, rate }) => <tr key={question.id}><td><b>{question.number}</b></td><td>{question.prompt}</td><td>{wrong} / {count}</td><td><span className="rate-bar"><i style={{ width: `${rate * 100}%` }} /></span><b>{Math.round(rate * 100)}%</b></td></tr>)}</tbody></table></div>}</section>
        </div>
      </section>
    </main>
  )
}

export default App
