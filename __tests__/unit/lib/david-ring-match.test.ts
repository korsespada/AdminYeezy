import { describe, expect, it } from 'vitest'
import {
  anchorRingTokens,
  buildRingMatchPrompt,
  buildRingMergePatch,
  buildRingSweepPrompt,
  canonicalRingToken,
  parseRingMatchVerdict,
  parseRingSweepVerdict,
  rankRingCandidates,
  ringTokens,
  type RingCandidate,
} from '@/lib/david-ring-match'

/**
 * Названия взяты из живого каталога Chromoff: 146 старых колец и 97 карточек
 * David Studio, созданных 18–20.09. Именно на них проверяется отбор кандидатов.
 */
function candidate(handle: string, title: string, extra: Partial<RingCandidate> = {}): RingCandidate {
  return {
    handle,
    externalId: `david-studio-${handle}`,
    title,
    productId: 'p-' + handle,
    listingId: 'l-' + handle,
    slug: `slug-${handle}`,
    photos: ['https://static.yeezyunique.ru/a.jpg'],
    created: true,
    priceCents: 0,
    photoSource: 'chromoff',
    ...extra,
  }
}

const DAGGER_HEART = candidate('chrome-hearts-dagger-heart-ring', 'Серебряное кольцо Dagger Heart с кинжалом и сердцем')
const DAGGER_SPACER = candidate('chrome-hearts-6mm-dagger-spacer-ring', 'Серебряное кольцо Dagger Spacer 6 мм')
const DOUBLE_DAGGER = candidate('chrome-hearts-double-dagger-ring', 'Серебряное кольцо Double Dagger')
const SCROLL_SPINNER = candidate('chrome-hearts-scroll-spinner-ring', 'Серебряное кольцо-спиннер с узором Scroll')
const SQUARE_CEMETERY = candidate('chrome-hearts-square-cemetery-cross-ring', 'Серебряное кольцо Square Cemetery с крестами')
const RELIEF = candidate('chrome-hearts-v-ch-plus-bs-fleur-ring', 'Серебряное кольцо с рельефным орнаментом')

describe('canonicalRingToken', () => {
  it('сводит падежи и латинское множественное число к одному токену', () => {
    expect(canonicalRingToken('крестами')).toBe('крест')
    expect(canonicalRingToken('кресты')).toBe('крест')
    expect(canonicalRingToken('спиннером')).toBe('спинн')
    expect(canonicalRingToken('Diamonds')).toBe('diamo')
    expect(canonicalRingToken('ЁЖИК')).toBe('ежик')
  })
})

describe('ringTokens', () => {
  it('выбрасывает общие слова, цифры и короткие токены', () => {
    const tokens = ringTokens('Серебряное кольцо из серебра 925 пробы, 6 мм')
    expect(tokens).toEqual([])
  })

  it('оставляет слова моделей, которые и различают кольца', () => {
    expect(ringTokens('Серебряное кольцо Dagger Heart с розовыми бриллиантами'))
      .toEqual(expect.arrayContaining(['dagge', 'heart', 'розов', 'брилл']))
  })
})

