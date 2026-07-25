import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { containsPageHeaderArtifact, parseTextPages, referencesFigure, selectQuestionColumnBorders, textContentToLines, type TextPage } from './pdfParser'

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
    expect(exam.questions[0].sourceRegions?.every((region) => region.left >= 0.155)).toBe(true)
    expect(exam.questions[0].sourceRegions?.every((region) => region.left + region.width <= 0.965)).toBe(true)
  })

  it('splits an answerless next question stuck to option D', () => {
    const exam = parseTextPages([{
      pageNumber: 1,
      width: 595,
      height: 842,
      lines: [
        { text: 'C 1. 第一題', y: 760 },
        { text: '(A) SOC1', y: 730 },
        { text: '(B) SOC2', y: 700 },
        { text: '(C) SOC3', y: 670 },
        { text: '(D) SOC1及 SOC2 2. 智慧型物聯網設備應遵循何項法案？', y: 640 },
        { text: '(A) NIS2 Directive', y: 610 },
        { text: '(B) Cybersecurity Resilience Act', y: 580 },
        { text: '(C) NIS Directive', y: 550 },
        { text: '(D) Cybersecurity Act', y: 520 },
        { text: 'B 3. 第三題', y: 480 },
        { text: '(A) 一', y: 450 }, { text: '(B) 二', y: 420 }, { text: '(C) 三', y: 390 }, { text: '(D) 四', y: 360 },
      ],
    }], '無答案欄題首測試.pdf')

    expect(exam.questions).toHaveLength(3)
    expect(exam.questions[0].options[3].text).toBe('SOC1及 SOC2')
    expect(exam.questions[1].number).toBe(2)
    expect(exam.questions[1].prompt).toBe('智慧型物聯網設備應遵循何項法案？')
    expect(exam.questions[1].correctAnswers).toEqual([])
    expect(exam.questions[1].parseWarnings).toContain('尚未設定正確答案')
  })

  it('removes a certification page header embedded before cross-page options', () => {
    const exam = parseTextPages([
      {
        pageNumber: 1,
        width: 595,
        height: 842,
        lines: [
          { text: 'AC 1. 關於「身分驗證管理」相關控制措施的敘述，下列哪些正確？', y: 120 },
        ],
      },
      {
        pageNumber: 2,
        width: 595,
        height: 842,
        lines: [
          { text: '3 113年度第 1次 資訊安全工程師能力鑑定 中級試題 科目：I21資訊安全規劃實務 卷號：I21-3101 C (A) 使用預設密碼登入系統時，於登入後無需立即變更', y: 760 },
          { text: 'D (B) 應具備帳戶鎖定機制，例如：帳號登入進行身分驗證失敗達五次後，至少十五分鐘內不允許該帳號繼續嘗試登入', y: 720 },
          { text: '(C) 應定期審查帳號', y: 680 },
          { text: '(D) 應停用閒置帳號', y: 640 },
          { text: 'B 2. 下一題', y: 580 },
          { text: '(A) 一', y: 540 }, { text: '(B) 二', y: 510 }, { text: '(C) 三', y: 480 }, { text: '(D) 四', y: 450 },
        ],
      },
    ], '113年度測試.pdf')

    expect(exam.questions).toHaveLength(2)
    expect(exam.questions[0].prompt).toBe('關於「身分驗證管理」相關控制措施的敘述，下列哪些正確？')
    expect(exam.questions[0].options.map((option) => option.key)).toEqual(['A', 'B', 'C', 'D'])
    expect(exam.questions[0].options[0].text).toBe('使用預設密碼登入系統時，於登入後無需立即變更')
    expect(exam.questions[0].options[1].text).toContain('應具備帳戶鎖定機制')
    expect(JSON.stringify(exam.questions[0])).not.toContain('I21-3101')
  })

  it('detects page-header contamination in an existing question before reparsing', () => {
    expect(containsPageHeaderArtifact('題目內容 113年度第 1次 資訊安全工程師能力鑑定 中級試題 科目：I21資訊安全規劃實務 卷號：I21-3101')).toBe(true)
    expect(containsPageHeaderArtifact('一般題目內容')).toBe(false)
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
    expect(lines[0].text).toContain('3. 第三題')
    expect(lines[0].answerText).toBe('A')
    expect(lines[0].text).not.toContain('iPAS')
  })

  it('recognizes common figure references', () => {
    expect(referencesFigure('依據下圖所示之結果')).toBe(true)
    expect(referencesFigure('情境如附圖所示')).toBe(true)
    expect(referencesFigure('一般文字題目')).toBe(false)
  })

  it('uses the second left black border to exclude the answer column', () => {
    expect(selectQuestionColumnBorders([36, 82, 175, 482, 558], 595, 92, 574)).toEqual({
      left: 82,
      right: 558,
    })
  })

  it('treats split alternative answers as multiple choice without a prompt marker', () => {
    const exam = parseTextPages([{
      pageNumber: 1,
      width: 595,
      height: 842,
      lines: [
        { text: 'B 1. 下列何者正確？', y: 760 },
        { text: '或', y: 750 },
        { text: 'D', y: 740 },
        { text: '(A) 第一項', y: 710 },
        { text: '(B) 第二項', y: 680 },
        { text: '(C) 第三項', y: 650 },
        { text: '(D) 第四項', y: 620 },
      ],
    }], '拆行答案測試.pdf')

    expect(exam.questions[0].prompt).toBe('下列何者正確？')
    expect(exam.questions[0].correctAnswers).toEqual(['B', 'D'])
    expect(exam.questions[0].type).toBe('multiple')
    expect(exam.questions[0].points).toBe(4)
  })

  it('separates vertically stacked answer-column letters from question text', () => {
    const lines = textContentToLines([
      { str: 'B', width: 6, transform: [1, 0, 0, 1, 72, 760] },
      { str: '3. 下列哪些正確？', width: 110, transform: [1, 0, 0, 1, 95, 760] },
      { str: 'C', width: 6, transform: [1, 0, 0, 1, 72, 748] },
      { str: 'D', width: 6, transform: [1, 0, 0, 1, 72, 736] },
      { str: '或', width: 10, transform: [1, 0, 0, 1, 72, 724] },
      { str: 'A', width: 6, transform: [1, 0, 0, 1, 72, 712] },
      { str: '(A) 第一項', width: 70, transform: [1, 0, 0, 1, 95, 700] },
    ])

    expect(lines[0]).toMatchObject({ text: '3. 下列哪些正確？', answerText: 'B' })
    expect(lines[1]).toMatchObject({ text: '', answerText: 'C' })
    expect(lines[2]).toMatchObject({ text: '', answerText: 'D' })
    expect(lines[3]).toMatchObject({ text: '', answerText: '或' })
  })

  it('uses the primary stacked answer set and excludes alternative corrections', () => {
    const exam = parseTextPages([{
      pageNumber: 1,
      width: 595,
      height: 842,
      lines: [
        { text: '1. 下列哪些正確？', answerText: 'B', y: 760 },
        { text: '', answerText: 'C', y: 748 },
        { text: '', answerText: 'D', y: 736 },
        { text: '', answerText: '或', y: 724 },
        { text: '', answerText: 'A', y: 712 },
        { text: '', answerText: 'B', y: 700 },
        { text: '', answerText: 'C', y: 688 },
        { text: '', answerText: 'D', y: 676 },
        { text: '(A) 第一項', y: 650 },
        { text: '(B) 第二項', y: 620 },
        { text: '(C) 第三項', y: 590 },
        { text: '(D) 第四項', y: 560 },
      ],
    }], '答案欄座標測試.pdf')

    expect(exam.questions[0].prompt).toBe('下列哪些正確？')
    expect(exam.questions[0].correctAnswers).toEqual(['B', 'C', 'D'])
    expect(exam.questions[0].type).toBe('multiple')
    expect(exam.questions[0].points).toBe(4)
    expect(exam.questions[0].options.map((option) => option.text)).toEqual(['第一項', '第二項', '第三項', '第四項'])
  })
})
