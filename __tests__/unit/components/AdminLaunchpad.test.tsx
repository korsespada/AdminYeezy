import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import AdminLaunchpad from '@/components/dashboard/AdminLaunchpad'

describe('AdminLaunchpad', () => {
  it('keeps launchpad cards as the required navigable core route map', () => {
    render(
      <AdminLaunchpad
        railsConfigured={false}
        scrapingConfigured={false}
      />
    )

    expect(screen.getByRole('link', { name: 'Открыть раздел: Товары' })).toHaveAttribute('href', '/admin')
    expect(screen.getByRole('link', { name: 'Открыть раздел: Chromoff' })).toHaveAttribute('href', '/admin/chromoff')
    expect(screen.getByRole('link', { name: 'Открыть раздел: CRM' })).toHaveAttribute('href', '/admin/crm')
    expect(screen.getByRole('link', { name: 'Открыть раздел: Выгрузки' })).toHaveAttribute('href', '/admin/batches')
  })

  it('distinguishes an unavailable configured source from an unconfigured source', () => {
    render(
      <AdminLaunchpad
        railsConfigured
        scrapingConfigured
        railsStatus="unavailable"
        scrapingStatus="connected"
      />,
    )

    expect(screen.getByText('Недоступен, данные не загружены')).toBeInTheDocument()
    expect(screen.getByText('Подключена, техническая БД доступна')).toBeInTheDocument()
    expect(screen.getAllByText('—')).toHaveLength(3)
  })

  it('renders core admin sections and environment status', () => {
    render(
      <AdminLaunchpad
        railsConfigured
        scrapingConfigured={false}
        productCount={120}
        brandCount={24}
        categoryCount={18}
      />
    )

    expect(screen.getByRole('heading', { name: 'Операционная панель' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Открыть раздел: Товары' })).toHaveAttribute('href', '/admin')
    expect(screen.getByRole('link', { name: 'Открыть раздел: CRM' })).toHaveAttribute('href', '/admin/crm')
    expect(screen.getByRole('link', { name: 'Открыть раздел: Выгрузки' })).toHaveAttribute('href', '/admin/batches')
    expect(screen.getByRole('link', { name: 'Открыть раздел: Поставщики' })).toHaveAttribute('href', '/admin/suppliers')
    expect(screen.getByRole('link', { name: 'Открыть раздел: AI-каталог' })).toHaveAttribute('href', '/admin/seo-ai')
    expect(screen.getByRole('link', { name: 'Открыть раздел: Бренды' })).toHaveAttribute('href', '/admin/brands')
    expect(screen.getByRole('link', { name: 'Открыть раздел: Категории' })).toHaveAttribute('href', '/admin/categories')
    expect(screen.getByRole('link', { name: 'Открыть раздел: Атрибуты товаров' })).toHaveAttribute('href', '/admin/catalog-attributes')
    expect(screen.getByRole('link', { name: 'Открыть раздел: Схема атрибутов' })).toHaveAttribute('href', '/admin/filter-characteristics')
    expect(screen.getByRole('link', { name: 'Открыть раздел: Правила AI' })).toHaveAttribute('href', '/admin/ai-rules')
    expect(screen.queryByRole('link', { name: 'Открыть раздел: Гендер' })).not.toBeInTheDocument()
    expect(screen.getByText('Подключён, CRM/API доступны')).toBeInTheDocument()
    expect(screen.getByText('Не настроена: нужен SCRAPING_DATABASE_URL')).toBeInTheDocument()
    expect(screen.getByText('120')).toBeInTheDocument()
    expect(screen.getByText('24')).toBeInTheDocument()
    expect(screen.getByText('18')).toBeInTheDocument()
  })
})
