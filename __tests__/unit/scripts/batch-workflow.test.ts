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
})
