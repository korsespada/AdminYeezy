import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import ChromoffFiltersManager from '@/components/chromoff/ChromoffFiltersManager'
import type { RailsChromoffCategory, RailsChromoffListing } from '@/lib/rails-admin'
import { setChromoffListingFilterAction, updateChromoffCategoryFiltersAction } from '@/actions/chromoff'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))

vi.mock('@/actions/chromoff', () => ({
  setChromoffListingFilterAction: vi.fn(),
  updateChromoffCategoryFiltersAction: vi.fn(),
}))

const root: RailsChromoffCategory = { id: 'root', source_id: 'root', name: 'Одежда', slug: 'odezhda', sort_order: 0, active: true }
const jeans: RailsChromoffCategory = {
  id: 'jeans',
  source_id: 'jeans',
  parent_id: 'root',
  name: 'Джинсы',
  slug: 'dzhinsy',
  sort_order: 0,
  active: true,
  filters: [
    { slug: 'levis', label: "Levi's", keywords: ['levi', '501'] },
    { slug: 'carhartt', label: 'Carhartt', keywords: ['carhartt'] },
  ],
}

function listing(id: string, name: string, metadata: Record<string, unknown> = {}): RailsChromoffListing {
  return { id, name, metadata, source_product_id: id, legacy_slug: id, price_cents: 0, status: 'active', published: true, chromoff_published: true }
}

const listings = [
  listing('a', "Джинсы Levi's 501"),
  listing('b', 'Carhartt B73 Double Knee'),
  listing('c', 'Джинсы True Religion'),
  listing('d', 'Джинсы с крестами', { chromoff_filter: 'carhartt' }),
]

function group(title: string) {
  return screen.getByRole('heading', { name: title }).parentElement!.parentElement!
}

describe('ChromoffFiltersManager', () => {
  it('groups products by keywords and manual overrides', () => {
    render(<ChromoffFiltersManager categories={[root, jeans]} selected={jeans} listings={listings} />)

    expect(within(group("Levi's")).getByText("Джинсы Levi's 501")).toBeInTheDocument()
    expect(within(group("Levi's")).getByText('по слову «levi» в названии')).toBeInTheDocument()
    expect(within(group('Carhartt')).getByText('Джинсы с крестами')).toBeInTheDocument()
    expect(within(group('Carhartt')).getByText('привязан вручную')).toBeInTheDocument()
    expect(within(group('Не попали в фильтры — видны только во «Все»')).getByText('Джинсы True Religion')).toBeInTheDocument()
  })

  it('previews unsaved keywords and saves the edited rules', async () => {
    vi.mocked(updateChromoffCategoryFiltersAction).mockResolvedValue({ success: true, message: 'Фильтры сохранены', filters: [] })
    render(<ChromoffFiltersManager categories={[root, jeans]} selected={jeans} listings={listings} />)

    fireEvent.change(screen.getAllByLabelText('Ключевые слова')[1], { target: { value: 'carhartt, religion' } })

    expect(within(group('Carhartt')).getByText('Джинсы True Religion')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Сохранить/ }))
    await waitFor(() => expect(updateChromoffCategoryFiltersAction).toHaveBeenCalledWith('jeans', [
      { slug: 'levis', label: "Levi's", keywords: ['levi', '501'] },
      { slug: 'carhartt', label: 'Carhartt', keywords: ['carhartt', 'religion'] },
    ]))
  })

  it('pins a product to a filter by hand', async () => {
    vi.mocked(setChromoffListingFilterAction).mockResolvedValue({ success: true, message: 'ok', metadata: { chromoff_filter: 'levis' } })
    render(<ChromoffFiltersManager categories={[root, jeans]} selected={jeans} listings={listings} />)

    fireEvent.change(screen.getByLabelText('Фильтр для «Джинсы True Religion»'), { target: { value: 'levis' } })

    await waitFor(() => expect(within(group("Levi's")).getByText('Джинсы True Religion')).toBeInTheDocument())
    expect(setChromoffListingFilterAction).toHaveBeenCalledWith('c', 'levis')
  })
})
