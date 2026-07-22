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
}

export interface TextPage {
  pageNumber: number
  lines: TextLine[]
  width?: number
  height?: number
}

const optionKeys: OptionKey[] = ['A', 'B', 'C', 'D']
const repeatedLinePatterns = [
  /^\s*115\s*年第一次資訊安全工程師.*公告試題.*$/,
  /^\s*資訊安全規劃實務\s*$/,
  /^\s*第一科[：:]?\s*$/,
  /^\s*第一科[：:].*資訊安全規劃實務\s*$/,
  /^\s*考試日期[：:].*$/,
  /^\s*答案\s*題目\s*$/,
  /^\s*第\s*\d+\s*頁[，,]\s*共\s*\d+\s*頁\s*$/,
  /^\s*《以下空白》\s*$/,
]

function removeWatermarkText(text: string): string {
  return text
    .replace(/i\s*P\s*A\s*S/gi, ' ')
    .replace(/智慧創新人才能力鑑定/gu, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

function cleanLine(text: string): string {
  return text.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim()
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
      let text = ''
      let endX = 0
      sorted.forEach((item, index) => {
        const gap = item.x - endX
        const needsSpace = index > 0 && gap > Math.max(2, item.width / Math.max(item.text.length, 1) * 0.35)
        text += `${needsSpace ? ' ' : ''}${item.text}`
        endX = item.x + item.width
      })
      return { text: cleanLine(text), y: row.y }
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
  }> = []
  let current: typeof starts[number] | undefined
  for (const page of pages) {
    const lines = page.lines.filter((line) => {
      const text = cleanLine(line.text)
      return text && !repeatedLinePatterns.some((pattern) => pattern.test(text))
    })
    for (const sourceLine of lines) {
      const line = cleanLine(sourceLine.text)
      const expectedNumber = starts.length + 1
      const detectionLine = removeWatermarkText(line)
      const strictStartMatch = detectionLine.match(/^([A-D]{1,4})\s+(\d{1,3})[.．]\s*(.*)$/)
      const tolerantStartPattern = new RegExp(`^([A-D]{1,4})\\b.{0,24}?\\b(${expectedNumber})[.．]\\s*(.*)$`)
      const tolerantStartMatch = strictStartMatch ? null : detectionLine.match(tolerantStartPattern)
      const startMatch = strictStartMatch ?? tolerantStartMatch
      const embeddedPattern = new RegExp(`\\s([A-D]{1,4})\\b.{0,24}?\\b(${expectedNumber})[.．]\\s*`)
      const embeddedMatch = startMatch ? null : detectionLine.match(embeddedPattern)
      const match = startMatch ?? embeddedMatch
      if (match) {
        if (embeddedMatch && current) {
          const before = detectionLine.slice(0, embeddedMatch.index).trim()
          if (before) {
            current.content += `\n${before}`
            current.contentPages.add(page.pageNumber)
          }
        }
        current = {
          answer: match[1],
          number: Number(match[2]),
          pageNumber: page.pageNumber,
          startY: sourceLine.y,
          content: startMatch ? match[3] : detectionLine.slice((embeddedMatch!.index ?? 0) + embeddedMatch![0].length),
          contentPages: new Set([page.pageNumber]),
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
        left: 0.145,
        top,
        width: Math.min(0.81, (width - width * 0.145) / width),
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
    const left = Math.round(region.left * fullPage.width)
    const right = Math.round((region.left + region.width) * fullPage.width)
    const expectedTop = region.top * fullPage.height
    const expectedBottom = (region.top + region.height) * fullPage.height
    const top = Math.max(0, Math.round(findHorizontalBorder(fullPage, expectedTop, left, right) - 2))
    const bottom = Math.min(fullPage.height, Math.round(findHorizontalBorder(fullPage, expectedBottom, left, right) + 2))
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
