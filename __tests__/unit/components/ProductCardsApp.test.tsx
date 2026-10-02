import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ProductCardsApp from '@/components/video-matches/ProductCardsApp'

const mocks = vi.hoisted(() => ({
  suppliers: vi.fn(),
  stats: vi.fn(),
  list: vi.fn(),
  scan: vi.fn(),
  ai: vi.fn(),
  decide: vi.fn(),
  approveSafe: vi.fn(),
  apply: vi.fn(),
  clear: vi.fn(),
  getPrompt: vi.fn(),
  savePrompt: vi.fn(),
  aiRun: vi.fn(),
  startAiRun: vi.fn(),
  stopAiRun: vi.fn(),
}))

vi.mock('@/actions/product-card-updates', () => ({
  listProductCardSuppliersAction: mocks.suppliers,
  getProductCardStatsAction: mocks.stats,
  listProductCardsAction: mocks.list,
  scanProductCardsChunkAction: mocks.scan,
  runProductCardsAiAction: mocks.ai,
  decideProductCardsAction: mocks.decide,
  approveSafeProductCardsAction: mocks.approveSafe,
  applyProductCardsChunkAction: mocks.apply,
  clearPendingProductCardsAction: mocks.clear,
  getProductCardPromptAction: mocks.getPrompt,
  saveProductCardPromptAction: mocks.savePrompt,
  getProductCardsAiRunAction: mocks.aiRun,
  startProductCardsAiRunAction: mocks.startAiRun,
  stopProductCardsAiRunAction: mocks.stopAiRun,
}))

const counts = {
  total: 2204, pending: 2190, approved: 0, applied: 0, rejected: 0, failed: 0,
  bags: 1897, shoes: 307, aiReady: 14, aiPending: 2190, aiFailed: 0, withWarnings: 57,
}

const supplier = {
  key: 'hermes',
  title: 'Hermes — карточки по правилам выгрузки',
  supplierName: 'Hermes',
  brandSlug: 'hermes',
  categories: 20,
  counts,
  promptStored: true,
  promptLength: 120,
}

const row = {
  id: 5,
  crm_product_id: '11111111-1111-1111-1111-111111111111',
  current_name: 'Lindy 26',
  current_slug: 'hermes-lindy-26-her-10993',
  current_description: 'Стиль: Lindy\nЦвет: 18/etoupe',
  current_media: [{ original_url: 'https://static.example.test/img_0.webp', alt_text: 'Hermes Lindy' }],
  proposed_name: 'Lindy 26 18/Etoupe',
  proposed_slug: 'hermes-lindy-26-18-etoupe-gold-clemence-her-10993',
  proposed_description: 'Сумка Lindy 26 в цвете 18/Etoupe.',
  proposed_photo_alts: ['Сумка Hermes Lindy 26 в цвете Etoupe, вид спереди'],
  attribute_patch: { model_name: 'Lindy', dimensions: '26 × 18 × 12 см' },
  warnings: [],
  category: 'Сумки на плечо',
  kind: 'bag',
  status: 'pending',
  ai_status: 'ready',
  ai_model: 'gemini',
  ai_error: null,
  error: null,
}

