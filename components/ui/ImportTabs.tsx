'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BarChart3, Ruler, Users, Package, Settings2 } from 'lucide-react'

const PRIMARY_TABS = [
  { label: 'История выгрузок', href: '/admin/batches', icon: Package },
  { label: 'Поставщики', href: '/admin/suppliers', icon: Users },
]

// Вспомогательные разделы выгрузок стоят справа, рядом с «Настройками ИИ».
const TOOL_TABS = [
  { label: 'Шаблоны замеров', href: '/admin/measurement-templates', icon: Ruler },
  { label: 'Использование', href: '/admin/ai-usage', icon: BarChart3 },
  { label: 'Настройки ИИ', href: '/admin/ai-rules', icon: Settings2 },
]

function isTabActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`)
}

export default function ImportTabs() {
  const pathname = usePathname() || ''

  return (
    <div className="mb-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex w-fit max-w-full overflow-x-auto rounded-xl border border-slate-700 bg-slate-800/50 p-1">
          {PRIMARY_TABS.map((tab) => {
            const isActive = isTabActive(pathname, tab.href)
            const Icon = tab.icon
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-6 py-2.5 text-sm font-medium transition-all ${
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

        <div className="flex max-w-full flex-wrap gap-2">
          {TOOL_TABS.map((tab) => {
            const isActive = isTabActive(pathname, tab.href)
            const Icon = tab.icon
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`flex items-center gap-2 whitespace-nowrap rounded-xl border px-4 py-2.5 text-sm font-medium transition-all ${
                  isActive
                  ? 'border-amber-500/30 bg-amber-500/20 text-amber-400'
                  : 'border-slate-700 bg-slate-800 text-slate-400 hover:border-slate-600 hover:text-white'
                }`}
              >
                <Icon size={18} />
                {tab.label}
              </Link>
            )
          })}
        </div>
      </div>
    </div>
  )
}
