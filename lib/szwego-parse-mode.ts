/**
 * Источник Szwego у поставщика. Один список значений для серверных действий,
 * карточки поставщика и окна запуска выгрузки: альбомы, единая лента, видео.
 */
export type SzwegoParseMode = 'images' | 'all' | 'video'

export const SZWEGO_PARSE_MODES: SzwegoParseMode[] = ['images', 'all', 'video']

export const SZWEGO_PARSE_MODE_LABELS: Record<SzwegoParseMode, string> = {
  images: 'Альбомы / изображения',
  all: '全部 / единая лента',
  video: 'Только видео',
}

export function normalizeSzwegoParseMode(value: unknown): SzwegoParseMode {
  const mode = String(value ?? '').trim().toLowerCase()
  return mode === 'all' || mode === 'video' ? mode : 'images'
}
