'use client'

import { useState, useTransition } from 'react'
import type { ReactNode } from 'react'
import { Bot, CheckCircle2, Cpu, Image, Save, Server, ShieldAlert } from 'lucide-react'
import { updateBatchAiSettingsAction } from '@/actions/batch-ai'
import type { BatchAiSettings } from '@/lib/batch-ai'

type WorkerState = {
  available?: boolean
  model?: string | null
  heartbeat_at?: string | null
} | null

type Props = {
  initialSettings: BatchAiSettings & { cockpitWorker?: WorkerState }
}

export default function AIRulesEditor({ initialSettings }: Props) {
  const [settings, setSettings] = useState<BatchAiSettings>({
    provider: initialSettings.provider,
    openrouterModel: initialSettings.openrouterModel,
    temperature: initialSettings.temperature,
    maxTokens: initialSettings.maxTokens,
    concurrency: initialSettings.concurrency,
    systemPrompt: initialSettings.systemPrompt,
  })
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [pending, startTransition] = useTransition()
  const worker = initialSettings.cockpitWorker

  const update = <K extends keyof BatchAiSettings>(key: K, value: BatchAiSettings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }))
  }

  const save = () => startTransition(async () => {
    setMessage(null)
    const result = await updateBatchAiSettingsAction(settings)
    setMessage(result.success
      ? { type: 'success', text: 'Настройки AI-обработки сохранены' }
      : { type: 'error', text: result.error || 'Не удалось сохранить настройки' })
  })

  return (
    <div className="space-y-6 pb-24 animate-in fade-in duration-300">
      <div className="grid gap-4 md:grid-cols-3">
        <InfoCard icon={Image} title="Опциональные фото 3×3">
          Для каждого поставщика можно включить фото. Без галочки AI работает только с китайским текстом.
        </InfoCard>
        <InfoCard icon={Bot} title="Один общий промпт">
          Инструкции поставщика только дополняют этот системный промпт особенностями его выгрузки.
        </InfoCard>
        <InfoCard icon={CheckCircle2} title="Snapshot на запуск">
          Тестовые 10 товаров и продолжение используют одинаковые зафиксированные настройки.
        </InfoCard>
      </div>

      <section className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-800 shadow-xl">
        <header className="flex items-center gap-3 border-b border-slate-700 bg-slate-800/50 p-6">
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-2 text-emerald-400">
            <Cpu size={24} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">Провайдер и модель</h2>
            <p className="mt-1 text-sm text-slate-400">Выбор применяется ко всем новым AI-запускам в разделе «Выгрузки».</p>
          </div>
        </header>

        <div className="grid gap-5 p-6 lg:grid-cols-2">
          <div className="space-y-3">
            <span className="text-xs font-bold uppercase tracking-widest text-slate-500">Провайдер</span>
            <div className="grid gap-3 sm:grid-cols-2">
              <ProviderButton
                active={settings.provider === 'openrouter'}
                title="OpenRouter"
                description="Обработка через облачную модель"
                onClick={() => update('provider', 'openrouter')}
              />
              <ProviderButton
                active={settings.provider === 'cockpit'}
                title="Cockpit локальный"
                description="Обработка локальным worker"
                onClick={() => update('provider', 'cockpit')}
              />
            </div>
          </div>

          <div className="space-y-3">
            <label htmlFor="batch-ai-model" className="text-xs font-bold uppercase tracking-widest text-slate-500">
              Модель OpenRouter
            </label>
            <input
              id="batch-ai-model"
              value={settings.openrouterModel}
              onChange={(event) => update('openrouterModel', event.target.value)}
              disabled={settings.provider !== 'openrouter'}
              placeholder="google/gemini-2.5-flash"
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 font-mono text-sm text-white outline-none focus:border-indigo-500 disabled:opacity-50"
            />
            <div className={`rounded-xl border p-3 text-sm ${
              worker?.available
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                : 'border-slate-700 bg-slate-950/60 text-slate-400'
            }`}>
              <div className="flex items-center gap-2 font-semibold"><Server size={16} /> Cockpit worker</div>
              <p className="mt-1">
                {worker?.available ? `Онлайн · ${worker.model || 'модель не сообщена'}` : 'Не подключён · запуск Cockpit будет отклонён после 30 секунд без heartbeat'}
              </p>
            </div>
          </div>

          <label className="space-y-2 text-sm text-slate-300">
            <span>Temperature</span>
            <input
              type="number"
              min="0"
              max="2"
              step="0.05"
              value={settings.temperature}
              onChange={(event) => update('temperature', Number(event.target.value))}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-indigo-500"
            />
          </label>
          <label className="space-y-2 text-sm text-slate-300">
            <span>Максимум токенов</span>
            <input
              type="number"
              min="1000"
              max="20000"
              step="100"
              value={settings.maxTokens}
              onChange={(event) => update('maxTokens', Number(event.target.value))}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-indigo-500"
            />
          </label>
          <label className="space-y-2 text-sm text-slate-300 lg:col-span-2">
            <span>Одновременных AI-запросов</span>
            <input
              type="number"
              min="1"
              max="10"
              step="1"
              value={settings.concurrency}
              onChange={(event) => update('concurrency', Number(event.target.value))}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-indigo-500"
            />
            <span className="block text-xs text-slate-500">Общий лимит для OpenRouter и Cockpit. Поставщик может запретить параллельную обработку.</span>
          </label>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-800 shadow-xl">
        <header className="flex items-center gap-3 border-b border-slate-700 bg-slate-800/50 p-6">
          <div className="rounded-lg border border-indigo-500/20 bg-indigo-500/10 p-2 text-indigo-400">
            <Bot size={24} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">Системный промпт китайского каталога</h2>
            <p className="mt-1 text-sm text-slate-400">
              Определяет SEO-поля, классификацию, атрибуты, фильтрацию фото, таблицы размеров и предложения цветовых вариантов.
            </p>
          </div>
        </header>
        <div className="space-y-4 p-6">
          <textarea
            aria-label="Системный промпт китайского каталога"
            value={settings.systemPrompt}
            onChange={(event) => update('systemPrompt', event.target.value)}
            className="min-h-[520px] w-full resize-y rounded-2xl border border-slate-700 bg-slate-950 px-6 py-5 font-mono text-sm leading-relaxed text-slate-200 outline-none focus:border-indigo-500/60 focus:ring-4 focus:ring-indigo-500/5"
          />
          <div className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-200">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            Изменение действует только на новые запуски. Уже начатая тестовая обработка продолжится со своим snapshot настроек.
          </div>
        </div>
      </section>

      {message && (
        <div className={`rounded-xl border px-5 py-3 text-sm font-medium shadow-xl ${
          message.type === 'success'
            ? 'border-emerald-500/30 bg-emerald-950 text-emerald-300'
            : 'border-red-500/30 bg-red-950 text-red-200'
        }`}>
          {message.text}
        </div>
      )}

      <div className="sticky bottom-4 z-40 flex justify-end">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="inline-flex items-center gap-3 rounded-2xl bg-indigo-600 px-10 py-4 font-bold text-white shadow-2xl shadow-indigo-600/40 transition hover:bg-indigo-500 disabled:opacity-50"
        >
          {pending ? <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : <Save size={22} />}
          Сохранить настройки
        </button>
      </div>
    </div>
  )
}

function InfoCard({ icon: Icon, title, children }: { icon: typeof Bot; title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/70 p-4">
      <div className="flex items-center gap-2 font-semibold text-white"><Icon className="h-4 w-4 text-indigo-400" /> {title}</div>
      <p className="mt-2 text-sm leading-relaxed text-slate-400">{children}</p>
    </div>
  )
}

function ProviderButton({ active, title, description, onClick }: {
  active: boolean
  title: string
  description: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border p-4 text-left transition ${
        active
          ? 'border-indigo-500 bg-indigo-500/10 text-white shadow-lg'
          : 'border-slate-700 bg-slate-950/50 text-slate-400 hover:border-slate-600'
      }`}
    >
      <span className="flex items-center justify-between font-semibold">
        {title}
        {active && <CheckCircle2 className="h-4 w-4 text-indigo-400" />}
      </span>
      <span className="mt-1 block text-xs text-slate-500">{description}</span>
    </button>
  )
}
