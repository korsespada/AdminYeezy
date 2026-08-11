'use client'

import { useState } from 'react'
import { Check, ImageIcon, Palette, Play, Sparkles, X } from 'lucide-react'
import type { BatchAiProcessingOptions } from '@/lib/batch-ai'

const DEFAULT_OPTIONS: BatchAiProcessingOptions = {
  colorFamilyByArticle: false,
  articleExample: '',
  splitAlbumColors: false,
  reorderFirstPhoto: false,
  skipModelOnlyAlbum: false,
}

type Props = {
  batchName: string
  onClose: () => void
  onStart: (mode: 'sample' | 'full', options: BatchAiProcessingOptions) => void
  pending?: boolean
}

export default function BatchAiProcessingSettingsDialog({ batchName, onClose, onStart, pending = false }: Props) {
  const [options, setOptions] = useState<BatchAiProcessingOptions>(DEFAULT_OPTIONS)
  const set = <K extends keyof BatchAiProcessingOptions>(key: K, value: BatchAiProcessingOptions[K]) => {
    setOptions((current) => ({ ...current, [key]: value }))
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-x-4 top-1/2 z-50 max-h-[90vh] -translate-y-1/2 overflow-y-auto rounded-2xl border border-slate-700 bg-slate-950 shadow-2xl sm:left-1/2 sm:w-[620px] sm:-translate-x-1/2">
        <div className="flex items-start justify-between border-b border-slate-800 px-5 py-4">
          <div>
            <div className="flex items-center gap-2 text-lg font-semibold text-white"><Sparkles className="h-5 w-5 text-violet-300" />Точечная обработка ИИ</div>
            <p className="mt-1 text-xs text-slate-500">Настройки применятся к выбранному тесту или полной обработке: {batchName}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-800 hover:text-white"><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-5 p-5">
          <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-200"><Palette className="h-4 w-4 text-violet-300" />Определение цветового семейства</div>
            <label className="flex cursor-pointer items-start gap-3 text-sm text-slate-300">
              <input type="checkbox" checked={options.colorFamilyByArticle} onChange={(event) => set('colorFamilyByArticle', event.target.checked)} className="mt-0.5 accent-violet-500" />
              <span><b className="block text-slate-100">Группировать по артикулу</b><small className="text-xs text-slate-500">ИИ отделит цвет от общей основы артикула и запишет семью.</small></span>
            </label>
            {options.colorFamilyByArticle && (
              <input
                value={options.articleExample}
                onChange={(event) => set('articleExample', event.target.value)}
                placeholder="Пример: SP001 blue → SP001 green = семья SP001"
                className="mt-3 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-violet-400"
              />
            )}
            <label className="mt-4 flex cursor-pointer items-start gap-3 text-sm text-slate-300">
              <input type="checkbox" checked={options.splitAlbumColors} onChange={(event) => set('splitAlbumColors', event.target.checked)} className="mt-0.5 accent-violet-500" />
              <span><b className="block text-slate-100">Разделять разные цвета внутри одного альбома</b><small className="text-xs text-slate-500">Один AI-запрос создаст отдельные карточки и сразу свяжет их в одну семью.</small></span>
            </label>
          </section>

          <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-200"><ImageIcon className="h-4 w-4 text-cyan-300" />Фотографии и альбом</div>
            <label className="flex cursor-pointer items-start gap-3 text-sm text-slate-300">
              <input type="checkbox" checked={options.reorderFirstPhoto} onChange={(event) => set('reorderFirstPhoto', event.target.checked)} className="mt-0.5 accent-cyan-500" />
              <span><b className="block text-slate-100">Поставить лучший кадр первым</b><small className="text-xs text-slate-500">Меняется только первое фото; порядок остальных сохраняется.</small></span>
            </label>
            <label className="mt-4 flex cursor-pointer items-start gap-3 text-sm text-slate-300">
              <input type="checkbox" checked={options.skipModelOnlyAlbum} onChange={(event) => set('skipModelOnlyAlbum', event.target.checked)} className="mt-0.5 accent-cyan-500" />
              <span><b className="block text-slate-100">Исключать альбом только с фото моделей</b><small className="text-xs text-slate-500">Удаляется товар из текущей версии, исходник остаётся в снимке для отката.</small></span>
            </label>
          </section>

          <div className="flex flex-col-reverse gap-2 border-t border-slate-800 pt-4 sm:flex-row sm:justify-end">
            <button onClick={onClose} disabled={pending} className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-50">Отмена</button>
            <button onClick={() => onStart('sample', options)} disabled={pending} className="inline-flex items-center justify-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50"><Play className="h-4 w-4" />Тест 10 товаров</button>
            <button onClick={() => onStart('full', options)} disabled={pending} className="inline-flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50"><Check className="h-4 w-4" />Полная обработка</button>
          </div>
        </div>
      </div>
    </>
  )
}
