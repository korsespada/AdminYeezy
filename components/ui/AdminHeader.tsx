'use client'

import React from 'react'
import Link from 'next/link'
import { Menu, RefreshCw, BarChart3, LogOut, FileSpreadsheet } from 'lucide-react'
import { logoutAction } from '@/actions/auth'

interface AdminHeaderProps {
  onMenuClick?: () => void
}

export default function AdminHeader({ onMenuClick }: AdminHeaderProps) {
  return (
    <header className="bg-slate-800 border-b border-slate-700 py-3 px-6 sticky top-0 z-30 flex items-center justify-between shadow-sm">
      <div className="flex items-center gap-4">
        {onMenuClick && (
          <button
            onClick={onMenuClick}
            className="lg:hidden p-2 text-slate-400 hover:bg-slate-700 hover:text-white rounded-lg"
          >
            <Menu className="w-5 h-5" />
          </button>
        )}
        <div className="hidden sm:block">
          <Link href="/admin" className="hover:opacity-80 transition-opacity">
            <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
              <span className="text-indigo-500">Yeezy</span>
              <span>Unique</span>
              <span className="text-slate-500 text-sm font-normal ml-2">Админка</span>
            </h1>
          </Link>
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-4">
        <Link
          href="/admin/batches"
          className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-slate-400 hover:text-white hover:bg-slate-700/50 rounded-lg transition-all"
          title="Выгрузка и парсинг"
        >
          <RefreshCw size={20} className="text-orange-400" />
          <span className="hidden md:inline">Выгрузка</span>
        </Link>

        <Link
          href="/admin/analytics"
          className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-slate-400 hover:text-white hover:bg-slate-700/50 rounded-lg transition-all"
          title="Аналитика"
        >
          <BarChart3 size={20} className="text-indigo-400" />
          <span className="hidden md:inline">Аналитика</span>
        </Link>

        <div className="h-6 w-px bg-slate-700 mx-1"></div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 pl-2 pr-1 py-1 rounded-full bg-slate-700/30 border border-slate-700">
            <div className="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center text-indigo-400 font-bold text-xs border border-indigo-500/30">
              AD
            </div>
            <span className="text-sm font-medium text-slate-300 hidden sm:block pr-2">Admin</span>
          </div>

          <form action={logoutAction} className="flex items-center">
            <button
              type="submit"
              title="Выйти"
              className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-all"
            >
              <LogOut size={20} />
            </button>
          </form>
        </div>
      </div>
    </header>
  )
}
