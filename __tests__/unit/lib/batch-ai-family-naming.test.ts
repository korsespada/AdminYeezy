import { describe, expect, it } from 'vitest'
import {
  buildBatchAiFamilyNamingPrompt,
  familyNamingPhotoUrls,
  normalizeBatchAiFamilyNamingOutput,
} from '@/lib/batch-ai-family-naming'

const products = [
  { id: 11, name: 'Коричневые кожаные полуботинки с меховой отделкой', photos: ['https://x/a.jpg'], attributes: { colors: ['Коричневый'] } },
  { id: 12, name: 'Коричневые кожаные полуботинки с меховой отделкой', photos: ['https://x/a.jpg'], attributes: { colors: ['Коричневый'] } },
  { id: 13, name: 'Коричневые замшевые ботинки с меховой отделкой', photos: ['https://x/c.jpg'], attributes: { colors: ['Коричневый'] } },
]

function member(index: number, color: string, name: string, extra: Record<string, unknown> = {}) {
  return { product_index: index, color, base_color: 'Коричневый', name, name_en: '', ...extra }
}

describe('family naming', () => {
  it('numbers the main photos so equal URLs stay separate', () => {
    expect(familyNamingPhotoUrls(products)).toEqual(['https://x/a.jpg#family-11', 'https://x/a.jpg#family-12', 'https://x/c.jpg#family-13'])
    expect(buildBatchAiFamilyNamingPrompt(products)).toContain('"index":3')
  })

  it('accepts distinct shades and a split by material', () => {
    const groups = normalizeBatchAiFamilyNamingOutput({
      groups: [
        {
          base_name: 'кожаные полуботинки с меховой отделкой',
          material: 'Кожа',
          members: [
            member(1, 'Коричневый', 'коричневые кожаные полуботинки с меховой отделкой'),
            member(2, 'Тёмно-коричневый', 'Тёмно-коричневые кожаные полуботинки с меховой отделкой'),
          ],
        },
        {
          base_name: 'замшевые ботинки с меховой отделкой',
          material: 'Замша',
          members: [member(3, 'Коричневый', 'Коричневые замшевые ботинки с меховой отделкой', { base_color: 'нет такого' })],
        },
      ],
    }, products)

    expect(groups).toHaveLength(2)
    expect(groups[0].members.map((entry) => entry.name)).toEqual([
      'Коричневые кожаные полуботинки с меховой отделкой',
      'Тёмно-коричневые кожаные полуботинки с меховой отделкой',
    ])
    expect(groups[1].members[0]).toMatchObject({ productId: 13, baseColor: '' })
  })

  it('rejects repeated names, a missing product and a name without the shared base', () => {
    const base = 'кожаные полуботинки с меховой отделкой'
    expect(() => normalizeBatchAiFamilyNamingOutput({
      groups: [{ base_name: base, members: [member(1, 'Коричневый', `Коричневые ${base}`), member(2, 'Коричневый', `Коричневые ${base}`), member(3, 'Бежевый', `Бежевые ${base}`)] }],
    }, products)).toThrow('одинаковое название')
    expect(() => normalizeBatchAiFamilyNamingOutput({
      groups: [{ base_name: base, members: [member(1, 'Коричневый', `Коричневые ${base}`)] }],
    }, products)).toThrow('не вернул товары 2, 3')
    expect(() => normalizeBatchAiFamilyNamingOutput({
      groups: [{ base_name: base, members: [member(1, 'Коричневый', 'Коричневые ботинки'), member(2, 'Бежевый', `Бежевые ${base}`), member(3, 'Синий', `Синие ${base}`)] }],
    }, products)).toThrow('не содержит основу')
  })

  it('lets a true duplicate keep the original name', () => {
    const base = 'кожаные полуботинки с меховой отделкой'
    const groups = normalizeBatchAiFamilyNamingOutput({
      groups: [{
        base_name: base,
        members: [
          member(1, 'Коричневый', `Коричневые ${base}`),
          member(2, 'Коричневый', `Коричневые ${base}`, { duplicate_of_index: 1 }),
          member(3, 'Бежевый', `Бежевые ${base}`),
        ],
      }],
    }, products)

    expect(groups[0].members[1].duplicateOfProductId).toBe(11)
  })
})
