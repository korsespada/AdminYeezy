import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import AdminLaunchpad from '@/components/dashboard/AdminLaunchpad'

describe('AdminLaunchpad', () => {
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
    expect(screen.getByRole('link', { name: 'Открыть раздел: AI SEO' })).toHaveAttribute('href', '/admin/seo-ai')
    expect(screen.getByText('Готов к CRM/API')).toBeInTheDocument()
    expect(screen.getByText('Нужен SCRAPING_DATABASE_URL')).toBeInTheDocument()
    expect(screen.getByText('120')).toBeInTheDocument()
    expect(screen.getByText('24')).toBeInTheDocument()
    expect(screen.getByText('18')).toBeInTheDocument()
  })
})