describe('rankRingCandidates', () => {
  const all = [DAGGER_HEART, DAGGER_SPACER, DOUBLE_DAGGER, SCROLL_SPINNER, SQUARE_CEMETERY, RELIEF]

  it('ставит Dagger Heart выше Dagger Spacer и Double Dagger для старой карточки Dagger Heart', () => {
    const anchor = {
      name: 'Серебряное кольцо Dagger Heart с розовыми бриллиантами',
      modelName: '',
      seoArticle: 'CH-64512',
      slug: 'chrome-hearts-serebryanoe-koltso-dagger-heart-s-rozovymi-brilliantami-ch-64512',
    }

    const ranked = rankRingCandidates(anchor, all)

    expect(ranked[0].candidate.handle).toBe('chrome-hearts-dagger-heart-ring')
    expect(ranked.map((row) => row.candidate.handle)).toContain('chrome-hearts-6mm-dagger-spacer-ring')
    expect(ranked[0].shared).toEqual(expect.arrayContaining(['dagge', 'heart']))
  })

  it('находит кандидата по латинской модели из атрибута model_name', () => {
    const anchor = { name: 'Кольцо Spinner Fleur из серебра 925', modelName: 'Scroll Spinner', seoArticle: '', slug: '' }

    const ranked = rankRingCandidates(anchor, all)

    expect(ranked[0].candidate.handle).toBe('chrome-hearts-scroll-spinner-ring')
  })

  it('возвращает пусто, когда общих слов нет', () => {
    const anchor = { name: 'Кольцо K&T', modelName: '', seoArticle: '', slug: '' }

    expect(rankRingCandidates(anchor, [SCROLL_SPINNER, RELIEF])).toEqual([])
  })

  it('уважает лимит кандидатов', () => {
    const anchor = { name: 'Серебряное кольцо с крестами и орнаментом Dagger', modelName: '', seoArticle: '', slug: '' }

    expect(rankRingCandidates(anchor, all, { limit: 2 })).toHaveLength(2)
  })

  it('не различает регистр и ё', () => {
    const anchor = { name: 'серебряное КОЛЬЦО double dagger', modelName: '', seoArticle: '', slug: '' }

    expect(rankRingCandidates(anchor, all)[0].candidate.handle).toBe('chrome-hearts-double-dagger-ring')
  })
})

describe('anchorRingTokens', () => {
  it('берёт модель и артикул наравне с названием', () => {
    const tokens = anchorRingTokens({
      name: 'Кольцо классическое',
      modelName: 'Square Cemetery',
      seoArticle: 'CH-64545',
      slug: 'chrome-hearts-koltso-klassicheskoe-ch-64545',
    })

    expect(tokens).toEqual(expect.arrayContaining(['squar', 'cemet']))
  })
})

describe('buildRingMatchPrompt', () => {
  it('перечисляет эталоны с handle и диапазоном плиток', () => {
    const ranked = rankRingCandidates(
      { name: 'Серебряное кольцо Dagger Heart', modelName: '', seoArticle: '', slug: '' },
      [DAGGER_HEART, DAGGER_SPACER],
    )
    const prompt = buildRingMatchPrompt({
      anchor: { name: 'Серебряное кольцо Dagger Heart', priceCents: 4500000, modelName: 'Dagger Heart', metal: 'Серебро 925' },
      ranked,
      anchorTileCount: 9,
      tilesPerCandidate: 3,
    })

    expect(prompt).toContain('Материал карточки: Серебро 925')
    expect(prompt).toContain('Серебряное кольцо Dagger Heart')
    expect(prompt).toContain('плитки 1–3')
    expect(prompt).toContain('плитки 4–6')
    expect(prompt).toContain('chrome-hearts-dagger-heart-ring')
    expect(prompt).toContain('Dagger Heart')
  })
})

