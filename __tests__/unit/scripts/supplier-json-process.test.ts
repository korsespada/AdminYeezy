import { describe, expect, it } from 'vitest'

const { runSupplierJsonProcess } = require('../../../scripts/lib/supplier-json-process')

describe('supplier JSON post-process contract', () => {
  it('preserves UTF-8 and merges neighbouring Chanel albums without CSV artifacts', async () => {
    const products = [
      {
        external_id: 'details',
        description: '经典款 尺寸：25',
        photos: Array.from({ length: 9 }, (_, index) => `detail-${index}`),
        source_position: 0,
        attributes: {},
      },
      {
        external_id: 'cover',
        description: '钱包展示',
        photos: Array.from({ length: 4 }, (_, index) => `cover-${index}`),
        source_position: 1,
        attributes: {},
      },
    ]

    const result = await runSupplierJsonProcess('merge_photos_8_9_11.py', products)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      external_id: 'details',
      description: '钱包展示 经典款 尺寸：25',
      source_position: 0,
    })
    expect(result[0].photos).toHaveLength(13)
  })
})
