import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Chromoff AI migration', () => {
  it('adds legacy item columns before compatibility updates use them', () => {
    const source = readFileSync(resolve(process.cwd(), 'scripts/migrate-chromoff-ai.js'), 'utf8')
    const alterItems = source.indexOf('ALTER TABLE chromoff_ai_items')
    const updateItems = source.indexOf('UPDATE chromoff_ai_items')

    expect(alterItems).toBeGreaterThanOrEqual(0)
    expect(updateItems).toBeGreaterThanOrEqual(0)
    expect(alterItems).toBeLessThan(updateItems)
  })
})
