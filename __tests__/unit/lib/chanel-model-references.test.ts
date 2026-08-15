import { describe, expect, it } from 'vitest'
import { buildBatchAiUserPrompt } from '@/lib/batch-ai'
import { classifyChanelModel, deriveChanelModelReferences } from '@/lib/chanel-model-references'

const product = (description: string, id = 1) => ({
  id,
  name: 'Chanel',
  description,
  photos: Array.from({ length: 10 }, (_, index) => 'https://xcimg.szwego.com/photo-' + id + '-' + index + '.jpg'),
  attributes: {},
})

describe('Chanel model references', () => {
  it('recognizes the box construction as Vanity Case even when text says only lp box', () => {
    expect(classifyChanelModel(product('26a lp盒子牛小黑金 短提手优雅手拎、皮穿链单肩温婉'))?.model_name).toBe('Vanity Case')
  })

  it('keeps one source photo per canonical model', () => {
    const refs = deriveChanelModelReferences([
      product('26a lp盒子牛小黑金', 1),
      product('cf23球浅蓝银', 2),
      product('woc 链条钱包', 3),
    ], 'batch-1')
    expect(refs.map((reference) => reference.model_key)).toEqual(['vanity_case', 'wallet_on_chain', 'classic_flap'])
    expect(refs.every((reference) => reference.reference_images.length === 1)).toBe(true)
  })

  it('tells the AI to use the separate visual model sheet', () => {
    const prompt = buildBatchAiUserPrompt({
      product: product('26a lp盒子牛小黑金'),
      brands: [],
      categories: [],
      subcategories: [],
      attributes: [],
      modelReferences: [{
        model_key: 'vanity_case',
        model_name: 'Vanity Case',
        visual_hint: 'Box construction',
        reference_images: ['https://xcimg.szwego.com/vanity.jpg'],
      }],
    })
    expect(prompt).toContain('Эталоны моделей Chanel')
    expect(prompt).toContain('model_reference_key')
    expect(prompt).toContain('vanity_case')
  })
})

