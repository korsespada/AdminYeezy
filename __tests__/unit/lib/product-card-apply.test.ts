import { beforeEach, describe, expect, it, vi } from 'vitest'
import { compactCardError, mergeCardPhotoAlts } from '@/lib/product-card-apply'

const patchRailsAdminProduct = vi.fn()
const setRailsAdminProductSlug = vi.fn()
const getRailsAdminProduct = vi.fn()
const markCardUpdateApplied = vi.fn()
const markCardUpdateFailed = vi.fn()
const selectApprovedCardUpdates = vi.fn()

vi.mock('@/lib/rails-admin', () => ({
  patchRailsAdminProduct: (...args: unknown[]) => patchRailsAdminProduct(...args),
  setRailsAdminProductSlug: (...args: unknown[]) => setRailsAdminProductSlug(...args),
  getRailsAdminProduct: (...args: unknown[]) => getRailsAdminProduct(...args),
}))

vi.mock('@/lib/product-card-updates', () => ({
  markCardUpdateApplied: (...args: unknown[]) => markCardUpdateApplied(...args),
  markCardUpdateFailed: (...args: unknown[]) => markCardUpdateFailed(...args),
  selectApprovedCardUpdates: (...args: unknown[]) => selectApprovedCardUpdates(...args),
}))

describe('mergeCardPhotoAlts', () => {
  const snapshot = [
    { original_url: 'https://static/products/a/img_0.webp', alt_text: 'Hermes Lindy' },
    { original_url: 'https://static/products/a/img_1.webp', alt_text: 'Hermes Lindy' },
  ]

  it('подставляет альты по совпадению URL, а не по порядку', () => {
    const fresh = [
      { original_url: 'https://static/products/a/img_1.webp', alt_text: 'старый' },
      { original_url: 'https://static/products/a/img_0.webp', alt_text: 'старый' },
      { original_url: 'https://static/products/a/img_new.webp', alt_text: 'новое фото' },
    ]
    const merged = mergeCardPhotoAlts(fresh, ['Альт 0', 'Альт 1'], snapshot)
    expect(merged.map((item) => item.alt_text)).toEqual(['Альт 1', 'Альт 0', 'новое фото'])
  })

  it('сохраняет светлый альт нового фото, которого не было в снимке', () => {
    const merged = mergeCardPhotoAlts(
      [{ original_url: 'https://static/products/a/extra.webp', alt_text: 'Свежий альт' }],
      ['Альт 0'],
      snapshot,
    )
    expect(merged[0].alt_text).toBe('Свежий альт')
  })
})

describe('compactCardError', () => {
  it('обрезает длинный ответ Rails', () => {
    const long = 'x'.repeat(900)
    expect(compactCardError(new Error(long)).length).toBeLessThanOrEqual(501)
  })

  it('переживает пустую ошибку', () => {
    expect(compactCardError(null)).toBe('ошибка применения')
  })
})

