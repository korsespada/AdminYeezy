import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { within } from '@testing-library/dom'
import AdminHeader from '@/components/ui/AdminHeader'

const usePathname = vi.fn()

vi.mock('next/navigation', () => ({
  usePathname: () => usePathname(),
}))

vi.mock('@/actions/auth', () => ({
  logoutAction: vi.fn(),
}))

describe('AdminHeader', () => {
  beforeEach(() => {
    usePathname.mockReturnValue('/admin/home')
  })

  it('opens core mobile navigation and returns focus when closed', () => {
    render(<AdminHeader />)

    const trigger = screen.getByRole('button', { name: 'Открыть навигацию' })
    fireEvent.click(trigger)

    const navigation = screen.getByRole('navigation', { name: 'Основная навигация' })
    expect(navigation).toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(within(navigation).getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/admin/home')
    expect(within(navigation).getByRole('link', { name: 'Товары' })).toHaveAttribute('href', '/admin')
    expect(within(navigation).getByRole('link', { name: 'Chromoff' })).toHaveAttribute('href', '/admin/chromoff')
    expect(within(navigation).getByRole('link', { name: 'Выгрузки' })).toHaveAttribute('href', '/admin/batches')
    expect(within(navigation).getByRole('link', { name: 'CRM' })).toHaveAttribute('href', '/admin/crm')
    expect(within(navigation).getByRole('button', { name: 'Закрыть навигацию' })).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('navigation', { name: 'Основная навигация' })).not.toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).toHaveFocus()
    expect(document.body.style.overflow).toBe('')
  })

  it('marks the CRM ancestor active and keeps logout separate', () => {
    usePathname.mockReturnValue('/admin/crm/orders')
    render(<AdminHeader />)

    expect(screen.getByRole('link', { name: 'CRM', hidden: true })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Выйти' })).toBeInTheDocument()
  })
})
