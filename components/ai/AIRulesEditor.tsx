'use client'

import { useState, useTransition } from 'react'
import type { ReactNode } from 'react'
import { BookOpen, Bot, CheckCircle2, Cpu, Image, Save, Server, ShieldAlert } from 'lucide-react'
import { updateBatchAiSettingsAction } from '@/actions/batch-ai'
import type { BatchAiSettings } from '@/lib/batch-ai'
import { BATCH_AI_CATEGORY_RULES } from '@/lib/batch-ai-category-rules'

type WorkerState = {
  available?: boolean
  model?: string | null
  heartbeat_at?: string | null
} | null

type Props = {
  initialSettings: BatchAiSettings & {
    cockpitWorker?: WorkerState
    credentials?: {
      openrouter?: boolean
      byesuGemini?: boolean
      byesuOpenai?: boolean
      byesuLegacy?: boolean
      seekai?: boolean
      stepfun?: boolean
    }
  }
}

const BYESU_MODELS = [
  { value: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite', group: 'Gemini Business' },
  { value: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', group: 'OpenAI Codex' },
] as const

const SEEKAI_MODELS = [
  { value: 'gpt-5-6-luna', label: 'GPT-5.6 Luna' },
  { value: 'gemini-3-flash', label: 'Gemini 3 Flash' },
] as const

export default function AIRulesEditor({ initialSettings }: Props) {
  const [settings, setSettings] = useState<BatchAiSettings>({
    provider: initialSettings.provider,
    openrouterModel: initialSettings.openrouterModel,
    byesuModel: initialSettings.byesuModel,
    seekaiModel: initialSettings.seekaiModel,
    stepfunModel: initialSettings.stepfunModel,
    temperature: initialSettings.temperature,
    maxTokens: initialSettings.maxTokens,
    concurrency: initialSettings.concurrency,
    systemPrompt: initialSettings.systemPrompt,
  })
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [pending, startTransition] = useTransition()
  const worker = initialSettings.cockpitWorker
  const credentials = initialSettings.credentials
  const selectedByesuGroup = settings.byesuModel.toLowerCase().startsWith('gemini') ? 'gemini' : 'openai'
  const selectedByesuKeyReady = selectedByesuGroup === 'gemini'
    ? credentials?.byesuGemini
    : credentials?.byesuOpenai

  const update = <K extends keyof BatchAiSettings>(key: K, value: BatchAiSettings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }))
  }

  const save = () => startTransition(async () => {
    setMessage(null)
    const result = await updateBatchAiSettingsAction(settings)
    setMessage(result.success
      ? {
          type: 'success',
          text: `Настройки сохранены. Новые тесты используют ${
            settings.provider === 'byesu'
              ? settings.byesuModel
              : settings.provider === 'seekai'
                ? settings.seekaiModel
                : settings.provider === 'stepfun'
                  ? settings.stepfunModel
                : settings.provider === 'openrouter'
                ? settings.openrouterModel
                : worker?.model || 'модель Cockpit worker'
          }; продолжение уже выполненного теста сохраняет его прежний snapshot.`,
        }
      : { type: 'error', text: result.error || 'Не удалось сохранить настройки' })
  })

  return (
    <div className="space-y-6 pb-24 animate-in fade-in duration-300">
      <div className="grid gap-4 md:grid-cols-3">
        <InfoCard icon={Image} title="Опциональные фото 3×3">
          Для каждого поставщика можно включить фото. Без галочки AI работает только с китайским текстом.
        </InfoCard>
        <InfoCard icon={Bot} title="Промпт + правила категорий">
          Общий промпт задаёт формат и качество, а классификация подключается отдельно по категории товара.
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
            <div className="grid gap-3 sm:grid-cols-5">
              <ProviderButton
                active={settings.provider === 'byesu'}
                title="BYESU API"
                description={`Gemini ${credentials?.byesuGemini ? '✓' : '—'} · OpenAI ${credentials?.byesuOpenai ? '✓' : '—'}`}
                onClick={() => update('provider', 'byesu')}
              />
              <ProviderButton
                active={settings.provider === 'openrouter'}
                title="OpenRouter"
                description={credentials?.openrouter ? 'Ключ подключён' : 'Ключ не задан'}
                onClick={() => update('provider', 'openrouter')}
              />
              <ProviderButton
                active={settings.provider === 'seekai'}
                title="SeekAI"
                description={credentials?.seekai ? 'Резервный ключ подключён' : 'Ключ не задан'}
                onClick={() => update('provider', 'seekai')}
              />
              <ProviderButton
                active={settings.provider === 'stepfun'}
                title="StepFun"
                description={credentials?.stepfun ? 'Резервный ключ подключён' : 'Ключ не задан'}
                onClick={() => update('provider', 'stepfun')}
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
            {settings.provider === 'byesu' && (
              <>
                <label htmlFor="batch-ai-byesu-model" className="text-xs font-bold uppercase tracking-widest text-slate-500">
                  Модель BYESU
                </label>
                <select
                  id="batch-ai-byesu-model"
                  value={settings.byesuModel}
                  onChange={(event) => update('byesuModel', event.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none focus:border-indigo-500"
                >
                  {!BYESU_MODELS.some((model) => model.value === settings.byesuModel) && (
                    <option value={settings.byesuModel}>{settings.byesuModel}</option>
                  )}
                  {BYESU_MODELS.map((model) => (
                    <option key={model.value} value={model.value}>{model.label} · {model.group}</option>
                  ))}
                </select>
                <div className={`rounded-xl border p-3 text-sm ${
                  selectedByesuKeyReady
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                    : 'border-amber-500/30 bg-amber-500/10 text-amber-200'
                }`}>
                  <div className="font-semibold">
                    {selectedByesuGroup === 'gemini' ? 'Группа Gemini Business' : 'Группа OpenAI Codex'}
                  </div>
                  <p className="mt-1">
                    {selectedByesuKeyReady
                      ? 'Нужный API-ключ подключён.'
                      : `Добавьте ${selectedByesuGroup === 'gemini' ? 'BYESU_GEMINI_API_KEY' : 'BYESU_OPENAI_API_KEY'} в Coolify.`}
                  </p>
                </div>
                <p className="text-xs leading-relaxed text-slate-500">
                  BYESU привязывает ключ к группе. Ключи задаются один раз глобально в Coolify и автоматически выбираются по модели — в поставщиках их вводить не нужно.
                </p>
              </>
            )}

            {settings.provider === 'openrouter' && (
              <>
                <label htmlFor="batch-ai-model" className="text-xs font-bold uppercase tracking-widest text-slate-500">
                  Модель OpenRouter
                </label>
                <input
                  id="batch-ai-model"
                  value={settings.openrouterModel}
                  onChange={(event) => update('openrouterModel', event.target.value)}
                  placeholder="google/gemini-2.5-flash"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 font-mono text-sm text-white outline-none focus:border-indigo-500"
                />
              </>
            )}

            {settings.provider === 'seekai' && (
              <>
                <label htmlFor="batch-ai-seekai-model" className="text-xs font-bold uppercase tracking-widest text-slate-500">
                  Модель SeekAI
                </label>
                <select
                  id="batch-ai-seekai-model"
                  value={settings.seekaiModel}
                  onChange={(event) => update('seekaiModel', event.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none focus:border-indigo-500"
                >
                  {!SEEKAI_MODELS.some((model) => model.value === settings.seekaiModel) && (
                    <option value={settings.seekaiModel}>{settings.seekaiModel}</option>
                  )}
                  {SEEKAI_MODELS.map((model) => (
                    <option key={model.value} value={model.value}>{model.label}</option>
                  ))}
                </select>
                <p className="text-xs leading-relaxed text-slate-500">
                  Резервный OpenAI-совместимый поставщик. Ключ задаётся глобально в окружении как SEEKAI_API_KEY.
                </p>
              </>
            )}

            {settings.provider === 'stepfun' && (
              <>
                <label htmlFor="batch-ai-stepfun-model" className="text-xs font-bold uppercase tracking-widest text-slate-500">
                  Модель StepFun
                </label>
                <input
                  id="batch-ai-stepfun-model"
                  value={settings.stepfunModel}
                  onChange={(event) => update('stepfunModel', event.target.value)}
                  placeholder="step-3.7-flash"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 font-mono text-sm text-white outline-none focus:border-indigo-500"
                />
                <p className="text-xs leading-relaxed text-slate-500">
                  Резервный OpenAI-совместимый поставщик. Ключ задаётся глобально в окружении как STEPFUN_API_KEY.
                </p>
              </>
            )}

            {settings.provider === 'cockpit' && (
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
            )}
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
            <span className="block text-xs text-slate-500">Общий лимит для OpenRouter, BYESU, SeekAI, StepFun и Cockpit. Поставщик может запретить параллельную обработку.</span>
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
              Общие требования к SEO, атрибутам, фотографиям и формату ответа. Классификация категорий хранится отдельно ниже.
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

      <section className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-800 shadow-xl">
        <header className="flex items-center gap-3 border-b border-slate-700 bg-slate-800/50 p-6">
          <div className="rounded-lg border border-violet-500/20 bg-violet-500/10 p-2 text-violet-400">
            <BookOpen size={24} />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold text-white">Автоматические правила категорий</h2>
              <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2.5 py-1 text-xs font-bold text-violet-200">
                {BATCH_AI_CATEGORY_RULES.length} набора
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-400">
              Подключаются только к товару соответствующей категории и имеют приоритет над инструкцией поставщика.
            </p>
          </div>
        </header>
        <div className="grid gap-4 p-6 lg:grid-cols-2">
          {BATCH_AI_CATEGORY_RULES.map((rule) => (
            <details key={rule.categoryName} className="group rounded-xl border border-slate-700 bg-slate-950/60 open:border-violet-500/30">
              <summary className="cursor-pointer list-none p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="rounded-md bg-violet-500/10 px-2 py-1 text-xs font-bold text-violet-300">{rule.categoryName}</span>
                      <span className="font-semibold text-white">{rule.title}</span>
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-slate-400">{rule.description}</p>
                  </div>
                  <span className="text-lg text-slate-500 transition group-open:rotate-45">+</span>
                </div>
              </summary>
              <pre className="whitespace-pre-wrap border-t border-slate-800 px-4 py-4 font-sans text-sm leading-relaxed text-slate-300">
                {rule.rules}
              </pre>
            </details>
          ))}
        </div>
        <div className="border-t border-slate-700 px-6 py-4 text-sm text-slate-500">
          Для остальных категорий пока действует только общий системный промпт. Новые наборы добавляются сюда по мере появления реальных сценариев.
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
