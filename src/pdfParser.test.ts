import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { parseTextPages, referencesFigure, textContentToLines, type TextPage } from './pdfParser'

describe('PDF parser', () => {
  it('parses the supplied certification exam', async () => {
    const filePath = resolve('115-1公告試題_I21-5101 資訊安全規劃實務_20260423104227.pdf')
    const bytes = new Uint8Array(await readFile(filePath))
    const document = await getDocument({ data: bytes }).promise
    const pages: TextPage[] = []
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      const items = content.items.filter((item): item is never => 'str' in item)
      pages.push({ pageNumber, lines: textContentToLines(items) })
    }

    const exam = parseTextPages(pages, filePath)
    expect(exam.title).toBe('115-1 資訊安全規劃實務')
    expect(exam.pageCount).toBe(18)
    expect(exam.singlePoints).toBe(2)
    expect(exam.multiplePoints).toBe(4)
    expect(exam.questions).toHaveLength(40)
    expect(exam.questions.filter((question) => question.type === 'single')).toHaveLength(30)
    expect(exam.questions.filter((question) => question.type === 'multiple')).toHaveLength(10)
    expect(exam.questions.reduce((sum, question) => sum + question.points, 0)).toBe(100)
    expect(exam.questions[0].correctAnswers).toEqual(['C'])
    expect(exam.questions[1].options[3].text).not.toContain('PQC')
    expect(exam.questions[2].prompt).toContain('後量子密碼學')
    expect(exam.questions[3].correctAnswers).toEqual(['A', 'C', 'D'])
    expect(exam.questions[5].parseWarnings.length).toBeGreaterThan(0)
    expect(exam.questions[5].sourceRegions?.map((region) => region.pageNumber)).toEqual([3])
  }, 30_000)

  it('continues missing options on the next page', () => {
    const exam = parseTextPages([
      {
        pageNumber: 1,
        width: 595,
        height: 842,
        lines: [
          { text: 'A 1. 跨頁題目', y: 680 },
          { text: '(A) 第一項', y: 640 },
          { text: '(B) 第二項', y: 610 },
        ],
      },
      {
        pageNumber: 2,
        width: 595,
        height: 842,
        lines: [
          { text: '答案 題目', y: 706 },
          { text: '(C) 第三項', y: 680 },
          { text: '(D) 第四項', y: 650 },
          { text: 'B 2. 下一題', y: 600 },
          { text: '(A) 一', y: 560 },
          { text: '(B) 二', y: 530 },
          { text: '(C) 三', y: 500 },
          { text: '(D) 四', y: 470 },
        ],
      },
    ], '跨頁測試.pdf')

    expect(exam.questions).toHaveLength(2)
    expect(exam.questions[0].options.map((option) => option.text)).toEqual(['第一項', '第二項', '第三項', '第四項'])
    expect(exam.questions[0].sourceRegions?.map((region) => region.pageNumber)).toEqual([1, 2])
  })

  it('splits a question header stuck to the prior option and removes watermark text', () => {
    const exam = parseTextPages([{
      pageNumber: 1,
      lines: [
        { text: 'A 1. 第一題', y: 760 },
        { text: '(A) 一', y: 740 }, { text: '(B) 二', y: 720 }, { text: '(C) 三', y: 700 }, { text: '(D) 四', y: 680 },
        { text: 'B 2. 第二題', y: 640 },
        { text: '(A) 甲', y: 620 }, { text: '(B) 乙', y: 600 }, { text: '(C) 丙', y: 580 },
        { text: '(D) 丁 C 智慧創新人才能力鑑定 3. 第三題', y: 560 },
        { text: '(A) 壹', y: 540 }, { text: '(B) 貳', y: 520 }, { text: '(C) 參', y: 500 }, { text: '(D) 肆', y: 480 },
      ],
    }], '黏連測試.pdf')

    expect(exam.questions).toHaveLength(3)
    expect(exam.questions[1].options[3].text).toBe('丁')
    expect(exam.questions[2].prompt).toBe('第三題')
    expect(JSON.stringify(exam.questions)).not.toContain('iPAS')
  })

  it('recognizes a question number separated from its answer by watermark text', () => {
    const exam = parseTextPages([{
      pageNumber: 1,
      lines: [
        { text: 'A 1. 第一題', y: 760 },
        { text: '(A) 一', y: 740 }, { text: '(B) 二', y: 720 }, { text: '(C) 三', y: 700 }, { text: '(D) 四', y: 680 },
        { text: 'B 2. 第二題', y: 640 },
        { text: '(A) 甲', y: 620 }, { text: '(B) 乙', y: 600 }, { text: '(C) 丙', y: 580 }, { text: '(D) 丁', y: 560 },
        { text: 'A iPAS 3. 第三題', y: 520 },
        { text: '(A) 壹', y: 500 }, { text: '(B) 貳', y: 480 }, { text: '(C) 參', y: 460 }, { text: '(D) 肆', y: 440 },
      ],
    }], '浮水印題首測試.pdf')

    expect(exam.questions).toHaveLength(3)
    expect(exam.questions[1].options[3].text).toBe('丁')
    expect(exam.questions[2].number).toBe(3)
    expect(exam.questions[2].prompt).toBe('第三題')
  })

  it('removes large diagonal watermark objects before rebuilding text rows', () => {
    const horizontal = (str: string, x: number, y: number, width = 60) => ({
      str,
      width,
      transform: [12, 0, 0, 12, x, y],
    })
    const diagonalWatermark = (str: string, x: number, y: number) => ({
      str,
      width: 40,
      transform: [34, 22, -22, 34, x, y],
    })
    const lines = textContentToLines([
      horizontal('(D) 可靠性衝擊', 90, 560, 105),
      diagonalWatermark('i', 202, 560),
      diagonalWatermark('P', 212, 560),
      horizontal('A', 225, 560, 8),
      diagonalWatermark('A', 236, 560),
      diagonalWatermark('S', 246, 560),
      horizontal('3. 第三題', 260, 560, 100),
    ])

    expect(lines).toHaveLength(1)
    expect(lines[0].text).toContain('(D) 可靠性衝擊')
    expect(lines[0].text).toContain('A 3. 第三題')
    expect(lines[0].text).not.toContain('iPAS')
  })

  it('recognizes common figure references', () => {
    expect(referencesFigure('依據下圖所示之結果')).toBe(true)
    expect(referencesFigure('情境如附圖所示')).toBe(true)
    expect(referencesFigure('一般文字題目')).toBe(false)
  })
})
