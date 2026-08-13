'use client'

import { useCallback, useRef, useState } from 'react'
import { ClipboardPaste, Loader2, Upload } from 'lucide-react'
import {
  recognizeMeasurementTemplateAction,
  uploadMeasurementTemplateImageAction,
} from '@/actions/measurement-templates'

export default function MeasurementImageRecognizer({
  onRecognized,
  disabled = false,
}: {
  onRecognized: (measurements: unknown) => void
  disabled?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const processFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('В буфере нет изображения')
      return
    }

    setBusy(true)
    setMessage('')
    setError('')
    try {
      const uploadData = new FormData()
      uploadData.append('file', file)
      const upload = await uploadMeasurementTemplateImageAction(uploadData)
      if (!upload.success || !upload.data?.url) {
        throw new Error(upload.error || 'Не удалось загрузить фото таблицы')
      }

      const recognition = await recognizeMeasurementTemplateAction(upload.data.url)
      if (!recognition.success || !recognition.data) {
        throw new Error(recognition.error || 'ИИ не смог распознать таблицу')
      }

      onRecognized(recognition.data)
      setMessage('Таблица распознана и подставлена ниже')
    } catch (recognitionError: any) {
      setError(recognitionError?.message || 'Не удалось распознать таблицу')
    } finally {
      setBusy(false)
    }
  }, [onRecognized])

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) void processFile(file)
  }

  const handlePaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    const item = Array.from(event.clipboardData.items).find((entry) => entry.type.startsWith('image/'))
    if (!item) return

    const file = item.getAsFile()
    if (!file) return
    event.preventDefault()
    void processFile(new File([file], 'clipboard-image.png', { type: file.type || 'image/png' }))
  }

  const handleClipboardButton = async () => {
    if (!navigator.clipboard?.read) {
      setError('Нажмите Ctrl+V после копирования изображения')
      return
    }

    try {
      const items = await navigator.clipboard.read()
      for (const item of items) {
        const imageType = item.types.find((type) => type.startsWith('image/'))
        if (!imageType) continue
        const blob = await item.getType(imageType)
        await processFile(new File([blob], 'clipboard-image.png', { type: imageType }))
        return
      }
      setError('В буфере нет изображения')
    } catch {
      setError('Не удалось прочитать буфер. Скопируйте изображение и нажмите Ctrl+V')
    }
  }

  return (
    <div
      className="space-y-2"
      onPaste={handlePaste}
      tabIndex={0}
      aria-label="Загрузка фото таблицы замеров"
    >
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-3 py-2 text-[11px] font-semibold text-indigo-200 hover:bg-indigo-500/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          {busy ? 'Распознавание...' : 'Загрузить фото'}
        </button>
        <button
          type="button"
          onClick={handleClipboardButton}
          disabled={disabled || busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-[11px] font-semibold text-slate-300 hover:border-indigo-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          <ClipboardPaste className="h-3.5 w-3.5" />
          Вставить из буфера
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleFileChange}
          disabled={disabled || busy}
          className="sr-only"
        />
      </div>
      <p className="text-[10px] text-slate-500">Можно также скопировать изображение и нажать Ctrl+V в этом блоке.</p>
      {message && <p className="text-[10px] text-emerald-300">{message}</p>}
      {error && <p className="text-[10px] text-red-300">{error}</p>}
    </div>
  )
}