describe('ProductCardsApp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.suppliers.mockResolvedValue({ success: true, data: { suppliers: [supplier] } })
    mocks.stats.mockResolvedValue({ success: true, data: { counts } })
    mocks.list.mockResolvedValue({ success: true, data: { rows: [row], total: 1 } })
    mocks.decide.mockResolvedValue({ success: true, data: { updated: 1 } })
    mocks.getPrompt.mockResolvedValue({
      success: true,
      data: {
        supplierName: 'Hermes',
        stored: 'Промпт Hermes: цвет во внутренней форме 18/Etoupe.',
        fallback: 'Подсказка Hermes по умолчанию.',
        effective: 'Промпт Hermes: цвет во внутренней форме 18/Etoupe.',
        packagingStored: 'Комплектация: коробка, пыльник, бутиковый сет.',
        packagingFallback: 'Комплектация Hermes по умолчанию.',
        packaging: 'Комплектация: коробка, пыльник, бутиковый сет.',
        base: 'Базовые требования.',
      },
    })
    mocks.savePrompt.mockResolvedValue({
      success: true,
      data: { stored: 'Новый промпт', effective: 'Новый промпт', packagingStored: 'Новая комплектация', packaging: 'Новая комплектация' },
    })
    mocks.aiRun.mockResolvedValue({
      success: true,
      data: {
        run: { status: 'idle', batch_size: 4, processed: 0, failed: 0, model: null, started_at: null, heartbeat_at: null, finished_at: null, last_error: null },
        active: false,
        remaining: 2186,
        aiReady: 18,
        aiFailed: 0,
      },
    })
    mocks.startAiRun.mockResolvedValue({ success: true, data: { run: { status: 'running' } } })
    mocks.stopAiRun.mockResolvedValue({ success: true, data: { stopped: 1 } })
  })

  it('показывает строки поставщиков с прогрессом ИИ', async () => {
    render(<ProductCardsApp />)

    expect(await screen.findByText('Hermes')).toBeInTheDocument()
    expect(screen.getByText(/ИИ готово/)).toBeInTheDocument()
    expect(screen.getByText(/промпт:/)).toBeInTheDocument()
    expect(screen.getByText(/свой \(120 знаков\)/)).toBeInTheDocument()
  })

  it('открывает поставщика и показывает карточки «сейчас / станет»', async () => {
    render(<ProductCardsApp />)
    await userEvent.click(await screen.findByText('Hermes'))

    expect(await screen.findByText('Lindy 26 18/Etoupe')).toBeInTheDocument()
    expect(screen.getByText('hermes-lindy-26-18-etoupe-gold-clemence-her-10993')).toBeInTheDocument()
    expect(screen.getByText('Модель:')).toBeInTheDocument()
    expect(screen.getByText('Габариты:')).toBeInTheDocument()
    expect(screen.getByText('ИИ готово · gemini')).toBeInTheDocument()
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ presetKey: 'hermes', limit: 50 }))
  })

  it('фильтрует по статусу ИИ', async () => {
    render(<ProductCardsApp />)
    await userEvent.click(await screen.findByText('Hermes'))
    await screen.findByText('Lindy 26 18/Etoupe')

    await userEvent.selectOptions(screen.getByDisplayValue('ИИ: любой'), 'pending')

    await waitFor(() => expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ aiStatus: 'pending' })))
  })

  it('сохраняет промпт поставщика', async () => {
    render(<ProductCardsApp />)
    await userEvent.click(await screen.findByText('Hermes'))
    await screen.findByText('Lindy 26 18/Etoupe')

    await userEvent.click(screen.getByRole('button', { name: /Промпт поставщика/ }))
    const textarea = await screen.findByDisplayValue(/Промпт Hermes/)
    await userEvent.clear(textarea)
    await userEvent.type(textarea, 'Новый промпт')
    await userEvent.click(screen.getByRole('button', { name: /Сохранить/ }))

    await waitFor(() => expect(mocks.savePrompt).toHaveBeenCalledWith(
      'hermes',
      'Новый промпт',
      'Комплектация: коробка, пыльник, бутиковый сет.',
    ))
  })

  it('запускает фоновый прогон ИИ по всем карточкам', async () => {
    render(<ProductCardsApp />)
    await userEvent.click(await screen.findByText('Hermes'))
    await screen.findByText('Lindy 26 18/Etoupe')

    await userEvent.click(screen.getByRole('button', { name: /ИИ по всем/ }))

    await waitFor(() => expect(mocks.startAiRun).toHaveBeenCalledWith('hermes', 4))
  })

  it('показывает прогресс прогона ИИ', async () => {
    mocks.aiRun.mockResolvedValue({
      success: true,
      data: {
        run: { status: 'running', batch_size: 4, processed: 120, failed: 3, model: 'gemini-3.8-flash-high', started_at: null, heartbeat_at: null, finished_at: null, last_error: 'таймаут провайдера' },
        active: true,
        remaining: 2066,
        aiReady: 138,
        aiFailed: 3,
      },
    })
    render(<ProductCardsApp />)
    await userEvent.click(await screen.findByText('Hermes'))

    expect(await screen.findByText('Прогон ИИ по всем:')).toBeInTheDocument()
    expect(screen.getByText('идёт')).toBeInTheDocument()
    expect(screen.getByText('обработано 120')).toBeInTheDocument()
    expect(screen.getByText('осталось 2066')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Пауза ИИ/ })).toBeInTheDocument()
  })

  it('апрувит карточку и перезагружает очередь', async () => {
    render(<ProductCardsApp />)
    await userEvent.click(await screen.findByText('Hermes'))
    await screen.findByText('Lindy 26 18/Etoupe')

    const buttons = screen.getAllByRole('button', { name: /Апрувить/ })
    await userEvent.click(buttons[buttons.length - 1])

    await waitFor(() => expect(mocks.decide).toHaveBeenCalledWith([5], 'approve'))
  })
})
