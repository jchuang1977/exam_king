import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { Exam, OptionKey, Question, QuestionOption, SourceRegion } from './types'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

type TextItemLike = {
  str: string
  width: number
  transform: number[]
}

export interface TextLine {
  text: string
  y: number
  answerText?: string
}

export interface TextPage {
  pageNumber: number
  lines: TextLine[]
  width?: number
  height?: number
}

const optionKeys: OptionKey[] = ['A', 'B', 'C', 'D']
const questionColumnLeft = 0.155
const questionColumnRight = 0.965
const fallbackAnswerColumnMaxX = 65
const repeatedLinePatterns = [
  /^\s*115\s*年第一次資訊安全工程師.*公告試題.*$/,
  /^\s*\d{3}\s*年度第\s*\d+\s*次\s+資訊安全工程師能力鑑定\s*(?:初|中|高)級試題\s*$/u,
  /^\s*科目[：:].*卷號[：:].*$/u,
  /^\s*資訊安全規劃實務\s*$/,
  /^\s*第一科[：:]?\s*$/,
  /^\s*第一科[：:].*資訊安全規劃實務\s*$/,
  /^\s*考試日期[：:].*$/,
  /^\s*答案\s*題目\s*$/,
  /^\s*第\s*\d+\s*頁[，,]\s*共\s*\d+\s*頁\s*$/,
  /^\s*《以下空白》\s*$/,
]

const inlineCertificationHeaderPattern = /(?:^|\s)(?:\d{1,3}\s+)?\d{3}\s*年度第\s*\d+\s*次\s+資訊安全工程師能力鑑定\s*(?:初|中|高)級試題\s*科目[：:][^\n]*?\s+卷號[：:]\s*[A-Z0-9-]+(?:\s+[A-D](?=\s*\([A-D]\)))?/gu
const leadingSubjectHeaderPattern = /^\s*科目[：:][^\n]*?\s+卷號[：:]\s*[A-Z0-9-]+(?:\s+[A-D](?=\s*\([A-D]\)))?\s*/u
const certificationHeaderArtifactPattern = /\d{3}\s*年度第\s*\d+\s*次\s+資訊安全工程師能力鑑定\s*(?:初|中|高)級試題|科目[：:][^\n]*卷號[：:]/u

export function containsPageHeaderArtifact(text: string): boolean {
  return certificationHeaderArtifactPattern.test(cleanLine(text))
}

