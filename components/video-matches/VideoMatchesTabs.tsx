'use client'

import { useState } from 'react'
import VideoMatchesApp from '@/components/video-matches/VideoMatchesApp'
import ProductCardsApp from '@/components/video-matches/ProductCardsApp'

/**
 * Две задачи раздела: привязка видео из выгрузки и обработка уже опубликованных
 * карточек поставщика по правилам выгрузки. Вкладки не смешивают очереди и
 * запускаются независимо.
 */

const TABS: Array<{ key: 'video' | 'cards'; label: string }> = [
  { key: 'video', label: 'Видео → товары' },
  { key: 'cards', label: 'Карточки по правилам выгрузки' },
]

export default function VideoMatchesTabs() {
  const [tab, setTab] = useState<'video' | 'cards'>('video')

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {TABS.map((item) => (
          <button
            key={item.key}
            onClick={() => setTab(item.key)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${tab === item.key
              ? 'border-indigo-500/60 bg-indigo-500/10 text-indigo-200'
              : 'border-slate-700 text-slate-400 hover:bg-slate-800'}`}
          >
            {item.label}
          </button>
        ))}
      </div>
      {tab === 'video' ? <VideoMatchesApp /> : <ProductCardsApp />}
    </div>
  )
}
