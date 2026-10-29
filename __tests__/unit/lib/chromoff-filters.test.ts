import { describe, expect, it } from 'vitest'
import { CHROMOFF_FILTER_NONE, matchChromoffFilter, parseChromoffFilterKeywords } from '@/lib/chromoff-filters'

const filters = [
  { slug: 'sportivnye', label: 'Спортивные штаны', keywords: ['спортивн', 'трикотаж'] },
  { slug: 'bryuki', label: 'Брюки', keywords: ['брюк', 'карго'] },
]

describe('matchChromoffFilter', () => {
  it('picks the keyword that appears first in the name', () => {
    expect(matchChromoffFilter({ name: 'Чёрные трикотажные брюки' }, filters)).toMatchObject({ slug: 'sportivnye', keyword: 'трикотаж', source: 'name' })
    expect(matchChromoffFilter({ name: 'Брюки спортивного кроя' }, filters)).toMatchObject({ slug: 'bryuki' })
  })

  it('falls back to model name and then description', () => {
    expect(matchChromoffFilter({ name: 'Штаны', catalog_attributes: { model_name: { value: 'Карго' } } }, filters)).toMatchObject({ slug: 'bryuki', source: 'model' })
    expect(matchChromoffFilter({ name: 'Штаны', description: 'Спортивные штаны' }, filters)).toMatchObject({ slug: 'sportivnye', source: 'description' })
  })

  it('treats ё as е', () => {
    expect(matchChromoffFilter({ name: 'Шлепанцы' }, [{ slug: 'sandalii', label: 'Шлёпанцы', keywords: ['шлёпан'] }])).toMatchObject({ slug: 'sandalii' })
  })

  it('respects manual overrides and ignores stale ones', () => {
    expect(matchChromoffFilter({ name: 'Спортивные штаны', metadata: { chromoff_filter: 'bryuki' } }, filters)).toEqual({ slug: 'bryuki', reason: 'manual' })
    expect(matchChromoffFilter({ name: 'Спортивные штаны', metadata: { chromoff_filter: CHROMOFF_FILTER_NONE } }, filters)).toBeNull()
    expect(matchChromoffFilter({ name: 'Спортивные штаны', metadata: { chromoff_filter: 'deleted' } }, filters)).toMatchObject({ slug: 'sportivnye', reason: 'keyword' })
  })

  it('returns null without filters or matches', () => {
    expect(matchChromoffFilter({ name: 'Спортивные штаны' }, [])).toBeNull()
    expect(matchChromoffFilter({ name: 'Шорты' }, filters)).toBeNull()
  })
})

describe('parseChromoffFilterKeywords', () => {
  it('splits by commas and new lines, lowercases and dedupes', () => {
    expect(parseChromoffFilterKeywords("Levi, 501\n levi ,,\n517")).toEqual(['levi', '501', '517'])
  })
})
