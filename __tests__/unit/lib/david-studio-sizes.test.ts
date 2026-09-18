import { describe, expect, it } from 'vitest'
import {
  buildDavidMeasurementTable,
  davidVariantAttributes,
  davidVariantSizes,
  parseDavidVariantSize,
} from '@/lib/david-studio-sizes'

/**
 * Строки ниже — реальные значения вариантов из data/david-studio/catalog.json,
 * а не придуманные примеры.
 */
describe('parseDavidVariantSize: браслеты и ожерелья из дюймов и сантиметров', () => {
  it('переводит дюймы и сантиметры в сантиметры', () => {
    const parsed = parseDavidVariantSize('6.3 IN / 16 CM')
    expect(parsed.size).toBe('16 см')
    expect(parsed.kind).toBe('measure')
  })

  it('переносит подсказку о посадке в пояснение', () => {
    const parsed = parseDavidVariantSize('6.3 IN / 16 CM（Suitable For Wrists 14CM）')
    expect(parsed.size).toBe('16 см')
    expect(parsed.fit).toBe('подходит для запястья 14 см')
  })

  it('поддерживает диапазон посадки', () => {
    const parsed = parseDavidVariantSize('6.3 IN / 16 CM（Suitable For Wrists 13-14CM）')
    expect(parsed.size).toBe('16 см')
    expect(parsed.fit).toBe('подходит для запястья 13–14 см')
  })

  it('поддерживает «ниже» в подсказке', () => {
    const parsed = parseDavidVariantSize('6.3 IN / 16 CM （Suitable For Wrists Below 14CM）')
    expect(parsed.size).toBe('16 см')
    expect(parsed.fit).toBe('подходит для запястья до 14 см')
  })

  it('оставляет диапазон размеров диапазоном', () => {
    expect(parseDavidVariantSize('5.5-6.6 IN / 14-17 CM（wrist circumference）').size).toBe('14–17 см')
    expect(parseDavidVariantSize('5.5 IN / 14.5 CM  -  6.1 IN / 15.5 CM').size).toBe('14,5–15,5 см')
  })

  it('берёт длину ремня в сантиметрах', () => {
    const parsed = parseDavidVariantSize('Waist Circumference 28IN（Belt Length 84CM）')
    expect(parsed.size).toBe('84 см')
    expect(parsed.fit).toContain('28 in')
  })

  it('переводит дюймы, когда сантиметров нет', () => {
    expect(parseDavidVariantSize('20 IN').size).toBe('50,8 см')
  })
})

describe('parseDavidVariantSize: размеры, которые нельзя выдумывать', () => {
  it('оставляет US-размер кольца как есть', () => {
    const parsed = parseDavidVariantSize('US4.5')
    expect(parsed.size).toBe('US 4,5')
    expect(parsed.kind).toBe('us_ring')
  })

  it('сохраняет буквенные размеры', () => {
    expect(parseDavidVariantSize('S').size).toBe('S')
    expect(parseDavidVariantSize('XL（Single）').size).toBe('XL')
  })

  it('не считает размером цвет, поштучность и заглушку', () => {
    for (const value of ['Choose an option', 'Pendant Only', 'Per Piece', 'Per Pair', 'Black Cowhide', 'White Moissanite（Per Piece）']) {
      expect(parseDavidVariantSize(value).size).toBeNull()
    }
  })

  it('переводит размер пальца в миллиметры, если поставщик дал мм', () => {
    const parsed = parseDavidVariantSize('US7 / 54.5 MM（Suitable For Finger 17.5MM）')
    expect(parsed.size).toBe('54,5 мм')
    expect(parsed.fit).toBe('подходит для пальца 17,5 мм')
  })
})

describe('davidVariantAttributes', () => {
  const variants = [
    { size: '6.3 IN / 16 CM（Suitable For Wrists 14CM）' },
    { size: '6.7 IN / 17 CM（Suitable For Wrists 15CM）' },
    { size: '6.7 IN / 17 CM（Suitable For Wrists 15CM）' },
    { size: 'Choose an option' },
  ]

  it('собирает уникальные размеры в порядке вариантов', () => {
    expect(davidVariantSizes(variants)).toEqual(['16 см', '17 см'])
  })

  it('строит таблицу замеров: одна строка на размер', () => {
    const table = buildDavidMeasurementTable(variants)
    expect(table?.unit).toBe('см')
    expect(table?.columns).toEqual([{ key: 'fit', label: 'Посадка' }])
    expect(table?.rows).toEqual([
      { size: '16 см', values: { fit: 'подходит для запястья 14 см' } },
      { size: '17 см', values: { fit: 'подходит для запястья 15 см' } },
    ])
  })

  it('отдельно собирает строки, которые размером не являются', () => {
    expect(davidVariantAttributes(variants).notSizes).toEqual(['Choose an option'])
  })

  it('не строит таблицу, если размеров нет', () => {
    expect(buildDavidMeasurementTable([{ size: 'Pendant Only' }])).toBeNull()
    expect(davidVariantSizes([{ size: undefined }])).toEqual([])
  })
})
