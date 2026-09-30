import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import VideoMatchesApp from '@/components/video-matches/VideoMatchesApp'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  stats: vi.fn(),
  approve: vi.fn(),
  reject: vi.fn(),
  reset: vi.fn(),
  misses: vi.fn(),
  startApply: vi.fn(),
  stopApply: vi.fn(),
}))

vi.mock('@/actions/video-matches', () => ({
  approveVideoMatchesAction: mocks.approve,
  attachVideoMatchSupplierChunkAction: vi.fn(),
  buildVideoMatchesChunkAction: vi.fn(),
  bulkApproveVideoMatchesAction: vi.fn(),
  getVideoMatchStatsAction: mocks.stats,
  listVideoMatchMissesAction: mocks.misses,
  listVideoMatchesAction: mocks.list,
  rejectVideoMatchesAction: mocks.reject,
  resetApprovedVideoMatchesAction: vi.fn(),
  resetVideoMatchesAction: mocks.reset,
  retryFailedVideoMatchesAction: vi.fn(),
  startVideoMatchApplyAction: mocks.startApply,
  stopVideoMatchApplyAction: mocks.stopApply,
}))

const row = (id: number, name: string) => ({
  id,
  crm_product_id: `00000000-0000-0000-0000-00000000000${id}`,
  crm_slug: `hermes-${id}`,
  crm_name: name,
  crm_category: 'Сумки на плечо',
  crm_status: 'active',
  crm_photo_url: 'https://static.example/photo.webp',
  rank: 1,
  candidates_total: 3,
  confidence: 'exact',
  score: 100,
  source_fields: { style: 'Kelly', colour: '89/Noir', size: '25*20*13', leather: 'Togo', hardware: 'silver' },
  crm_fields: { style: 'Kelly', colour: '89/Noir', size: '25x20x13', leather: 'Togo', hardware: 'silver' },
  differences: [
    { field: 'style', catalog: 'kelly', album: 'kelly', verdict: 'match' },
    { field: 'size', catalog: '25x20x13', album: '25x20x13', verdict: 'match' },
  ],
  status: 'pending',
  video_source_url: 'https://video.example/a.mp4',
  video_poster_url: 'https://video.example/a.jpg',
  s3_video_url: null,
  s3_poster_url: null,
  error: null,
  alternatives: [],
})

const stats = {
  counts: {
    total: 2, pending: 2, pendingAlternatives: 4, approved: 0, applied: 0, rejected: 0, failed: 0,
    exact: 2, strong: 0, probable: 0, singleCandidate: 0, products: 2, withoutCandidates: 0,
  },
  run: null,
  runActive: false,
  scannedProducts: 2,
  albums: 10,
  albumsWithoutFields: 1,
  albumsWithoutVideo: 0,
}

describe('VideoMatchesApp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.stats.mockResolvedValue({ success: true, data: stats })
    mocks.list.mockResolvedValue({ success: true, data: { rows: [row(1, 'Kelly 25'), row(2, 'Birkin 30')], total: 2 } })
    mocks.approve.mockResolvedValue({ success: true, data: { updated: 1 } })
    mocks.startApply.mockResolvedValue({ success: true, data: { started: true } })
    mocks.stopApply.mockResolvedValue({ success: true, data: { stopped: 1 } })
  })

  it('запускает заливку на сервере, а не циклом во вкладке', async () => {
    const user = userEvent.setup()
    mocks.stats.mockResolvedValue({
      success: true,
      data: { ...stats, counts: { ...stats.counts, approved: 5 } },
    })
    render(<VideoMatchesApp />)

    await user.click(await screen.findByRole('button', { name: /Загрузить апрувнутые \(5\)/ }))

    await waitFor(() => expect(mocks.startApply).toHaveBeenCalledWith('hermes', 2))
    expect(await screen.findByText(/Заливка запущена в фоне/)).toBeInTheDocument()
  })

  it('показывает прогресс фоновой заливки и умеет её остановить', async () => {
    const user = userEvent.setup()
    mocks.stats.mockResolvedValue({
      success: true,
      data: {
        ...stats,
        counts: { ...stats.counts, approved: 200, applied: 12 },
        runActive: true,
        run: { status: 'running', batch_size: 4, applied: 12, failed: 1, heartbeat_at: new Date().toISOString(), finished_at: null, last_error: null },
      },
    })
    render(<VideoMatchesApp />)

    expect(await screen.findByText(/Фоновая заливка идёт: привязано за запуск 12/)).toBeInTheDocument()
    const stop = await screen.findByRole('button', { name: /Остановить заливку/ })
    await user.click(stop)

    await waitFor(() => expect(mocks.stopApply).toHaveBeenCalledWith('hermes'))
  })

  it('после одиночного апрува список не перезагружается и строки остаются на месте', async () => {
    const user = userEvent.setup()
    render(<VideoMatchesApp />)

    expect(await screen.findByText('Kelly 25')).toBeInTheDocument()
    expect(await screen.findByText('Birkin 30')).toBeInTheDocument()
    expect(mocks.list).toHaveBeenCalledTimes(1)

    // Кнопка строки называется ровно «Апрувить»; массовые кнопки — длиннее.
    await user.click(screen.getAllByRole('button', { name: 'Апрувить' })[0])

    await waitFor(() => expect(mocks.approve).toHaveBeenCalledWith([1]))
    // Список не перезапрашивается: карточки не размонтируются, скролл не сбрасывается.
    expect(mocks.list).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Загрузка…')).not.toBeInTheDocument()
    expect(screen.getByText('Kelly 25')).toBeInTheDocument()
    expect(screen.getByText('Birkin 30')).toBeInTheDocument()
    // Решение видно прямо в карточке: бейдж статуса и подпись под ним.
    expect((await screen.findAllByText('апрувнуто')).length).toBeGreaterThan(0)
  })

  it('показывает пагинацию и запрашивает соседнюю страницу', async () => {
    const user = userEvent.setup()
    mocks.list.mockResolvedValue({ success: true, data: { rows: [row(1, 'Kelly 25')], total: 130 } })
    render(<VideoMatchesApp />)

    expect(await screen.findByText(/Показано 1–60 из 130/)).toBeInTheDocument()
    expect(screen.getByText(/стр\. 1 из 3/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Вперёд' }))

    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 60 })))
    expect(await screen.findByText(/Показано 61–120 из 130/)).toBeInTheDocument()
  })

  it('объясняет пустой список, когда основные варианты уже апрувнуты', async () => {
    mocks.list.mockResolvedValue({ success: true, data: { rows: [], total: 0 } })
    mocks.stats.mockResolvedValue({
      success: true,
      data: { ...stats, counts: { ...stats.counts, pending: 0, pendingAlternatives: 9, approved: 12 } },
    })
    render(<VideoMatchesApp />)

    expect(await screen.findByText(/Основные варианты уже апрувнуты/)).toBeInTheDocument()
  })
})
