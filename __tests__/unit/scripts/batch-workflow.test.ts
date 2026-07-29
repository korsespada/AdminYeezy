import { afterAll, describe, expect, it } from 'vitest'

const workflow = require('../../../scripts/batch-workflow')

afterAll(async () => {
  await workflow.closePools()
})

describe('batch workflow CSV compatibility adapter', () => {
  it('detects comma CSV and preserves quoted separators', () => {
    const rows = workflow.parseCsvObjects('external_id,name,description\n1,"Сумка, малая","Кожа, цепочка"')
    expect(rows).toEqual([{ external_id: '1', name: 'Сумка, малая', description: 'Кожа, цепочка' }])
  })

  it('flattens stored attributes for legacy supplier scripts', () => {
    const products = [{
      external_id: '1', name: 'Сумка', description: '', price: 0, status: 'inactive',
      brand: '', category: '', subcategory: '', gender: '', photos: [], ai_processed: false,
      attributes: { details: 'кожа', hardware: 'золото' },
    }]
    const columns = workflow.supplierScriptColumns(products)
    const csv = workflow.serializeProductsToCsv(products, columns, ';')
    expect(csv.split('\n')[0]).toMatch(/^external_id;name;description;price;brand;category;subcategory;gender;photos/)
    expect(csv.split('\n')[0]).toContain('details')
    expect(csv.split('\n')[0]).toContain('hardware')
    expect(csv).toContain('кожа')
  })

  it('converts legacy script catalog IDs to current Rails IDs', () => {
    const mappings = [
      { entity_type: 'brand', legacy_id: 'old-brand', canonical_id: 'new-brand', name: 'Chanel' },
      { entity_type: 'category', legacy_id: 'old-bags', canonical_id: 'new-bags', name: 'Сумки' },
      {
        entity_type: 'subcategory', legacy_id: 'old-wallets', canonical_id: 'new-wallets',
        canonical_parent_id: 'new-accessories', name: 'Кошельки и картхолдеры',
      },
    ]
    const product = workflow.normalizeProductCatalogReferences({
      brand: 'old-brand', category: 'old-bags', subcategory: 'old-wallets', gender: 'Для женщин',
    }, mappings)

    expect(product).toMatchObject({
      brand: 'new-brand',
      category: 'new-accessories',
      subcategory: 'new-wallets',
      gender: 'female',
    })
  })

  it('recognizes only the configured S3 host as already stored', () => {
    const previous = process.env.S3_PUBLIC_DOMAIN
    process.env.S3_PUBLIC_DOMAIN = 'https://static.yeezyunique.ru'
    try {
      expect(workflow.isAlreadyHosted('https://static.yeezyunique.ru/batches/a/1.jpg')).toBe(true)
      expect(workflow.isAlreadyHosted('https://api.yeezyunique.ru/media/1.jpg')).toBe(false)
      expect(workflow.isAlreadyHosted('https://xcimg.szwego.com/1.jpg')).toBe(false)
    } finally {
      process.env.S3_PUBLIC_DOMAIN = previous
    }
  })
})
