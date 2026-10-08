import { LoaderCircle } from 'lucide-react'

/**
 * Скелет раздела админки. Показывается мгновенно при переходе между разделами,
 * пока сервер собирает данные из Rails и scraping-БД: без него клик по разделу
 * выглядел как зависшая страница на всё время запросов.
 */
export default function AdminSectionLoading({
  title,
  variant = 'cards',
}: {
  title?: string
  variant?: 'cards' | 'rows'
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Загрузка раздела"
      className="min-h-full min-w-0 bg-slate-900 p-4 text-slate-200 sm:p-6"
    >
      <div className="mx-auto flex max-w-[1600px] flex-col gap-4">
        <div className="flex items-center gap-3 px-1 text-sm font-medium text-indigo-300">
          <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
          <span>{title ? `Открываем «${title}»…` : 'Открываем раздел…'}</span>
        </div>

        {variant === 'cards' ? (
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <div
                key={index}
                className="animate-pulse overflow-hidden rounded-xl border border-slate-800 bg-slate-900"
                style={{ animationDelay: `${index * 60}ms` }}
              >
                <div className="aspect-[4/3] bg-slate-800" />
                <div className="space-y-2 p-3">
                  <div className="h-3 w-1/3 rounded-full bg-slate-800" />
                  <div className="h-4 w-4/5 rounded-full bg-slate-800" />
                  <div className="h-3 w-2/3 rounded-full bg-slate-800/80" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
            {Array.from({ length: 8 }).map((_, index) => (
              <div
                key={index}
                className="flex animate-pulse items-center gap-4 border-b border-slate-800/70 px-4 py-3 last:border-b-0"
                style={{ animationDelay: `${index * 60}ms` }}
              >
                <div className="h-12 w-12 shrink-0 rounded-lg bg-slate-800" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="h-4 w-2/3 rounded-full bg-slate-800" />
                  <div className="h-3 w-1/3 rounded-full bg-slate-800/80" />
                </div>
                <div className="hidden h-4 w-16 shrink-0 rounded-full bg-slate-800 sm:block" />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
