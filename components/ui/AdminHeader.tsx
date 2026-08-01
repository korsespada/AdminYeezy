'use client'

import React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu, RefreshCw, BarChart3, LogOut, Trash2, Sparkles, ClipboardList, ListChecks, SlidersHorizontal } from 'lucide-react'
import { logoutAction } from '@/actions/auth'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'

interface AdminHeaderProps {
  onMenuClick?: () => void
}

export default function AdminHeader({ onMenuClick }: AdminHeaderProps) {
  const pathname = usePathname()
  const sticky = !/^\/admin\/batches\/[^/]+/.test(pathname || '')

  return (
    <header className={`${sticky ? 'sticky top-0 z-30' : 'relative'} flex min-w-0 items-center gap-2 border-b border-slate-700 bg-slate-800 px-2 py-3 shadow-sm sm:px-4 xl:px-6`}>
      <div className="flex shrink-0 items-center gap-4">
        {onMenuClick && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onMenuClick}
            className="lg:hidden text-slate-400 hover:bg-slate-700 hover:text-white"
          >
            <Menu className="w-5 h-5" />
          </Button>
        )}
        <div className="hidden sm:block">
          <Link href="/admin/home" className="hover:opacity-80 transition-opacity">
            <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
              <span className="text-indigo-500">Yeezy</span>
              <span>Unique</span>
              <span className="text-slate-500 text-sm font-normal ml-2">Админка</span>
            </h1>
          </Link>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-end gap-1 overflow-x-auto [scrollbar-width:none] sm:gap-2 [&::-webkit-scrollbar]:hidden">
        <Button asChild variant="ghost" size="sm" className="text-slate-400 hover:bg-slate-700/50 hover:text-white" title="CRM">
          <Link href="/admin/crm">
            <ClipboardList size={20} className="text-sky-400" />
            <span className="hidden min-[2100px]:inline">CRM</span>
          </Link>
        </Button>

        <Button asChild variant="ghost" size="sm" className="text-slate-400 hover:bg-slate-700/50 hover:text-white" title="Выгрузка и парсинг">
          <Link href="/admin/batches">
            <RefreshCw size={20} className="text-orange-400" />
            <span className="hidden min-[2100px]:inline">Выгрузка</span>
          </Link>
        </Button>

        <Button asChild variant="ghost" size="sm" className="text-slate-400 hover:bg-slate-700/50 hover:text-white" title="Аналитика">
          <Link href="/admin/analytics">
            <BarChart3 size={20} className="text-indigo-400" />
            <span className="hidden min-[2100px]:inline">Аналитика</span>
          </Link>
        </Button>

        <Button asChild variant="ghost" size="sm" className="text-slate-400 hover:bg-slate-700/50 hover:text-white" title="AI SEO Studio">
          <Link href="/admin/seo-ai">
            <Sparkles size={20} className="text-fuchsia-400" />
            <span className="hidden min-[2100px]:inline">AI-каталог</span>
          </Link>
        </Button>

        <Button asChild variant="ghost" size="sm" className="text-slate-400 hover:bg-slate-700/50 hover:text-white" title="Атрибуты товаров">
          <Link href="/admin/catalog-attributes">
            <ListChecks size={20} className="text-emerald-400" />
            <span className="hidden min-[2100px]:inline">Атрибуты</span>
          </Link>
        </Button>

        <Button asChild variant="ghost" size="sm" className="text-slate-400 hover:bg-slate-700/50 hover:text-white" title="Схема атрибутов">
          <Link href="/admin/filter-characteristics">
            <SlidersHorizontal size={20} className="text-cyan-400" />
            <span className="hidden min-[2100px]:inline">Схема</span>
          </Link>
        </Button>

        <Button asChild variant="ghost" size="sm" className="text-slate-400 hover:bg-slate-700/50 hover:text-white" title="Корзина">
          <Link href="/admin/trash">
            <Trash2 size={20} className="text-red-400" />
            <span className="hidden min-[2100px]:inline">Корзина</span>
          </Link>
        </Button>

        <Separator orientation="vertical" className="mx-1 hidden h-6 bg-slate-700 min-[2100px]:block" />

        <div className="flex shrink-0 items-center gap-1 min-[2100px]:gap-3">
          <div className="hidden items-center gap-2 rounded-full border border-slate-700 bg-slate-700/30 py-1 pl-2 pr-1 min-[2100px]:flex">
            <div className="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center text-indigo-400 font-bold text-xs border border-indigo-500/30">
              AD
            </div>
            <span className="text-sm font-medium text-slate-300 hidden sm:block pr-2">Admin</span>
          </div>

          <form action={logoutAction} className="flex items-center">
            <Button
              variant="ghost"
              size="icon"
              type="submit"
              title="Выйти"
              className="text-slate-400 hover:bg-red-400/10 hover:text-red-400"
            >
              <LogOut size={20} />
            </Button>
          </form>
        </div>
      </div>
    </header>
  )
}
