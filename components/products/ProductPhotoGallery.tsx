'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Image from 'next/image'
import { ChevronLeft, ChevronRight, Download, GripVertical, Maximize2, Trash2, X } from 'lucide-react'
import { imagePresets, resizeImageUrl } from '@/lib/image'

export default function ProductPhotoGallery({
  photos,
  altTexts,
  onChange,
  onMove,
  onRemove,
  onDownload,
  emptyText = 'Нет фото',
}: {
  photos: string[]
  altTexts?: string[]
  onChange?: (photos: string[]) => void
  onMove?: (fromIndex: number, toIndex: number) => void
  onRemove?: (index: number) => void
  onDownload?: (url: string, index: number) => void
  emptyText?: string
}) {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const editable = Boolean(onChange || onMove)

  const movePhoto = (event: React.DragEvent, targetIndex: number) => {
    event.preventDefault()
    if ((!onChange && !onMove) || draggedIndex === null || draggedIndex === targetIndex) return
    const next = [...photos]
    const [dragged] = next.splice(draggedIndex, 1)
    next.splice(targetIndex, 0, dragged)
    const sourceIndex = draggedIndex
    setDraggedIndex(targetIndex)
    if (onMove) onMove(sourceIndex, targetIndex)
    else onChange?.(next)
  }

  if (!photos.length) {
    return <div className="rounded-lg border border-dashed border-slate-700 p-4 text-center text-sm text-slate-500">{emptyText}</div>
  }

  return (
    <>
      <div className="grid grid-cols-5 gap-2">
        {photos.map((url, index) => {
          const altText = altTexts?.[index] || `Фото товара ${index + 1}`
          return (
            <div
              key={`${url}-${index}`}
              draggable={editable}
              onDragStart={() => setDraggedIndex(index)}
              onDragOver={(event) => movePhoto(event, index)}
              onDragEnd={() => setDraggedIndex(null)}
              className={`group relative aspect-square min-w-0 overflow-hidden rounded-lg border bg-slate-950 transition ${editable ? 'cursor-move' : ''} ${draggedIndex === index ? 'border-indigo-400 opacity-50' : 'border-slate-700 hover:border-slate-500'}`}
              title={altText}
            >
              <Image
                src={resizeImageUrl(url, imagePresets.productForm)}
                alt={altText}
                fill
                sizes="(max-width: 640px) 20vw, 130px"
                loading={index < 5 ? 'eager' : 'lazy'}
                className="object-cover"
                unoptimized
              />
              {editable && <span className="absolute left-1 top-1 rounded bg-slate-950/75 p-0.5 text-white"><GripVertical className="h-3 w-3" /></span>}
              <button
                type="button"
                onClick={(event) => { event.stopPropagation(); setLightboxIndex(index) }}
                className="absolute bottom-1 left-1 rounded bg-slate-950/80 p-1 text-white shadow hover:bg-indigo-600"
                title="Открыть полное фото"
                aria-label={`Открыть фото ${index + 1} полностью`}
              >
                <Maximize2 className="h-3 w-3" />
              </button>
              {(onRemove || onDownload) && (
                <div className="absolute right-1 top-1 flex flex-col gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                  {onRemove && <button type="button" onClick={(event) => { event.stopPropagation(); onRemove(index) }} className="rounded bg-red-600 p-1 text-white shadow hover:bg-red-500" title="Удалить фото"><Trash2 className="h-3 w-3" /></button>}
                  {onDownload && <button type="button" onClick={(event) => { event.stopPropagation(); onDownload(url, index) }} className="rounded bg-slate-800 p-1 text-white shadow hover:bg-slate-700" title="Скачать исходное фото"><Download className="h-3 w-3" /></button>}
                </div>
              )}
              <span className="absolute bottom-1 right-1 rounded bg-slate-950/75 px-1.5 py-0.5 text-[10px] text-white">{index + 1}</span>
            </div>
          )
        })}
      </div>
      {lightboxIndex !== null && createPortal(
        <PhotoLightbox
          photos={photos}
          index={Math.min(lightboxIndex, photos.length - 1)}
          onIndexChange={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />,
        document.body,
      )}
    </>
  )
}

function PhotoLightbox({
  photos,
  index,
  onIndexChange,
  onClose,
}: {
  photos: string[]
  index: number
  onIndexChange: (index: number) => void
  onClose: () => void
}) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowLeft' && photos.length > 1) onIndexChange((index - 1 + photos.length) % photos.length)
      if (event.key === 'ArrowRight' && photos.length > 1) onIndexChange((index + 1) % photos.length)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [index, onClose, onIndexChange, photos.length])

  return (
    <div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/95 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label={`Фото ${index + 1} из ${photos.length}`}>
      <div className="relative h-full w-full" onClick={(event) => event.stopPropagation()}>
        <Image src={photos[index]} alt={`Фото товара ${index + 1}`} fill sizes="100vw" className="object-contain" unoptimized priority />
        <button type="button" onClick={onClose} className="absolute right-2 top-2 rounded-lg bg-black/70 p-2 text-white hover:bg-slate-800" title="Закрыть (Esc)"><X className="h-5 w-5" /></button>
        {photos.length > 1 && <>
          <button type="button" onClick={() => onIndexChange((index - 1 + photos.length) % photos.length)} className="absolute left-2 top-1/2 -translate-y-1/2 rounded-lg bg-black/70 p-2 text-white hover:bg-slate-800" aria-label="Предыдущее фото"><ChevronLeft className="h-6 w-6" /></button>
          <button type="button" onClick={() => onIndexChange((index + 1) % photos.length)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg bg-black/70 p-2 text-white hover:bg-slate-800" aria-label="Следующее фото"><ChevronRight className="h-6 w-6" /></button>
        </>}
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded bg-black/70 px-3 py-1 text-xs text-white">{index + 1} / {photos.length}</div>
      </div>
    </div>
  )
}
