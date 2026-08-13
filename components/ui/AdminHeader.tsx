'use client'

import React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { Menu, RefreshCw, BarChart3, LogOut, Trash2, Sparkles, ClipboardList, ListChecks, SlidersHorizontal, Gem, X, PackageSearch } from 'lucide-react'
import { logoutAction } from '@/actions/auth'
import { Button } from '@/components/ui/button'

const coreNavigation = [
  { href: '/admin/home', label: 'Home', icon: PackageSearch, tone: 'text-indigo-300' },
  { href: '/admin', label: 'Товары', icon: PackageSearch, tone: 'text-sky-300' },
  { href: '/admin/chromoff', label: 'Chromoff', icon: Gem, tone: 'text-violet-300' },
  { href: '/admin/batches', label: 'Выгрузки', icon: RefreshCw, tone: 'text-orange-300' },
  { href: '/admin/crm', label: 'CRM', icon: ClipboardList, tone: 'text-sky-300' },
]

const utilityNavigation = [
  { href: '/admin/analytics', label: 'Аналитика', icon: BarChart3, tone: 'text-indigo-400' },
  { href: '/admin/seo-ai', label: 'AI-каталог', icon: Sparkles, tone: 'text-fuchsia-400' },
  { href: '/admin/catalog-attributes', label: 'Атрибуты', icon: ListChecks, tone: 'text-emerald-400' },
  { href: '/admin/filter-characteristics', label: 'Схема', icon: SlidersHorizontal, tone: 'text-cyan-400' },
  { href: '/admin/trash', label: 'Корзина', icon: Trash2, tone: 'text-red-400' },
]

function isActive(pathname: string, href: string) {
  return href === '/admin/home' || href === '/admin'
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`)
}

export default function AdminHeader() {
  const pathname = usePathname()
  const sticky = !/^\/admin\/batches\/[^/]+/.test(pathname || '')
  const [menuOpen, setMenuOpen] = useState(false)
  const menuTriggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLElement>(null)
  const closeMenu = () => setMenuOpen(false)

  useEffect(() => {
    if (!menuOpen) return

    const previousOverflow = document.body.style.overflow
    const shell = document.querySelector<HTMLElement>('.admin-shell')
    const previousShellOverflowY = shell?.style.overflowY
    document.body.style.overflow = 'hidden'
    if (shell) shell.style.overflowY = 'hidden'
    const firstFocusable = menuRef.current?.querySelector<HTMLElement>('a, button')
    firstFocusable?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setMenuOpen(false)
        return
      }

      if (event.key !== 'Tab' || !menuRef.current) return
      const focusable = Array.from(menuRef.current.querySelectorAll<HTMLElement>('a, button'))
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      if (shell) shell.style.overflowY = previousShellOverflowY ?? ''
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  useEffect(() => {
    if (!menuOpen) menuTriggerRef.current?.focus()
  }, [menuOpen])

  return (
    <>
      <header className={`${sticky ? 'sticky top-0 z-30' : 'relative'} flex min-w-0 items-center gap-2 border-b border-slate-700 bg-slate-800 px-3 py-2 shadow-sm sm:px-4 xl:px-6`}>
        <Button
          ref={menuTriggerRef}
          variant="ghost"
          size="icon"
          onClick={() => setMenuOpen(true)}
          aria-label="Открыть навигацию"
          aria-expanded={menuOpen}
          aria-controls="admin-mobile-navigation"
          className="h-11 w-11 shrink-0 text-slate-300 hover:bg-slate-700 hover:text-white lg:hidden"
        >
          <Menu className="h-5 w-5" />
        </Button>

        <Link href="/admin/home" aria-label="Yeezy Unique, Home" aria-current={isActive(pathname || '', '/admin/home') ? 'page' : undefined} className="flex min-h-11 min-w-0 shrink-0 items-center rounded-md px-1 py-1 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">
          <h1 className="flex items-center gap-1 text-base font-bold text-slate-100 sm:text-xl">
            <span className="text-indigo-500">Yeezy</span>
            <span>Unique</span>
            <span className="ml-1 hidden text-sm font-normal text-slate-500 sm:inline">Админка</span>
          </h1>
        </Link>

        <nav aria-label="Навигация рабочего стола" className="hidden min-w-0 flex-1 items-center justify-end gap-1 lg:flex xl:gap-2">
          {coreNavigation.slice(1).map((item) => <NavigationLink key={item.href} item={item} pathname={pathname || ''} />)}
          <div className="ml-1 hidden min-w-0 items-center gap-1 xl:flex">
            {utilityNavigation.map((item) => <NavigationLink key={item.href} item={item} pathname={pathname || ''} utility />)}
          </div>
        </nav>

        <form action={logoutAction} className="ml-auto flex shrink-0 items-center">
          <Button
            variant="ghost"
            size="icon"
            type="submit"
            aria-label="Выйти"
            title="Выйти"
            className="h-11 w-11 text-slate-300 hover:bg-red-400/10 hover:text-red-400"
          >
            <LogOut size={20} />
          </Button>
        </form>
      </header>
      {menuOpen && (
        <div id="admin-mobile-navigation" className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Основная навигация">
          <div aria-hidden="true" className="absolute inset-0 bg-slate-950/75" onClick={closeMenu} />
          <nav
            ref={menuRef}
            aria-label="Основная навигация"
            className="relative flex h-full w-[min(22rem,calc(100vw-2rem))] min-w-0 flex-col overflow-y-auto border-r border-slate-700 bg-slate-900 p-4 pt-[calc(1rem+env(safe-area-inset-top))] shadow-2xl"
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <span className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-400">Разделы</span>
              <Button type="button" variant="ghost" size="icon" aria-label="Закрыть навигацию" onClick={closeMenu} className="h-11 w-11 text-slate-300 hover:bg-slate-800 hover:text-white">
                <X className="h-5 w-5" />
              </Button>
            </div>
            <div className="flex flex-col gap-1">
              {coreNavigation.map((item) => <MobileNavigationLink key={item.href} item={item} pathname={pathname || ''} onNavigate={closeMenu} />)}
            </div>
          </nav>
        </div>
      )}
    </>
  )
}

function NavigationLink({
  item,
  pathname,
  utility = false,
}: {
  item: (typeof coreNavigation)[number]
  pathname: string
  utility?: boolean
}) {
  const active = isActive(pathname, item.href)
  const Icon = item.icon
  return (
    <Button asChild variant="ghost" size="sm" className={`min-h-11 shrink-0 px-2 text-xs ${active ? 'bg-slate-700 text-white' : 'text-slate-400 hover:bg-slate-700/50 hover:text-white'} ${utility ? 'hidden 2xl:inline-flex' : ''}`}>
      <Link href={item.href} aria-current={active ? 'page' : undefined} title={item.label}>
        <Icon size={18} className={item.tone} />
        <span>{item.label}</span>
      </Link>
    </Button>
  )
}

function MobileNavigationLink({
  item,
  pathname,
  onNavigate,
}: {
  item: (typeof coreNavigation)[number]
  pathname: string
  onNavigate: () => void
}) {
  const active = isActive(pathname, item.href)
  const Icon = item.icon
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={`flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${active ? 'bg-indigo-500/15 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}
    >
      <Icon size={19} className={item.tone} />
      <span>{item.label}</span>
    </Link>
  )
}
