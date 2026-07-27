import { describe, expect, it } from 'vitest'

const { catalogQualityIssues, sanitizeCatalogOutput, sanitizeDescription } = require('../../../scripts/lib/catalog-output') as {
  catalogQualityIssues: (generation: Record<string, any>, output: Record<string, any>) => string[]
  sanitizeCatalogOutput: (output: Record<string, unknown>, options?: { internalIdentifiers?: string[] }) => Record<string, any>
  sanitizeDescription: (description: string, identifiers?: string[]) => string
}

describe('AI catalog output sanitizer', () => {
  it('removes photo-analysis language while preserving the useful product fact', () => {
    expect(sanitizeDescription(
      'Компактные серьги подходят для повседневных образов. На фотографиях заметны штифты и застёжки-бабочки, обеспечивающие фиксацию серёг.',
    )).toBe(
      'Компактные серьги подходят для повседневных образов.\nШтифты и застёжки-бабочки, обеспечивающие фиксацию серёг.',
    )
  })

  it('does not alter evidence in conflicts or ordinary description text', () => {
    const output = sanitizeCatalogOutput({
      description: 'Розовые серьги-пусеты с декоративным кантом.',
      conflicts: [{ field: 'materials', evidence: 'На фото материал не читается.' }],
    })

    expect(output).toEqual({
      description: 'Розовые серьги-пусеты с декоративным кантом.',
      conflicts: [{ field: 'materials', evidence: 'На фото материал не читается.' }],
    })
  })

  it('removes internal identifiers, missing-data phrases and excessive line breaks', () => {
    const output = sanitizeCatalogOutput({
      suggested_name: 'Браслет-цепь H020 с цветочными мотивами',
      description: 'Браслет H020 выполнен из серебра.\\n\\nТочная длина браслета не указана. Украшен цветочными мотивами. Подходит для повседневных образов. Дополнен застёжкой.',
      catalog_attributes: { model_name: 'H020', jewelry_metal: ['silver'] },
    }, { internalIdentifiers: ['H020'] })

    expect(output.suggested_name).toBe('Браслет-цепь с цветочными мотивами')
    expect(output.catalog_attributes.model_name).toBeUndefined()
    expect(output.description).not.toContain('H020')
    expect(output.description).not.toContain('не указана')
    expect(output.description.match(/\n/g)).toHaveLength(2)
    expect(output.description).not.toContain('\n\n')
  })

  it('requests a quality review when a source material was dropped', () => {
    const issues = catalogQualityIssues({
      input_snapshot: {
        product: { description: 'Модель: Triple Stitch Monte\nМатериал: Замша, кожа' },
        catalog: { internal_identifiers: ['H020'] },
      },
    }, {
      suggested_name: 'Ботинки H020',
      description: 'Чёрные ботинки со шнуровкой.',
      catalog_attributes: { colors: ['black'] },
    })

    expect(issues).toHaveLength(2)
    expect(issues.join(' ')).toContain('внутренний артикул')
    expect(issues.join(' ')).toContain('Замша, кожа')
  })
})
