/**
 * Пресеты раздела «Видео → товары»: какой поставщик, какая выгрузка и какие
 * категории каталога участвуют в сопоставлении.
 *
 * Пресет описывает весь сценарий целиком: сначала товары каталога закрепляются
 * за поставщиком (`supplierName`), затем по ним подбираются альбомы с видео из
 * выгрузки и апрувнутое видео уезжает в S3 и в карточку товара.
 */
export interface VideoMatchPreset {
  key: string
  title: string
  description: string
  /** Slug бренда каталога — им же фильтруется список товаров в Rails. */
  brandSlug: string
  /** Поставщик в scraping-БД: владелец выгрузки. */
  supplierId: number
  /** Имя поставщика в каталоге: по нему товары закрепляются за ним. */
  supplierName: string
  /** Партия выгрузки с альбомами и видео. */
  batchId: string
  /** Slug'и категорий каталога, которые считаются товарами этого поставщика. */
  categories: Array<{ slug: string; name: string }>
}

export const VIDEO_MATCH_PRESETS: VideoMatchPreset[] = [
  {
    key: 'hermes',
    title: 'Hermes — видео из выгрузки',
    description: 'Сумки, кошельки, косметички, чемоданы, рюкзаки и поясные сумки Hermes.',
    brandSlug: 'hermes',
    supplierId: 68,
    supplierName: 'Hermes',
    batchId: '670438af-1955-4458-a990-1c149c684034',
    categories: [
      { slug: 'sumki-na-plecho', name: 'Сумки на плечо' },
      { slug: 'sumki-messendzhery', name: 'Сумки-мессенджеры' },
      { slug: 'sumki-tout', name: 'Сумки-тоут' },
      { slug: 'sumki-klatchi', name: 'Клатчи' },
      { slug: 'aksessuary-koshelki-i-kartholdery', name: 'Кошельки и картхолдеры' },
      { slug: 'aksessuary-kosmetichki', name: 'Косметички' },
      { slug: 'aksessuary-chemodany', name: 'Чемоданы' },
      { slug: 'sumki-ryukzaki', name: 'Рюкзаки' },
      { slug: 'sumki-poyasnye-sumki', name: 'Поясные сумки' },
    ],
  },
]

export function findVideoMatchPreset(key: string) {
  return VIDEO_MATCH_PRESETS.find((preset) => preset.key === key) || VIDEO_MATCH_PRESETS[0]
}

export const VIDEO_MATCH_BANDS = ['exact', 'strong', 'probable', 'weak'] as const

export const VIDEO_MATCH_BAND_LABELS: Record<string, string> = {
  exact: 'Точное совпадение',
  strong: 'Почти точное',
  probable: 'Вероятное',
  weak: 'Слабое',
}
