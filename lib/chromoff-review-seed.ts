import type { RailsChromoffReview, RailsChromoffReviewInput } from '@/lib/rails-admin'

/**
 * Статичный резерв отзывов chromoff.store (src/content/orders.ts витрины).
 * Пока в Rails нет опубликованных отзывов, главная показывает именно его.
 * legacy_key = id заказа в orders.ts. Главная выводит только карточки с фото,
 * поэтому отзывы без фото переносятся черновиками — сайт после переноса
 * выглядит так же. Порядок массива хронологический: создаём по нему, чтобы
 * Rails (month desc, created_at desc) сохранил порядок витрины.
 */
export const SITE_CHROMOFF_REVIEWS: Array<RailsChromoffReviewInput & { legacy_key: string }> = [
  {
    legacy_key: '2026-02',
    city: 'Москва',
    month: '2026-02',
    review: 'всё хорошо, продавец отвечал быстро, благодарю за колье',
    status: 'draft',
    featured: true,
    position: 0,
    items: [
      {
        name: 'Chrome Hearts Колье-розарий с крестом Tiny E CH Plus',
        href: 'https://chromoff.store/product/kole-rozariy-s-krestom-tiny-e-ch-plus',
        channel: false,
      },
    ],
    photo_src: null,
    photo_alt: null,
    photo_customer: false,
    photo_catalog: false,
  },
  {
    legacy_key: '2026-03',
    city: 'Москва',
    month: '2026-03',
    review: 'Всё норм.',
    status: 'published',
    featured: false,
    position: 0,
    items: [
      {
        name: 'Ремень Chrome Hearts 3,5 см с чёрными крестами и серебряной пряжкой Celtic 3-Piece Roller',
        href: 'https://chromoff.store/product/kozhanyy-remen-s-tsvetnymi-krestami-i-serebryanoy-pryazhkoy',
        channel: false,
      },
    ],
    photo_src: 'https://static.yuconcierge.com/site/orders/2026-03-97e2b5bbe0fca644.webp',
    photo_alt: 'Фотоотчёт перед отправкой: ремень 3,5 см с чёрными крестами и пряжкой Celtic, Москва',
    photo_customer: false,
    photo_catalog: false,
  },
  {
    legacy_key: '2026-04',
    city: 'Москва',
    month: '2026-04',
    review: '',
    status: 'published',
    featured: false,
    position: 0,
    items: [
      {
        name: 'Chrome Hearts Серебряная цепь для сумки Cross Ball',
        href: 'https://chromoff.store/product/serebryanaya-tsep-dlya-sumki-cross-ball',
        channel: false,
      },
    ],
    photo_src: 'https://static.yuconcierge.com/site/orders/2026-04-4d3d577d99e21ae1.webp',
    photo_alt: 'Фотоотчёт перед отправкой: серебряная цепь для сумки Cross Ball, Москва',
    photo_customer: false,
    photo_catalog: false,
  },
  {
    legacy_key: '2026-04-2',
    city: 'Москва',
    month: '2026-04',
    review: 'да, получил, спасибо',
    status: 'published',
    featured: false,
    position: 0,
    items: [
      {
        name: 'Chrome Hearts Серебряный браслет-цепь Floral Cross',
        href: 'https://chromoff.store/product/serebryanyy-braslet-tsep-floral-cross',
        channel: false,
      },
    ],
    photo_src: 'https://static.yuconcierge.com/site/orders/2026-04-2-1ce492f1afe3a041.webp',
    photo_alt: 'Мужской серебряный браслет-цепь Chrome Hearts с пластиной и расстёгнутым замком',
    photo_customer: false,
    photo_catalog: true,
  },
  {
    legacy_key: '2026-05',
    city: 'Хабаровск',
    month: '2026-05',
    review: 'Да вроде бы всё неплохо, буду ждать пока браслет станет винтажнее :)',
    status: 'draft',
    featured: true,
    position: 0,
    items: [
      {
        name: 'Chrome Hearts Рубашка в клетку',
        href: 'https://chromoff.store/product/chrome-hearts-rubashka-v-kletku-krasnyy-raznotsvetnyy-ch-28735',
        channel: false,
      },
      {
        name: 'Chrome Hearts Серебряный браслет-цепь с кубиками и крестами',
        href: 'https://chromoff.store/product/serebryanyy-braslet-tsep-s-kubikami-i-krestami',
        channel: false,
      },
    ],
    photo_src: null,
    photo_alt: null,
    photo_customer: false,
    photo_catalog: false,
  },
  {
    legacy_key: '2026-05-2',
    city: 'Москва',
    month: '2026-05',
    review: 'Кольцо получила, внешне вообще не отличишь) И по размеру супер',
    status: 'published',
    featured: true,
    position: 0,
    items: [
      {
        name: 'Chrome Hearts Серебряное кольцо с крестами',
        href: 'https://chromoff.store/product/koltso-cemetery-3',
        channel: false,
      },
    ],
    photo_src: 'https://static.yuconcierge.com/site/orders/2026-05-2-980a38eb711f066f.webp',
    photo_alt: 'Фотоотчёт перед отправкой: серебряное кольцо с крестами, Москва',
    photo_customer: false,
    photo_catalog: false,
  },
  {
    legacy_key: '2026-06',
    city: 'Дубай',
    month: '2026-06',
    review: 'Да, все отлично, спасибо!',
    status: 'published',
    featured: false,
    position: 0,
    items: [
      {
        name: 'Chrome Hearts Футболка с длинным рукавом',
        href: 'https://t.me/chromoff_store/1164',
        channel: true,
      },
      {
        name: 'Chrome Hearts Спортивные штаны',
        href: 'https://chromoff.store/product/chrome-hearts-khudi-ch-19094',
        channel: false,
      },
    ],
    photo_src: 'https://static.yuconcierge.com/site/orders/2026-06-0b2e19ca406e52ff.webp',
    photo_alt: 'Фотоотчёт перед отправкой: футболка с длинным рукавом и спортивные штаны, Дубай',
    photo_customer: false,
    photo_catalog: false,
  },
  {
    legacy_key: '2026-07',
    city: 'Хабаровск',
    month: '2026-07',
    review: 'Да всё отлично, спасибо',
    status: 'published',
    featured: false,
    position: 0,
    items: [
      {
        name: 'Chrome Hearts Серебряная цепь Paper Chain',
        href: 'https://chromoff.store/product/serebryanaya-tsep-paper-chain',
        channel: false,
      },
    ],
    photo_src: 'https://static.yuconcierge.com/site/orders/2026-07-34a1641224232558.webp',
    photo_alt: 'Фотоотчёт перед отправкой: серебряная цепь Paper Chain, Хабаровск',
    photo_customer: false,
    photo_catalog: false,
  },
  {
    legacy_key: '2026-07-2',
    city: 'Москва',
    month: '2026-07',
    review: 'Да, спасибо вам огромное',
    status: 'published',
    featured: false,
    position: 0,
    items: [
      {
        name: 'Chrome Hearts Зип-худи с принтом',
        href: 'https://chromoff.store/product/chrome-hearts-khudi-zip-ch-21590',
        channel: false,
      },
    ],
    photo_src: 'https://static.yuconcierge.com/site/orders/2026-07-2-33a0258284e3b36d.webp',
    photo_alt: 'Фотоотчёт перед отправкой: зип-худи с принтом, Москва',
    photo_customer: false,
    photo_catalog: false,
  },
  {
    legacy_key: '2026-08',
    city: 'Хабаровск',
    month: '2026-08',
    review: 'Да всё хорошо',
    status: 'draft',
    featured: false,
    position: 0,
    items: [
      {
        name: 'Chrome Hearts Футболка-хенли',
        href: 'https://t.me/chromoff_store/3078',
        channel: true,
      },
    ],
    photo_src: null,
    photo_alt: null,
    photo_customer: false,
    photo_catalog: false,
  },
  {
    legacy_key: '2026-09',
    city: 'Дубай',
    month: '2026-09',
    review: 'Всё отлично, спасибо!',
    status: 'draft',
    featured: false,
    position: 0,
    items: [
      {
        name: 'Chrome Hearts Бриджи',
        href: 'https://t.me/chromoff_store/3049',
        channel: true,
      },
    ],
    photo_src: null,
    photo_alt: null,
    photo_customer: false,
    photo_catalog: false,
  },
  {
    legacy_key: '2026-09-2',
    city: 'Москва',
    month: '2026-09',
    review: 'Хорошее качество',
    status: 'draft',
    featured: false,
    position: 0,
    items: [
      {
        name: 'Chrome Hearts Зип-худи с принтом',
        href: 'https://chromoff.store/product/chrome-hearts-khudi-siniy-ch-13462',
        channel: false,
      },
      {
        name: 'Кожаный кошелек с серебряной фурнитурой',
        href: 'https://chromoff.store/product/kozhanyy-koshelek-s-serebryanoy-furnituroy-2',
        channel: false,
      },
      {
        name: 'Очки Chrome Hearts PILLS III',
        href: 'https://chromoff.store/product/ochki-pills-iii-2',
        channel: false,
      },
      {
        name: 'Chrome Hearts Сумка',
        href: 'https://t.me/chromoff_store/3068',
        channel: true,
      },
    ],
    photo_src: null,
    photo_alt: null,
    photo_customer: false,
    photo_catalog: false,
  },
  {
    legacy_key: '2026-09-3',
    city: 'Хабаровск',
    month: '2026-09',
    review: '',
    status: 'draft',
    featured: false,
    position: 0,
    items: [
      {
        name: 'Chrome Hearts Худи',
        href: 'https://chromoff.store/product/chrome-hearts-khudi-chernyy-ch-50939',
        channel: false,
      },
    ],
    photo_src: null,
    photo_alt: null,
    photo_customer: false,
    photo_catalog: false,
  },
]

/** Отзывы с сайта, которых ещё нет в Rails (сверка по legacy_key). */
export function missingSiteChromoffReviews(existing: Pick<RailsChromoffReview, 'legacy_key'>[]) {
  const known = new Set(existing.map((review) => review.legacy_key).filter(Boolean))
  return SITE_CHROMOFF_REVIEWS.filter((review) => !known.has(review.legacy_key))
}