describe('parseRingMatchVerdict', () => {
  const candidates = [DAGGER_HEART, DAGGER_SPACER]

  it('превращает индекс в handle', () => {
    const verdict = parseRingMatchVerdict(
      { match_index: 2, same_model: true, confidence: 0.94, evidence: 'совпали кинжал и сердце' },
      candidates,
    )

    expect(verdict.handle).toBe('chrome-hearts-6mm-dagger-spacer-ring')
    expect(verdict.confidence).toBeCloseTo(0.94)
    expect(verdict.invalidIndex).toBe(false)
  })

  it('читает индекс строкой и ограничивает confidence', () => {
    const verdict = parseRingMatchVerdict({ match_index: '1', confidence: 1.7 }, candidates)

    expect(verdict.handle).toBe('chrome-hearts-dagger-heart-ring')
    expect(verdict.confidence).toBe(1)
  })

  it('не считает совпадением индекс вне списка', () => {
    const verdict = parseRingMatchVerdict({ match_index: 7, confidence: 0.99 }, candidates)

    expect(verdict.handle).toBeNull()
    expect(verdict.invalidIndex).toBe(true)
    expect(verdict.confidence).toBe(0)
  })

  it('возвращает «нет совпадения», когда модель так ответила', () => {
    const verdict = parseRingMatchVerdict(
      { match_index: null, same_model: false, confidence: 0.2, evidence: 'другая модель' },
      candidates,
    )

    expect(verdict.handle).toBeNull()
    expect(verdict.invalidIndex).toBe(false)
    expect(verdict.sameModel).toBe(false)
  })

  it('игнорирует индекс, если модель сказала «не то же изделие»', () => {
    const verdict = parseRingMatchVerdict({ match_index: 1, same_model: false, confidence: 0.9 }, candidates)

    expect(verdict.handle).toBeNull()
    expect(verdict.invalidIndex).toBe(false)
  })

  it('переживает мусорный ответ', () => {
    expect(parseRingMatchVerdict(null, candidates).handle).toBeNull()
    expect(parseRingMatchVerdict({ match_index: 'нет' }, candidates).invalidIndex).toBe(true)
  })
})

describe('buildRingSweepPrompt и parseRingSweepVerdict', () => {
  const sweepCandidates = [DAGGER_HEART, DAGGER_SPACER, DOUBLE_DAGGER, SCROLL_SPINNER, SQUARE_CEMETERY, RELIEF]

  it('перечисляет весь каталог и просит номера плиток', () => {
    const prompt = buildRingSweepPrompt({
      anchor: { name: 'Кольцо K&T', modelName: '', metal: '' },
      candidates: sweepCandidates,
      anchorTileCount: 4,
    })

    expect(prompt).toContain('плитки 1–4')
    expect(prompt).toContain('плитки 1–6')
    expect(prompt).toContain('dagger-heart-ring')
    expect(prompt).toContain('по одной модели на плитку')
  })

  it('превращает номера плиток в handle и убирает повторы', () => {
    const verdict = parseRingSweepVerdict({ candidates: [2, 1, 2, '3'], confidence: 0.35 }, sweepCandidates)

    expect(verdict.handles).toEqual([
      'chrome-hearts-6mm-dagger-spacer-ring',
      'chrome-hearts-dagger-heart-ring',
      'chrome-hearts-double-dagger-ring',
    ])
    expect(verdict.invalidIndexes).toEqual([])
    expect(verdict.confidence).toBeCloseTo(0.35)
  })

  it('ограничивает список пятью моделями', () => {
    const verdict = parseRingSweepVerdict({ candidates: [1, 2, 3, 4, 5, 6] }, sweepCandidates)

    expect(verdict.handles).toHaveLength(5)
  })

  it('отбрасывает номера вне каталога, но сообщает о них', () => {
    const verdict = parseRingSweepVerdict({ candidates: [99, 1] }, sweepCandidates)

    expect(verdict.handles).toEqual(['chrome-hearts-dagger-heart-ring'])
    expect(verdict.invalidIndexes).toEqual([99])
  })

  it('понимает пустой ответ как «похожих нет»', () => {
    expect(parseRingSweepVerdict({ candidates: [] }, sweepCandidates).handles).toEqual([])
    expect(parseRingSweepVerdict(null, sweepCandidates).handles).toEqual([])
    expect(parseRingSweepVerdict({ candidates: 'нет' }, sweepCandidates).handles).toEqual([])
  })
})

