import { useEffect, useRef, useState, type PointerEvent } from 'react'
import * as pdfjsLib from 'pdfjs-dist'

interface Selection {
  x: number
  y: number
  width: number
  height: number
}

interface PdfCropperProps {
  pdf: Blob
  pageNumber: number
  onCrop: (dataUrl: string) => void
}

export function PdfCropper({ pdf, pageNumber, onCrop }: PdfCropperProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    setSelection(null)
    void (async () => {
      try {
        const data = new Uint8Array(await pdf.arrayBuffer())
        const document = await pdfjsLib.getDocument({ data }).promise
        const page = await document.getPage(pageNumber)
        const viewport = page.getViewport({ scale: 1.35 })
        const canvas = canvasRef.current
        if (!canvas || cancelled) return
        canvas.width = viewport.width
        canvas.height = viewport.height
        const context = canvas.getContext('2d')
        if (!context) throw new Error('無法建立 PDF 畫布')
        await page.render({ canvas, canvasContext: context, viewport }).promise
        if (!cancelled) setLoading(false)
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'PDF 頁面載入失敗')
      }
    })()
    return () => { cancelled = true }
  }, [pdf, pageNumber])

  function canvasPoint(event: PointerEvent<HTMLDivElement>) {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(canvas.width, (event.clientX - rect.left) * canvas.width / rect.width)),
      y: Math.max(0, Math.min(canvas.height, (event.clientY - rect.top) * canvas.height / rect.height)),
    }
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (loading) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const point = canvasPoint(event)
    startRef.current = point
    setSelection({ ...point, width: 0, height: 0 })
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!startRef.current) return
    const point = canvasPoint(event)
    const start = startRef.current
    setSelection({
      x: Math.min(start.x, point.x),
      y: Math.min(start.y, point.y),
      width: Math.abs(point.x - start.x),
      height: Math.abs(point.y - start.y),
    })
  }

  function handlePointerUp() {
    startRef.current = null
  }

  function attachCrop() {
    const source = canvasRef.current
    if (!source || !selection || selection.width < 20 || selection.height < 20) return
    const target = document.createElement('canvas')
    target.width = Math.round(selection.width)
    target.height = Math.round(selection.height)
    const context = target.getContext('2d')
    if (!context) return
    context.drawImage(
      source,
      selection.x,
      selection.y,
      selection.width,
      selection.height,
      0,
      0,
      target.width,
      target.height,
    )
    onCrop(target.toDataURL('image/jpeg', 0.9))
  }

  const canvas = canvasRef.current
  const overlayStyle = selection && canvas ? {
    left: `${selection.x / canvas.width * 100}%`,
    top: `${selection.y / canvas.height * 100}%`,
    width: `${selection.width / canvas.width * 100}%`,
    height: `${selection.height / canvas.height * 100}%`,
  } : undefined

  return (
    <section className="pdf-panel" aria-label={`PDF 第 ${pageNumber} 頁`}>
      <div className="panel-heading">
        <div>
          <span className="eyebrow">原始卷面</span>
          <strong>第 {pageNumber} 頁</strong>
        </div>
        <button className="button button-small" disabled={!selection || selection.width < 20} onClick={attachCrop}>
          附加框選內容
        </button>
      </div>
      <p className="crop-help">拖曳框選題組圖、架構圖或圖像選項。</p>
      {error && <div className="notice notice-error">{error}</div>}
      <div
        className={`pdf-canvas-wrap ${loading ? 'is-loading' : ''}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <canvas ref={canvasRef} />
        {selection && <div className="crop-selection" style={overlayStyle} />}
        {loading && <div className="canvas-loading">正在排版原始卷面…</div>}
      </div>
    </section>
  )
}