describe('applyCardUpdateOnce', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const row = {
    id: 7,
    crm_product_id: 'product-1',
    current_name: 'Lindy 26',
    current_slug: 'hermes-lindy-26-her-10993',
    current_description: 'Стиль: Lindy',
    current_attributes: { colors: { display_value: 'etoupe' } },
    current_media: [{ original_url: 'https://static/products/a/img_0.webp', alt_text: 'Hermes Lindy' }],
    proposed_name: 'Lindy 26 18/Etoupe',
    proposed_slug: 'hermes-lindy-26-18-etoupe-gold-clemence-her-10993',
    proposed_description: 'Сумка Lindy 26: материал Clemence, цвет 18/Etoupe.',
    proposed_attributes: { model_name: 'Lindy', dimensions: '26 × 18 × 12 см' },
    proposed_photo_alts: ['Розовая сумка Lindy 26 из кожи Clemence, вид спереди'],
  } as any

  it('пишет содержимое карточки и отдельно закрепляет адрес', async () => {
    getRailsAdminProduct.mockResolvedValue({
      name: row.current_name,
      media: [{ original_url: 'https://static/products/a/img_0.webp', alt_text: 'Hermes Lindy' }],
    })
    patchRailsAdminProduct.mockResolvedValue({})
    setRailsAdminProductSlug.mockResolvedValue({ slug: 'hermes-lindy-26-18-etoupe-gold-clemence-her-10993' })

    const { applyCardUpdateOnce } = await import('@/lib/product-card-apply')
    const result = await applyCardUpdateOnce({ ...row, ai_status: 'ready' })

    expect(patchRailsAdminProduct).toHaveBeenCalledTimes(1)
    const [productId, payload] = patchRailsAdminProduct.mock.calls[0]
    expect(productId).toBe('product-1')
    expect(payload.name).toBe('Lindy 26 18/Etoupe')
    expect(payload.description).toBe('Сумка Lindy 26: материал Clemence, цвет 18/Etoupe.')
    expect(payload.catalog_attributes).toEqual({ model_name: 'Lindy', dimensions: '26 × 18 × 12 см' })
    expect(payload.media[0].alt_text).toBe('Розовая сумка Lindy 26 из кожи Clemence, вид спереди')

    expect(setRailsAdminProductSlug).toHaveBeenCalledWith(
      'product-1',
      'hermes-lindy-26-18-etoupe-gold-clemence-her-10993',
    )
    expect(result.slug).toBe('hermes-lindy-26-18-etoupe-gold-clemence-her-10993')
  })

  it('останавливает применение, если карточку изменили после скана', async () => {
    getRailsAdminProduct.mockResolvedValue({
      name: 'Lindy 26 18/Etoupe (правка оператора)',
      media: row.current_media,
    })

    const { applyCardUpdateOnce } = await import('@/lib/product-card-apply')
    await expect(applyCardUpdateOnce({ ...row, ai_status: 'ready' })).rejects.toThrow(/изменилась после скана/)
    expect(patchRailsAdminProduct).not.toHaveBeenCalled()
    expect(setRailsAdminProductSlug).not.toHaveBeenCalled()
  })

  it('повторяет применение, если наше название уже записано', async () => {
    getRailsAdminProduct.mockResolvedValue({ name: row.proposed_name, media: row.current_media })
    patchRailsAdminProduct.mockResolvedValue({})
    setRailsAdminProductSlug.mockResolvedValue({ slug: row.proposed_slug })

    const { applyCardUpdateOnce } = await import('@/lib/product-card-apply')
    await applyCardUpdateOnce({ ...row, ai_status: 'pending' })

    expect(setRailsAdminProductSlug).toHaveBeenCalledWith('product-1', row.proposed_slug)
  })

  it('не заменяет описание черновиком, пока ИИ не отработал', async () => {
    getRailsAdminProduct.mockResolvedValue({ name: row.current_name, media: row.current_media })
    patchRailsAdminProduct.mockResolvedValue({})
    setRailsAdminProductSlug.mockResolvedValue({ slug: row.proposed_slug })

    const { applyCardUpdateOnce } = await import('@/lib/product-card-apply')
    await applyCardUpdateOnce({ ...row, ai_status: 'pending' })

    const payload = patchRailsAdminProduct.mock.calls[0][1]
    expect(payload.description).toBeUndefined()
    expect(payload.name).toBe('Lindy 26 18/Etoupe')
  })

  it('применяет порцию апрувнутых карточек и отмечает результат', async () => {
    selectApprovedCardUpdates.mockResolvedValue([row])
    getRailsAdminProduct.mockResolvedValue({ name: row.current_name, media: row.current_media })
    patchRailsAdminProduct.mockResolvedValue({})
    setRailsAdminProductSlug.mockResolvedValue({ slug: row.proposed_slug })

    const { applyApprovedCardUpdates } = await import('@/lib/product-card-apply')
    const result = await applyApprovedCardUpdates('supplier-uuid', 5)

    expect(result).toMatchObject({ processed: 1, applied: 1, failed: 0 })
    expect(markCardUpdateApplied).toHaveBeenCalledWith(7, row.proposed_slug)
    expect(markCardUpdateFailed).not.toHaveBeenCalled()
  })
})