describe('buildRingMergePatch', () => {
  const anchorProduct = {
    id: 'anchor-1',
    name: 'Кольцо Keeper с муассанитами',
    h1: 'Кольцо Keeper с муассанитами',
    description: 'Старое описание',
    seo_description: 'Старое SEO',
    price_cents: 4500000,
    indexing_status: 'noindex',
    variants: [{ sku: 'old-1', size: '17', price_cents: 4500000, status: 'active' }],
    catalog_attributes: { model_name: 'Keeper', colors: { display_value: 'Серебристый' }, sizes: [] },
    media: [
      { original_url: 'https://static.yeezyunique.ru/old-1.webp', alt_text: 'старое 1', sort_order: 0 },
      { original_url: 'https://static.yeezyunique.ru/shared.webp', alt_text: 'общее', sort_order: 1 },
    ],
  }

  const davidProduct = {
    id: 'david-1',
    name: 'Серебряное кольцо Keeper с крестом',
    h1: 'Chrome Hearts Серебряное кольцо Keeper с крестом',
    description: 'Новое описание из David',
    seo_description: 'Новое SEO из David',
    price_cents: 0,
    indexing_status: 'noindex',
    catalog_attributes: { model_name: 'Keeper', sizes: ['16', '17'], measurements: 'ширина 8 мм' },
    media: [
      { original_url: 'https://static.yeezyunique.ru/new-1.webp', alt_text: 'новое 1', sort_order: 0 },
      { original_url: 'https://static.yeezyunique.ru/shared.webp', alt_text: 'дубль адреса', sort_order: 1 },
    ],
  }

  it('переносит контент David в старую карточку', () => {
    const { patch, copied } = buildRingMergePatch(anchorProduct, davidProduct)

    expect(patch.name).toBe('Серебряное кольцо Keeper с крестом')
    expect(patch.h1).toBe('Chrome Hearts Серебряное кольцо Keeper с крестом')
    expect(patch.description).toBe('Новое описание из David')
    expect(patch.seo_description).toBe('Новое SEO из David')
    expect(copied.photos).toBe(2)
    expect(copied.attributes).toEqual(expect.arrayContaining(['sizes', 'measurements']))
  })

  it('ставит фото David первыми, сохраняет старые и не дублирует адреса', () => {
    const { patch } = buildRingMergePatch(anchorProduct, davidProduct)
    const media = patch.media as Array<Record<string, unknown>>

    expect(media.map((medium) => medium.original_url)).toEqual([
      'https://static.yeezyunique.ru/new-1.webp',
      'https://static.yeezyunique.ru/shared.webp',
      'https://static.yeezyunique.ru/old-1.webp',
    ])
    expect(media.map((medium) => medium.sort_order)).toEqual([0, 1, 2])
    expect(media[0].alt_text).toBe('новое 1')
  })

  it('перекрывает характеристики David и оставляет те, которых у него нет', () => {
    const { patch } = buildRingMergePatch(anchorProduct, davidProduct)
    const attributes = patch.catalog_attributes as Record<string, unknown>

    expect(attributes.model_name).toBe('Keeper')
    expect(attributes.sizes).toEqual(['16', '17'])
    expect(attributes.colors).toEqual({ display_value: 'Серебристый' })
  })

  it('не трогает цену, варианты и статус, но делает канон индексируемым', () => {
    const { patch } = buildRingMergePatch(anchorProduct, davidProduct)

    expect(patch.price_cents).toBeUndefined()
    expect(patch.variants).toBeUndefined()
    expect(patch.status).toBeUndefined()
    expect(patch.indexing_status).toBe('indexable')
  })

  it('не переписывает indexing_status, если карточка уже индексируемая', () => {
    const { patch } = buildRingMergePatch({ ...anchorProduct, indexing_status: 'indexable' }, davidProduct)

    expect(patch.indexing_status).toBeUndefined()
  })

  it('переживает товар David без медиа и характеристик', () => {
    const { patch, copied } = buildRingMergePatch(anchorProduct, { name: 'Только название' })

    expect(patch.name).toBe('Только название')
    expect((patch.media as unknown[]).length).toBe(2)
    expect(patch.indexing_status).toBe('indexable')
    expect(copied.photos).toBe(0)
    expect(copied.seoDescription).toBe(false)
  })
})
