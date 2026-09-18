import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import DavidImportPanel from '@/components/chromoff/DavidImportPanel'

/**
 * Регрессия: после расчёта ИИ черновик приходит пропсом через router.refresh(),
 * а поля ревью — это состояние. Раньше имя и категории оставались прежними, и
 * кнопка «Создать товар» была неактивной до полной перезагрузки страницы.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))

vi.mock('@/actions/david-studio', () => ({
  attachDavidPhotosAction: vi.fn(),
  createDavidChromoffProductAction: vi.fn(),
  excludeDavidPhotoAction: vi.fn(),
  generateDavidDraftAction: vi.fn(),
  markDavidWatermarkAction: vi.fn(),
  clearDavidWatermarkMarkAction: vi.fn(),
  requeueDavidProblemPhotosAction: vi.fn(),
  restoreDavidPhotoAction: vi.fn(),
  searchChromoffProductsAction: vi.fn(),
  startDavidPhotoCleaningAction: vi.fn(),
}))

function draftWith(name: string, updatedAt: string, category: string, chromoff: string) {
  return {
    status: 'ai_ready',
    error: null,
    rails_product_id: null,
    chromoff_listing_id: null,
    updated_at: updatedAt,
    ai_output: {
      name,
      description: `Описание ${name}`,
      category,
      subcategory: category,
      categoryName: 'Ювелирные изделия',
      subcategoryName: 'Браслеты',
      gender: 'unisex',
      attributes: { jewelry_metal: 'Серебро' },
      sizes: ['16 см'],
      measurements: null,
      photoAlts: ['альт'],
      chromoffCategory: { id: chromoff, name: 'Браслеты', confidence: 0.95, status: 'ai_assigned' },
    },
  }
}

const categories = [{ id: 'cat-1', name: 'Ювелирные изделия / Браслеты' }]
const chromoffCategories = [{ id: 'ch-1', name: 'Браслеты' }]

const baseProps = {
  handle: 'chrome-hearts-demo-bracelet',
  title: 'DEMO BRACELET',
  sourceUrl: 'https://www.david-studio.com/products/demo',
  priceLabel: '$500',
  photos: [],
  variantSizes: ['16 см'],
  variantMeasurements: null,
  variantNotSizes: [],
  categories,
  chromoffCategories,
  excluded: [],
}

describe('DavidImportPanel: черновик ИИ приходит без перезагрузки', () => {
  it('подставляет поля и активирует кнопку создания после обновления черновика', () => {
    const { rerender } = render(
      <DavidImportPanel {...baseProps} draft={null as any} />,
    )

    // До расчёта ИИ создавать нечего: кнопка заблокирована.
    expect((screen.getByRole('button', { name: /Создать товар только для Chromoff/ }) as HTMLButtonElement).disabled).toBe(true)

    rerender(
      <DavidImportPanel
        {...baseProps}
        draft={draftWith('Серебряный браслет с крестами', '2026-09-18T10:00:00.000Z', 'cat-1', 'ch-1') as any}
      />,
    )

    const nameInput = screen.getByDisplayValue('Серебряный браслет с крестами') as HTMLInputElement
    expect(nameInput.value).toBe('Серебряный браслет с крестами')
    expect((screen.getByRole('combobox', { name: /Категория каталога/ }) as HTMLSelectElement).value).toBe('cat-1')
    expect((screen.getByRole('combobox', { name: /Категория Chromoff/ }) as HTMLSelectElement).value).toBe('ch-1')
    expect((screen.getByRole('button', { name: /Создать товар только для Chromoff/ }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('не перетирает правки оператора, пока черновик не менялся', () => {
    const draft = draftWith('Первый вариант', '2026-09-18T10:00:00.000Z', 'cat-1', 'ch-1')
    const { rerender } = render(<DavidImportPanel {...baseProps} draft={draft as any} />)
    expect(screen.getByDisplayValue('Первый вариант')).toBeTruthy()

    // Тот же черновик приходит повторно (например, обновился статус фото).
    rerender(<DavidImportPanel {...baseProps} draft={{ ...draft } as any} />)
    expect(screen.getByDisplayValue('Первый вариант')).toBeTruthy()
  })
})
