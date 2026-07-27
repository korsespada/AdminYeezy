import { describe, expect, it } from 'vitest'

const { sanitizeCatalogOutput, sanitizeDescription } = require('../../../scripts/lib/catalog-output') as {
  sanitizeCatalogOutput: (output: Record<string, unknown>) => Record<string, unknown>
  sanitizeDescription: (description: string) => string
}

describe('AI catalog output sanitizer', () => {
  it('removes photo-analysis language while preserving the useful product fact', () => {
    expect(sanitizeDescription(
      'Компактные серьги подходят для повседневных образов. На фотографиях заметны штифты и застёжки-бабочки, обеспечивающие фиксацию серёг.',
    )).toBe(
      'Компактные серьги подходят для повседневных образов. Штифты и застёжки-бабочки, обеспечивающие фиксацию серёг.',
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
})
