'use client'

import { useEffect, useMemo, useState } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import Image from 'next/image'
import { ChevronLeft, ChevronRight, Download, GripVertical, Maximize2, Trash2, X } from 'lucide-react'
import { imagePresets, resizeImageUrl } from '@/lib/image'

type GalleryPhoto = {
  url: string
  /**
   * Ключ не зависит от позиции: при перестановке React перемещает тот же DOM-узел,
   * а не пересоздаёт его. Иначе браузер отменяет начатый drag и фото возвращается
   * на прежнее место.
   */
  key: string
}

function buildGalleryPhotos(photos: string[]): GalleryPhoto[] {
  const occurrences = new Map<string, number>()
  return photos.map((url) => {
    const occurrence = occurrences.get(url) || 0
    occurrences.set(url, occurrence + 1)
    return { url, key: `${url}#${occurrence}` }
  })
}

/**
 * Сколько полноэкранных галерей открыто прямо сейчас.
 *
 * Галерея — отдельный слой Radix поверх шторки товара или дровера Chromoff. Она
 * забирает Escape и стрелки себе (см. `PhotoLightbox`), поэтому Esc закрывает
 * только галерею. Контейнер, который сам закрывается по Esc, обязан спросить
 * `isPhotoLightboxOpen()` — иначе по Esc закроются и галерея, и товар.
 */
let openPhotoLightboxes = 0

export function isPhotoLightboxOpen() {
  return openPhotoLightboxes > 0
}

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
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const editable = Boolean(onChange || onMove)
  const items = useMemo(() => buildGalleryPhotos(photos), [photos])

  const finishDrag = () => {
    setDraggedIndex(null)
    setDropIndex(null)
  }

  // Перестановка применяется только по drop. Во время перетаскивания порядок в DOM
  // не меняется, поэтому несколько событий dragenter подряд не могут применить
  // взаимоисключающие перестановки из устаревшего снимка списка.
  const commitMove = (fromIndex: number, toIndex: number) => {
    if (!onChange && !onMove) return
    if (fromIndex === toIndex) return
    if (fromIndex < 0 || toIndex < 0 || fromIndex >= photos.length || toIndex >= photos.length) return

    const next = [...photos]
    const [dragged] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, dragged)
    if (onMove) onMove(fromIndex, toIndex)
    else onChange?.(next)
  }

  if (!photos.length) {
    return <div className="rounded-lg border border-dashed border-slate-700 p-4 text-center text-sm text-slate-500">{emptyText}</div>
  }

  return (
    <>
      <div className="grid grid-cols-5 gap-2">
        {items.map((item, index) => {
          const url = item.url
          const altText = altTexts?.[index] || `Фото товара ${index + 1}`
          const isDragging = draggedIndex === index
          const isDropTarget = dropIndex === index && draggedIndex !== null && draggedIndex !== index
          const stateClass = isDragging
            ? 'border-indigo-400 opacity-50'
            : isDropTarget
              ? 'border-indigo-400 ring-2 ring-indigo-400/60'
              : 'border-slate-700 hover:border-slate-500'
          return (
            <div
              key={item.key}
              draggable={editable}
              onDragStart={(event) => {
                if (!editable) return
                setDraggedIndex(index)
                if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
              }}
              onDragEnter={(event) => {
                if (!editable || draggedIndex === null) return
                event.preventDefault()
                if (dropIndex !== index) setDropIndex(index)
              }}
              onDragOver={(event) => {
                if (!editable || draggedIndex === null) return
                event.preventDefault()
                if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
              }}
              onDrop={(event) => {
                if (!editable || draggedIndex === null) return
                event.preventDefault()
                const fromIndex = draggedIndex
                finishDrag()
                commitMove(fromIndex, index)
              }}
              onDragEnd={finishDrag}
              className={`group relative aspect-square min-w-0 overflow-hidden rounded-lg border bg-slate-950 transition ${editable ? 'cursor-move' : ''} ${stateClass}`}
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
      {lightboxIndex !== null && (
        <PhotoLightbox
          photos={photos}
          index={Math.min(lightboxIndex, photos.length - 1)}
          onIndexChange={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </>
  )
}

/**
 * Полноэкранное фото.
 *
 * Это отдельный слой Radix (Dialog), а не самодельный оверлей в портале: пока
 * открыта шторка товара, Rails-контейнер ставит `body { pointer-events: none }`
 * и включает их только своим слоям. Портал в `document.body` оказывался вне
 * такого слоя, поэтому клики по галерее уходили в интерфейс админки. Radix
 * регистрирует галерею как верхний слой: она получает и клики, и Escape.
 *
 * Клик по затемнению закрывает галерею (Radix), клик по самому фото — нет.
 */
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
    openPhotoLightboxes += 1
    return () => { openPhotoLightboxes -= 1 }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isPrevious = event.key === 'ArrowLeft'
      const isNext = event.key === 'ArrowRight'
      if (event.key !== 'Escape' && !isPrevious && !isNext) return

      // Escape и стрелки забирает только галерея: без этого шторка товара и
      // дровер Chromoff закрывались бы вместе с фото.
      event.preventDefault()
      event.stopImmediatePropagation()

      if (event.key === 'Escape') {
        onClose()
        return
      }
      if (photos.length < 2) return
      onIndexChange(isPrevious
        ? (index - 1 + photos.length) % photos.length
        : (index + 1) % photos.length)
    }

    // Capture на window: обработчики контейнеров висят ниже по фазе, поэтому
    // до них событие уже не доходит.
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [index, onClose, onIndexChange, photos.length])

  const step = (delta: number) => {
    if (photos.length < 2) return
    onIndexChange((index + delta + photos.length) % photos.length)
  }

  return (
    <DialogPrimitive.Root open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-[220] bg-black/95"
          onClick={(event) => event.stopPropagation()}
        />
        <DialogPrimitive.Content
          aria-label={`Фото ${index + 1} из ${photos.length}`}
          aria-describedby={undefined}
          // Размер контейнера равен размеру фото, поэтому клик «помимо фото»
          // попадает в затемнение и закрывает галерею, а не в пустое поле.
          className="fixed left-1/2 top-1/2 z-[221] -translate-x-1/2 -translate-y-1/2 outline-none"
          onClick={(event) => event.stopPropagation()}
        >
          <DialogPrimitive.Title className="sr-only">{`Фото ${index + 1} из ${photos.length}`}</DialogPrimitive.Title>
          <Image
            src={photos[index]}
            alt={`Фото товара ${index + 1}`}
            width={0}
            height={0}
            sizes="100vw"
            unoptimized
            priority
            className="block h-auto max-h-[calc(100dvh-2rem)] w-auto max-w-[calc(100vw-2rem)] object-contain"
          />
          <button type="button" onClick={onClose} className="absolute right-2 top-2 rounded-lg bg-black/70 p-2 text-white hover:bg-slate-800" title="Закрыть (Esc)"><X className="h-5 w-5" /></button>
          {photos.length > 1 && <>
            <button type="button" onClick={() => step(-1)} className="absolute left-2 top-1/2 -translate-y-1/2 rounded-lg bg-black/70 p-2 text-white hover:bg-slate-800" aria-label="Предыдущее фото"><ChevronLeft className="h-6 w-6" /></button>
            <button type="button" onClick={() => step(1)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg bg-black/70 p-2 text-white hover:bg-slate-800" aria-label="Следующее фото"><ChevronRight className="h-6 w-6" /></button>
          </>}
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded bg-black/70 px-3 py-1 text-xs text-white">{index + 1} / {photos.length}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
