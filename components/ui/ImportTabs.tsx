'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Users, ArrowLeft, Package, Settings2, FlaskConical } from 'lucide-react'

export default function ImportTabs() {
  const pathname = usePathname()

  const tabs = [
    { label: 'История выгрузок', href: '/admin/batches', icon: Package },
    { label: 'Выгрузка 2.0', href: '/admin/exports-v2', icon: FlaskConical },
    { label: 'Поставщики', href: '/admin/suppliers', icon: Users },
  ]

  return (
    <div className="mb-8 space-y-4">
      <div className="flex items-center justify-between">
        <Link 
          href="/admin" 
          className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors text-sm font-medium group"
        >
          <div className="p-1.5 bg-slate-800 rounded group-hover:bg-slate-700 transition-colors">
            <ArrowLeft size={16} />
          </div>
          Назад к товарам
        </Link>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex bg-slate-800/50 p-1 rounded-xl w-fit border border-slate-700 overflow-x-auto">
          {tabs.map((tab) => {
            const isActive = pathname === tab.href || pathname.startsWith(`${tab.href}/`)
            const Icon = tab.icon
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
                  isActive 
                  ? 'bg-indigo-600 text-white shadow-lg' 
                  : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Icon size={18} />
                {tab.label}
              </Link>
            )
          })}
        </div>

        <Link
          href="/admin/ai-rules"
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl border text-sm font-medium transition-all ${
            pathname === '/admin/ai-rules'
            ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
            : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white hover:border-slate-600'
          }`}
        >
          <Settings2 size={18} />
          Настройки ИИ
        </Link>
      </div>
    </div>
  )
}
