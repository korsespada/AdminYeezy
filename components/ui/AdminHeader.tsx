'use client'

import React from 'react'
import Link from 'next/link'
import { Menu, RefreshCw, BarChart3, LogOut, Trash2, Tags, Sparkles, ClipboardList } from 'lucide-react'
import { logoutAction } from '@/actions/auth'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'

interface AdminHeaderProps {
  onMenuClick?: () => void
}

export default function AdminHeader({ onMenuClick }: AdminHeaderProps) {
  return (
    <header className="bg-slate-800 border-b border-slate-700 py-3 px-6 sticky top-0 z-30 flex items-center justify-between shadow-sm">
      <div className="flex items-center gap-4">
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

      <div className="flex items-center gap-2 sm:gap-4">
        <Button asChild variant="ghost" size="sm" className="text-slate-400 hover:bg-slate-700/50 hover:text-white" title="CRM">
          <Link href="/admin/crm">
            <ClipboardList size={20} className="text-sky-400" />
            <span className="hidden md:inline">CRM</span>
          </Link>
        </Button>

        <Button asChild variant="ghost" size="sm" className="text-slate-400 hover:bg-slate-700/50 hover:text-white" title="Выгрузка и парсинг">
          <Link href="/admin/batches">
            <RefreshCw size={20} className="text-orange-400" />
            <span className="hidden md:inline">Выгрузка</span>
          </Link>
        </Button>

        <Button asChild variant="ghost" size="sm" className="text-slate-400 hover:bg-slate-700/50 hover:text-white" title="Аналитика">
          <Link href="/admin/analytics">
            <BarChart3 size={20} className="text-indigo-400" />
            <span className="hidden md:inline">Аналитика</span>
          </Link>
        </Button>

        <Button asChild variant="ghost" size="sm" className="text-slate-400 hover:bg-slate-700/50 hover:text-white" title="Проставление гендера">
          <Link href="/admin/gender-backfill">
            <Tags size={20} className="text-emerald-400" />
            <span className="hidden md:inline">Гендер</span>
          </Link>
        </Button>

        <Button asChild variant="ghost" size="sm" className="text-slate-400 hover:bg-slate-700/50 hover:text-white" title="AI SEO Studio">
          <Link href="/admin/seo-ai">
            <Sparkles size={20} className="text-fuchsia-400" />
            <span className="hidden md:inline">AI SEO</span>
          </Link>
        </Button>

        <Button asChild variant="ghost" size="sm" className="text-slate-400 hover:bg-slate-700/50 hover:text-white" title="Корзина">
          <Link href="/admin/trash">
            <Trash2 size={20} className="text-red-400" />
            <span className="hidden md:inline">Корзина</span>
          </Link>
        </Button>

        <Separator orientation="vertical" className="mx-1 h-6 bg-slate-700" />

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 pl-2 pr-1 py-1 rounded-full bg-slate-700/30 border border-slate-700">
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
