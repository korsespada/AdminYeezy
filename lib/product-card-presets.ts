/**
 * Пресеты обработки опубликованных карточек по правилам выгрузки.
 *
 * В отличие от раздела «Видео → товары» здесь нет выгрузок и альбомов: пресет
 * описывает поставщика каталога (Rails `supplier=<uuid>`) и категории, товары
 * которых он продаёт. Товар читается из Rails, обрабатывается по правилам
 * выгрузки и возвращается в Rails после апрува оператора.
 */
export interface ProductCardCategory {
  slug: string
  name: string
  kind: 'bag' | 'shoe'
}

export interface ProductCardPreset {
  key: string
  title: string
  description: string
  /** CRM-поставщик: фильтр Rails `supplier=<uuid>`. */
  supplierUuid: string
  supplierName: string
  brandSlug: string
  categories: ProductCardCategory[]
}

export const PRODUCT_CARD_PRESETS: ProductCardPreset[] = [
  {
    key: 'hermes',
    title: 'Hermes — карточки по правилам выгрузки',
    description: 'Сумки и обувь поставщика Hermes: название с моделью, размером и цветом, характеристики, описание и альты фото.',
    supplierUuid: '23c888c0-19b5-492d-b628-45364ba1d96e',
    supplierName: 'Hermes',
    brandSlug: 'hermes',
    categories: [
      { slug: 'sumki-na-plecho', name: 'Сумки на плечо', kind: 'bag' },
      { slug: 'sumki-messendzhery', name: 'Сумки-мессенджеры', kind: 'bag' },
      { slug: 'sumki-tout', name: 'Сумки-тоут', kind: 'bag' },
      { slug: 'sumki-klatchi', name: 'Клатчи', kind: 'bag' },
      { slug: 'sumki-ryukzaki', name: 'Рюкзаки', kind: 'bag' },
      { slug: 'sumki-poyasnye-sumki', name: 'Поясные сумки', kind: 'bag' },
      { slug: 'aksessuary-koshelki-i-kartholdery', name: 'Кошельки и картхолдеры', kind: 'bag' },
      { slug: 'aksessuary-kosmetichki', name: 'Косметички', kind: 'bag' },
      { slug: 'aksessuary-chemodany', name: 'Чемоданы', kind: 'bag' },
      { slug: 'obuv-tapki', name: 'Шлепанцы и тапочки', kind: 'shoe' },
      { slug: 'obuv-krossovki', name: 'Кроссовки и кеды', kind: 'shoe' },
      { slug: 'obuv-myuli', name: 'Мюли и сабо', kind: 'shoe' },
      { slug: 'obuv-tufli', name: 'Туфли', kind: 'shoe' },
      { slug: 'obuv-tufli-na-kabluke', name: 'Туфли на каблуке', kind: 'shoe' },
      { slug: 'obuv-tufli-na-ploskoy-podoshve', name: 'Туфли на плоской подошве', kind: 'shoe' },
      { slug: 'obuv-sandalii', name: 'Сандалии и босоножки', kind: 'shoe' },
      { slug: 'obuv-lofery-i-mokasiny', name: 'Лоферы и мокасины', kind: 'shoe' },
      { slug: 'obuv-botinki-i-polubotinki', name: 'Ботинки и полуботинки', kind: 'shoe' },
      { slug: 'obuv-sapogi', name: 'Сапоги', kind: 'shoe' },
      { slug: 'obuv-baletki', name: 'Балетки', kind: 'shoe' },
    ],
  },
]

export function findProductCardPreset(key: string) {
  return PRODUCT_CARD_PRESETS.find((preset) => preset.key === key) || PRODUCT_CARD_PRESETS[0]
}