function removePageHeaderText(text: string): string {
  return cleanLine(text)
    .replace(inlineCertificationHeaderPattern, ' ')
    .replace(leadingSubjectHeaderPattern, '')
    .replace(/^\s*[A-D]\s+(?=\([A-D]\)\s*)/u, '')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

function removeWatermarkText(text: string): string {
  return text
    .replace(/i\s*P\s*A\s*S/gi, ' ')
    .replace(/智慧創新人才能力鑑定/gu, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

function cleanLine(text: string): string {
  return text
    .replace(/[Ａ-Ｄ]/gu, (letter) => letter.normalize('NFKC'))
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

function isLikelyWatermarkItem(item: TextItemLike): boolean {
  const [scaleX = 0, skewY = 0] = item.transform
  const fontSize = Math.hypot(scaleX, skewY)
  const rawAngle = Math.abs(Math.atan2(skewY, scaleX) * 180 / Math.PI)
  const angle = Math.min(rawAngle, Math.abs(180 - rawAngle))
  const isLargeAndRotated = fontSize >= 16 && angle >= 8
  const isNamedWatermark = /(i\s*P\s*A\s*S|智慧創新人才能力鑑定)/iu.test(item.str)
  return isLargeAndRotated || (isNamedWatermark && (fontSize >= 16 || angle >= 8))
}

function compactText(text: string): string {
  return removeWatermarkText(text)
    .split('\n')
    .map(cleanLine)
    .filter(Boolean)
    .join(' ')
    .replace(/\s+([，。；：？！、）])/g, '$1')
    .replace(/（\s+/g, '（')
    .trim()
}

function hasCompleteOptionSet(text: string): boolean {
  return optionKeys.every((key) => new RegExp(`^\\s*\\(${key}\\)`, 'm').test(text))
}

export function referencesFigure(text: string): boolean {
  return /(附圖|下圖|如下圖|如圖|圖示|圖中|圖所示)/u.test(text)
}

export function textContentToLines(items: TextItemLike[]): TextLine[] {
  const usable = items
    .filter((item) => item.str.trim() && !isLikelyWatermarkItem(item))
    .map((item) => ({
      text: item.str,
      x: item.transform[4] ?? 0,
      y: item.transform[5] ?? 0,
      width: item.width ?? 0,
    }))
    .sort((a, b) => Math.abs(b.y - a.y) > 4 ? b.y - a.y : a.x - b.x)

  const questionAnchorXs = usable
    .filter((item) => /^(?:\d{1,3}[.．]|\([A-D]\))/u.test(cleanLine(item.text)))
    .map((item) => item.x)
    .sort((a, b) => a - b)
  const questionColumnStartX = questionAnchorXs.length
    ? questionAnchorXs[Math.floor(questionAnchorXs.length / 2)]
    : fallbackAnswerColumnMaxX + 4
  const answerColumnMaxX = questionColumnStartX - 4

  const rows: Array<{ y: number; items: typeof usable }> = []
  for (const item of usable) {
    const row = rows.find((candidate) => Math.abs(candidate.y - item.y) <= 4)
    if (row) row.items.push(item)
    else rows.push({ y: item.y, items: [item] })
  }

  return rows
    .sort((a, b) => b.y - a.y)
    .map((row) => {
      const sorted = row.items.sort((a, b) => a.x - b.x)
      const isAnswerColumnItem = (item: typeof sorted[number]) => {
        const text = cleanLine(item.text)
        return item.x <= answerColumnMaxX && /^(?:(?:[A-D]\s*){1,4}|或)$/u.test(text)
      }
      const answerText = sorted
        .filter(isAnswerColumnItem)
        .map((item) => cleanLine(item.text))
        .join(' ')
      const contentItems = sorted.filter((item) => !isAnswerColumnItem(item))
      let text = ''
      let endX = 0
      contentItems.forEach((item, index) => {
        const gap = item.x - endX
        const needsSpace = index > 0 && gap > Math.max(2, item.width / Math.max(item.text.length, 1) * 0.35)
        text += `${needsSpace ? ' ' : ''}${item.text}`
        endX = item.x + item.width
      })
      return { text: cleanLine(text), y: row.y, answerText: answerText || undefined }
    })
}

function parseTitle(fileName: string, firstPage: TextPage): string {
  const explicit = firstPage.lines
    .map((line) => cleanLine(line.text))
    .find((line) => /資訊安全.*實務/.test(line) && !/工程師|公告試題/.test(line))
  if (explicit) {
    const prefix = fileName.match(/(?:^|[\\/])(\d{3}-\d)/)?.[1] ?? fileName.match(/^(\d{3}-\d)/)?.[1]
    const cleanTitle = explicit.replace(/^第一科[：:]?\s*/, '')
    return prefix ? `${prefix} ${cleanTitle}` : cleanTitle
  }
  return fileName
    .replace(/\.pdf$/i, '')
    .replace(/^\d{3}-\d公告試題_[^ ]+\s*/, '')
    .replace(/_\d{14}$/, '')
}

function parseQuestionChunk(raw: string, answerText: string, number: number, pageNumber: number, sourceRegions: SourceRegion[]): Question {
  const optionMatches = [...raw.matchAll(/^\s*\(([A-D])\)\s*/gm)]
  const promptEnd = optionMatches[0]?.index ?? raw.length
  const prompt = compactText(raw.slice(0, promptEnd))
  const options: QuestionOption[] = optionMatches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length
    const end = optionMatches[index + 1]?.index ?? raw.length
    return { key: match[1] as OptionKey, text: compactText(raw.slice(start, end)) }
  })
  const correctAnswers = [...answerText] as OptionKey[]
  const type = correctAnswers.length > 1 || /[（(]複選[）)]/.test(prompt) ? 'multiple' : 'single'
  const group = prompt.match(/【\s*題組\s*\d+\s*】/)?.[0].replace(/\s+/g, '')
  const question: Question = {
    id: crypto.randomUUID(),
    number,
    group,
    type,
    prompt,
    options,
    correctAnswers,
    points: type === 'multiple' ? 4 : 2,
    pageNumber,
    sourceRegions,
    parseWarnings: [],
  }
  question.parseWarnings = validateQuestion(question)
  return question
}

export function validateQuestion(question: Question): string[] {
  const warnings: string[] = []
  if (!question.prompt.trim()) warnings.push('缺少題目文字')
  if (question.options.length !== 4 || optionKeys.some((key) => !question.options.some((option) => option.key === key))) {
    warnings.push('選項不完整，請參考 PDF 原頁補正')
  } else if (question.options.some((option) => !option.text.trim()) && !question.imageDataUrl) {
    warnings.push('選項含圖像或空白內容，請裁切原頁附加至題目')
  }
  if (!question.correctAnswers.length) warnings.push('尚未設定正確答案')
  if (question.type === 'single' && question.correctAnswers.length !== 1) warnings.push('單選題只能有一個正確答案')
  if (question.type === 'multiple' && question.correctAnswers.length < 2) warnings.push('複選題應有至少兩個正確答案')
  if (question.correctAnswers.some((answer) => !optionKeys.includes(answer))) warnings.push('答案包含無效選項')
  if (referencesFigure(question.prompt) && !question.imageDataUrl) warnings.push('題目提及附圖，請確認並裁切需要的圖像')
  if (!Number.isFinite(question.points) || question.points <= 0) warnings.push('配分必須大於 0')
  return warnings
}

export function parseTextPages(pages: TextPage[], fileName: string): Omit<Exam, 'sourcePdf'> {
  const starts: Array<{
    answer: string
    number: number
    pageNumber: number
    startY: number
    content: string
    contentPages: Set<number>
    awaitingAlternativeAnswer?: boolean
    ignoringAlternativeAnswerColumn?: boolean
  }> = []
  let current: typeof starts[number] | undefined
  for (const page of pages) {
    const lines = page.lines
      .map((line) => ({ ...line, text: removePageHeaderText(line.text) }))
      .filter((line) => (line.text || line.answerText) && !repeatedLinePatterns.some((pattern) => pattern.test(line.text)))
    for (const sourceLine of lines) {
      const line = cleanLine(sourceLine.text)
      const expectedNumber = starts.length + 1
      const detectionLine = removeWatermarkText(line)
      const answerColumnText = cleanLine(sourceLine.answerText ?? '')
      const questionNumberInContent = detectionLine.match(new RegExp(`(^|\\s)(${expectedNumber}[.．]\\s*)`))
      const primaryAnswerColumnText = answerColumnText.split('或', 1)[0]
      const primaryColumnAnswers = primaryAnswerColumnText.match(/[A-D]/g)?.join('') ?? ''
      let detectionLineWithAnswer = detectionLine
      if (questionNumberInContent && primaryColumnAnswers) {
        const insertionIndex = (questionNumberInContent.index ?? 0) + questionNumberInContent[1].length
        detectionLineWithAnswer = `${detectionLine.slice(0, insertionIndex)}${primaryColumnAnswers} ${detectionLine.slice(insertionIndex)}`
      }

      if (current && answerColumnText && !questionNumberInContent) {
        if (!current.ignoringAlternativeAnswerColumn) {
          for (const answer of primaryColumnAnswers) {
            if (!current.answer.includes(answer)) current.answer += answer
          }
        }
        if (answerColumnText.includes('或')) current.ignoringAlternativeAnswerColumn = true
        if (!detectionLine) continue
      }
      if (current && !/^\s*\(A\)\s*/m.test(current.content)) {
        if (detectionLine === '或') {
          current.awaitingAlternativeAnswer = true
          continue
        }
        const alternativeAnswerMatch = detectionLine.match(/^或\s*([A-D])$/u)
          ?? (current.awaitingAlternativeAnswer ? detectionLine.match(/^([A-D])$/u) : null)
        if (alternativeAnswerMatch) {
          const answer = alternativeAnswerMatch[1]
          if (!current.answer.includes(answer)) current.answer += answer
          current.awaitingAlternativeAnswer = false
          continue
        }
      }
      if (current) current.awaitingAlternativeAnswer = false
      const strictStartMatch = detectionLineWithAnswer.match(/^([A-D]{1,4})\s+(\d{1,3})[.．]\s*(.*)$/)
      const tolerantStartPattern = new RegExp(`^([A-D]{1,4})\\b.{0,24}?\\b(${expectedNumber})[.．]\\s*(.*)$`)
      const tolerantStartMatch = strictStartMatch ? null : detectionLineWithAnswer.match(tolerantStartPattern)
      const answerStartMatch = strictStartMatch ?? tolerantStartMatch
      const embeddedPattern = new RegExp(`\\s([A-D]{1,4})\\b.{0,24}?\\b(${expectedNumber})[.．]\\s*`)
      const embeddedAnswerMatch = answerStartMatch ? null : detectionLineWithAnswer.match(embeddedPattern)
      const canStartWithoutAnswer = Boolean(current && hasCompleteOptionSet(current.content))
      const bareStartPattern = new RegExp(`^(${expectedNumber})[.．]\\s+(.+)$`)
      const bareStartMatch = answerStartMatch || embeddedAnswerMatch || !canStartWithoutAnswer
        ? null
        : detectionLine.match(bareStartPattern)
      const embeddedBarePattern = new RegExp(`\\s(${expectedNumber})[.．]\\s+(.+)$`)
      const embeddedBareCandidate = answerStartMatch || embeddedAnswerMatch || bareStartMatch
        ? null
        : detectionLine.match(embeddedBarePattern)
      const embeddedBarePrefix = embeddedBareCandidate
        ? detectionLine.slice(0, embeddedBareCandidate.index).trim()
        : ''
      const embeddedBareMatch = embeddedBareCandidate && current
        && /^\s*\(D\)\s*\S/u.test(embeddedBarePrefix)
        && hasCompleteOptionSet(`${current.content}\n${embeddedBarePrefix}`)
        ? embeddedBareCandidate
        : null

      if (answerStartMatch || embeddedAnswerMatch || bareStartMatch || embeddedBareMatch) {
        const embeddedMatch = embeddedAnswerMatch ?? embeddedBareMatch
        if (embeddedMatch && current) {
          const before = detectionLine.slice(0, embeddedMatch.index).trim()
          if (before) {
            current.content += `\n${before}`
            current.contentPages.add(page.pageNumber)
          }
        }
        const answer = answerStartMatch?.[1] ?? embeddedAnswerMatch?.[1] ?? ''
        const number = Number(answerStartMatch?.[2] ?? embeddedAnswerMatch?.[2] ?? bareStartMatch?.[1] ?? embeddedBareMatch?.[1])
        const content = answerStartMatch?.[3]
          ?? (embeddedAnswerMatch ? detectionLine.slice((embeddedAnswerMatch.index ?? 0) + embeddedAnswerMatch[0].length) : undefined)
          ?? bareStartMatch?.[2]
          ?? embeddedBareMatch?.[2]
          ?? ''
        current = {
          answer,
          number,
          pageNumber: page.pageNumber,
          startY: sourceLine.y,
          content,
          contentPages: new Set([page.pageNumber]),
          ignoringAlternativeAnswerColumn: answerColumnText.includes('或'),
        }
        starts.push(current)
      } else if (current) {
        current.content += `\n${line}`
        current.contentPages.add(page.pageNumber)
      }
    }
  }

  const pageMap = new Map(pages.map((page) => [page.pageNumber, page]))
  const questions = starts.map((item, index) => {
    const next = starts[index + 1]
    const regions = [...item.contentPages].sort((a, b) => a - b).map((pageNumber): SourceRegion => {
      const page = pageMap.get(pageNumber)
      const width = page?.width ?? 595
      const height = page?.height ?? 842
      const top = pageNumber === item.pageNumber
        ? Math.max(0.1, (height - item.startY - 48) / height)
        : 0.145
      const bottom = next?.pageNumber === pageNumber
        ? Math.min(0.9, (height - next.startY - 48) / height)
        : 0.87
      return {
        pageNumber,
        left: questionColumnLeft,
        top,
        width: Math.min(questionColumnRight - questionColumnLeft, (width - width * questionColumnLeft) / width),
        height: Math.max(0.04, bottom - top),
      }
    })
    return parseQuestionChunk(item.content, item.answer, item.number, item.pageNumber, regions)
  })
  questions.forEach((question, index) => {
    const expected = index + 1
    if (question.number !== expected) question.parseWarnings.push(`題號不連續：預期 ${expected}，實際 ${question.number}`)
  })

  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    title: parseTitle(fileName, pages[0] ?? { pageNumber: 1, lines: [] }),
    sourceFileName: fileName,
    pageCount: pages.length,
    singlePoints: 2,
    multiplePoints: 4,
    status: 'draft',
    version: 0,
    questions,
    createdAt: now,
    updatedAt: now,
  }
}

function findHorizontalBorder(canvas: HTMLCanvasElement, expectedY: number, left: number, right: number): number {
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return expectedY
  const startY = Math.max(0, Math.round(expectedY - 70))
  const endY = Math.min(canvas.height - 1, Math.round(expectedY + 70))
  const startX = Math.max(0, Math.round(left))
  const endX = Math.min(canvas.width - 1, Math.round(right))
  const scanWidth = Math.max(1, endX - startX)
  const scanHeight = Math.max(1, endY - startY + 1)
  const pixels = context.getImageData(startX, startY, scanWidth, scanHeight).data
  let bestY = expectedY
  let bestRatio = 0
  for (let row = 0; row < scanHeight; row += 1) {
    let dark = 0
    const rowOffset = row * scanWidth * 4
    for (let x = 0; x < scanWidth; x += 4) {
      const offset = rowOffset + x * 4
      if (pixels[offset] < 90 && pixels[offset + 1] < 90 && pixels[offset + 2] < 90) dark += 1
    }
    const ratio = dark / Math.ceil(scanWidth / 4)
    if (ratio > bestRatio) {
      bestRatio = ratio
      bestY = startY + row
    }
  }
  return bestRatio > 0.35 ? bestY : expectedY
}

export function selectQuestionColumnBorders(
  verticalLines: number[],
  pageWidth: number,
  fallbackLeft: number,
  fallbackRight: number,
): { left: number; right: number } {
  const lines = [...verticalLines]
    .filter((x) => x >= pageWidth * 0.03 && x <= pageWidth * 0.985)
    .sort((a, b) => a - b)
  const leftSideLines = lines.filter((x) => x < pageWidth * 0.45)
  const rightSideLines = lines.filter((x) => x > pageWidth * 0.55)
  const left = leftSideLines.length >= 2 ? leftSideLines[1] : fallbackLeft
  const right = rightSideLines.at(-1) ?? fallbackRight
  return right - left >= pageWidth * 0.45
    ? { left, right }
    : { left: fallbackLeft, right: fallbackRight }
}

function findQuestionColumnBorders(
  canvas: HTMLCanvasElement,
  top: number,
  bottom: number,
  fallbackLeft: number,
  fallbackRight: number,
): { left: number; right: number } {
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return { left: fallbackLeft, right: fallbackRight }
  const startX = Math.max(0, Math.round(canvas.width * 0.03))
  const endX = Math.min(canvas.width - 1, Math.round(canvas.width * 0.985))
  const startY = Math.max(0, Math.round(top))
  const endY = Math.min(canvas.height - 1, Math.round(bottom))
  const scanWidth = Math.max(1, endX - startX + 1)
  const scanHeight = Math.max(1, endY - startY)
  const pixels = context.getImageData(startX, startY, scanWidth, scanHeight).data
  const candidates: Array<{ x: number; ratio: number }> = []
  for (let column = 0; column < scanWidth; column += 1) {
    let dark = 0
    let samples = 0
    for (let y = 0; y < scanHeight; y += 4) {
      const offset = (y * scanWidth + column) * 4
      if (pixels[offset] < 90 && pixels[offset + 1] < 90 && pixels[offset + 2] < 90) dark += 1
      samples += 1
    }
    const ratio = dark / Math.max(1, samples)
    if (ratio >= 0.45) candidates.push({ x: startX + column, ratio })
  }

  const grouped: Array<Array<{ x: number; ratio: number }>> = []
  for (const candidate of candidates) {
    const group = grouped.at(-1)
    if (group && candidate.x - group.at(-1)!.x <= 2) group.push(candidate)
    else grouped.push([candidate])
  }
  const verticalLines = grouped.map((group) => group.reduce((best, candidate) => candidate.ratio > best.ratio ? candidate : best).x)
  return selectQuestionColumnBorders(verticalLines, canvas.width, fallbackLeft, fallbackRight)
}

async function createQuestionCrop(
  pdfDocument: Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']>,
  regions: SourceRegion[],
  pageCache: Map<number, HTMLCanvasElement>,
): Promise<string> {
  const pieces: HTMLCanvasElement[] = []
  for (const region of regions) {
    let fullPage = pageCache.get(region.pageNumber)
    if (!fullPage) {
      const page = await pdfDocument.getPage(region.pageNumber)
      const viewport = page.getViewport({ scale: 1.55 })
      fullPage = document.createElement('canvas')
      fullPage.width = Math.ceil(viewport.width)
      fullPage.height = Math.ceil(viewport.height)
      const context = fullPage.getContext('2d')
      if (!context) throw new Error('無法建立題目裁切畫布')
      await page.render({ canvas: fullPage, canvasContext: context, viewport }).promise
      pageCache.set(region.pageNumber, fullPage)
    }
    const expectedLeft = region.left * fullPage.width
    const expectedRight = (region.left + region.width) * fullPage.width
    const expectedTop = region.top * fullPage.height
    const expectedBottom = (region.top + region.height) * fullPage.height
    const broadLeft = fullPage.width * 0.03
    const broadRight = fullPage.width * 0.985
    const top = Math.max(0, Math.round(findHorizontalBorder(fullPage, expectedTop, broadLeft, broadRight) - 2))
    const bottom = Math.min(fullPage.height, Math.round(findHorizontalBorder(fullPage, expectedBottom, broadLeft, broadRight) + 2))
    const borders = findQuestionColumnBorders(fullPage, top, bottom, expectedLeft, expectedRight)
    const left = Math.max(0, Math.round(borders.left + 1))
    const right = Math.min(fullPage.width, Math.round(borders.right + 2))
    const piece = document.createElement('canvas')
    piece.width = Math.max(1, right - left)
    piece.height = Math.max(1, bottom - top)
    piece.getContext('2d')?.drawImage(fullPage, left, top, piece.width, piece.height, 0, 0, piece.width, piece.height)
    pieces.push(piece)
  }

  const gap = pieces.length > 1 ? 8 : 0
  const output = document.createElement('canvas')
  output.width = Math.max(...pieces.map((piece) => piece.width))
  output.height = pieces.reduce((sum, piece) => sum + piece.height, 0) + gap * (pieces.length - 1)
  const context = output.getContext('2d')
  if (!context) throw new Error('無法合併跨頁題目圖像')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, output.width, output.height)
  let y = 0
  for (const piece of pieces) {
    context.drawImage(piece, 0, y)
    y += piece.height + gap
  }
  return output.toDataURL('image/jpeg', 0.9)
}

export async function parsePdf(file: File): Promise<Exam> {
  const data = new Uint8Array(await file.arrayBuffer())
  const document = await pdfjsLib.getDocument({ data }).promise
  const pages: TextPage[] = []
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber)
    const content = await page.getTextContent()
    const viewport = page.getViewport({ scale: 1 })
    pages.push({
      pageNumber,
      lines: textContentToLines(content.items.filter((item) => 'str' in item) as unknown as TextItemLike[]),
      width: viewport.width,
      height: viewport.height,
    })
  }
  const parsed = parseTextPages(pages, file.name)
  const pageCache = new Map<number, HTMLCanvasElement>()
  for (const question of parsed.questions) {
    const shouldAutoCrop = referencesFigure(question.prompt)
      || question.options.length < 4
      || question.options.some((option) => !option.text.trim())
    if (shouldAutoCrop && question.sourceRegions?.length) {
      question.imageDataUrl = await createQuestionCrop(document, question.sourceRegions, pageCache)
      question.imageAutoCropped = true
      question.parseWarnings = validateQuestion(question)
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    }
  }
  return { ...parsed, sourcePdf: file }
}
