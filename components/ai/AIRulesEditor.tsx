'use client'

import { useState, useTransition } from 'react'
import type { ReactNode } from 'react'
import { BookOpen, Bot, CheckCircle2, Cpu, Image, Pencil, PlayCircle, Plus, RefreshCw, Save, ShieldAlert, Trash2, X } from 'lucide-react'
import { createAiProviderAction, updateAiProviderPricingAction, updateAiProviderReasoningAction, createBatchAiCatalogCategoryAction, createBatchAiCatalogSubcategoryAction, deleteAiProviderAction, refreshAiProviderModelsAction, testAiProviderAction, updateAiProviderAction, updateBatchAiSettingsAction } from '@/actions/batch-ai'
import type { BatchAiSettings } from '@/lib/batch-ai'
import type { BatchAiCategoryRule } from '@/lib/batch-ai-category-rules'
import type { AiProviderRecord } from '@/lib/ai-providers'
import { supportsReasoningToggle, type AiReasoningMode } from '@/lib/ai-reasoning'
import { builtinPeakPrice, normalizeModelName, type AiPricingTable } from '@/lib/ai-usage-pricing'
import type { Category, Subcategory } from '@/lib/types'

type Props = {
  initialSettings: BatchAiSettings & {
    providers?: AiProviderRecord[]
  }
  initialCategories: Category[]
  initialSubcategories: Subcategory[]
}

export default function AIRulesEditor({ initialSettings, initialCategories, initialSubcategories }: Props) {
  const [settings, setSettings] = useState<BatchAiSettings>({
    provider: initialSettings.provider,
    activeProviderId: initialSettings.activeProviderId || null,
    providerId: initialSettings.activeProviderId || undefined,
    openrouterModel: initialSettings.openrouterModel,
    byesuModel: initialSettings.byesuModel,
    temperature: initialSettings.temperature,
    maxTokens: initialSettings.maxTokens,
    concurrency: initialSettings.concurrency,
    systemPrompt: initialSettings.systemPrompt,
    categoryRules: initialSettings.categoryRules,
  })
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [pending, startTransition] = useTransition()
  const [providers, setProviders] = useState<AiProviderRecord[]>(initialSettings.providers || [])
  const [showProviderForm, setShowProviderForm] = useState(false)
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null)
  const [providerTest, setProviderTest] = useState<{ id: string; type: 'pending' | 'success' | 'error'; text: string } | null>(null)
  const [providerForm, setProviderForm] = useState({
    name: '', baseUrl: '', apiKey: '', model: '',
  })
  const [categories, setCategories] = useState(initialCategories)
  const [subcategories, setSubcategories] = useState(initialSubcategories)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [newSubcategoryName, setNewSubcategoryName] = useState('')
  const [newSubcategoryParentId, setNewSubcategoryParentId] = useState(initialCategories[0]?.id || '')
  const activeSavedProvider = providers.find((provider) => provider.id === settings.activeProviderId)
  // Старые записи могли сохраниться с kind='byesu': модель тогда лежит в byesuModel.
  const modelKey: 'byesuModel' | 'openrouterModel' = settings.provider === 'byesu' ? 'byesuModel' : 'openrouterModel'
  const selectedModel = settings[modelKey]

  const update = <K extends keyof BatchAiSettings>(key: K, value: BatchAiSettings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }))
  }

  const clearActiveProvider = () => {
    setSettings((current) => ({ ...current, activeProviderId: null, providerId: undefined }))
  }

  const selectSavedProvider = (provider: AiProviderRecord) => {
    setSettings((current) => ({
      ...current,
      provider: provider.kind,
      activeProviderId: provider.id,
      providerId: provider.id,
      ...(provider.kind === 'byesu' ? { byesuModel: provider.model } : { openrouterModel: provider.model }),
    }))
  }

  const openProviderForm = (provider?: AiProviderRecord) => {
    setMessage(null)
    setEditingProviderId(provider?.id || null)
    setProviderForm(provider
      ? { name: provider.name, baseUrl: provider.baseUrl, apiKey: '', model: provider.model }
      : { name: '', baseUrl: '', apiKey: '', model: '' })
    setShowProviderForm(true)
  }

  const saveProvider = () => startTransition(async () => {
    setMessage(null)
    const result = editingProviderId
      ? await updateAiProviderAction({ ...providerForm, id: editingProviderId })
      : await createAiProviderAction(providerForm)
    if (!result.success) {
      setMessage({ type: 'error', text: result.error || 'Не удалось сохранить провайдера' })
      return
    }
    const provider = result.data as AiProviderRecord
    setProviders((current) => editingProviderId
      ? current.map((item) => item.id === provider.id ? provider : item)
      : [provider, ...current])
    selectSavedProvider(provider)
    setProviderForm({ name: '', baseUrl: '', apiKey: '', model: '' })
    setEditingProviderId(null)
    setShowProviderForm(false)
    setMessage({ type: 'success', text: `Провайдер «${provider.name}» сохранён. Нажмите «Сохранить настройки».` })
  })

  const testProvider = (provider: AiProviderRecord) => startTransition(async () => {
    setProviderTest({ id: provider.id, type: 'pending', text: 'Проверяем подключение…' })
    setMessage(null)
    const result = await testAiProviderAction(provider.id)
    if (result.success) {
      const text = `Подключение работает · модель: ${result.data?.model}`
      setProviderTest({ id: provider.id, type: 'success', text })
      setMessage({ type: 'success', text: `Провайдер «${provider.name}» работает. Модель: ${result.data?.model}.` })
    } else {
      const text = result.error || 'Не удалось проверить провайдера'
      setProviderTest({ id: provider.id, type: 'error', text })
      setMessage({ type: 'error', text })
    }
  })

  const removeProvider = (provider: AiProviderRecord) => {
    if (!window.confirm(`Удалить провайдера «${provider.name}»?`)) return
    startTransition(async () => {
      const result = await deleteAiProviderAction(provider.id)
      if (!result.success) {
        setMessage({ type: 'error', text: result.error || 'Не удалось удалить провайдера' })
        return
      }
      setProviders((current) => current.filter((item) => item.id !== provider.id))
      if (settings.activeProviderId === provider.id) clearActiveProvider()
      setMessage({ type: 'success', text: `Провайдер «${provider.name}» удалён.` })
    })
  }

  const refreshModels = (provider: AiProviderRecord) => startTransition(async () => {
    const result = await refreshAiProviderModelsAction(provider.id)
    if (!result.success) {
      setMessage({ type: 'error', text: result.error || 'Не удалось получить модели' })
      return
    }
    setProviders((current) => current.map((item) => item.id === provider.id ? { ...item, models: result.data?.models || [] } : item))
    setMessage({ type: 'success', text: `Список моделей обновлён: ${result.data?.models?.length || 0}.` })
  })

  const updateCategoryRule = (id: string, patch: Partial<BatchAiCategoryRule>) => {
    update('categoryRules', settings.categoryRules.map((rule) => rule.id === id ? { ...rule, ...patch } : rule))
  }

  const addCategoryRule = () => {
    const category = categories[0]
    if (!category) {
      setMessage({ type: 'error', text: 'Сначала добавьте категорию.' })
      return
    }
    update('categoryRules', [...settings.categoryRules, {
      id: crypto.randomUUID(),
      categoryName: category.name,
      title: `Правила: ${category.name}`,
      description: '',
      rules: '',
    }])
  }

  const createCategory = () => startTransition(async () => {
    const result = await createBatchAiCatalogCategoryAction(newCategoryName)
    if (!result.success || !result.data) {
      setMessage({ type: 'error', text: result.error || 'Не удалось создать категорию' })
      return
    }
    const category = { ...result.data, description: '', created: '', updated: '', collectionId: '', collectionName: 'categories' } as Category
    setCategories((current) => [...current, category].sort((left, right) => left.name.localeCompare(right.name, 'ru')))
    setNewCategoryName('')
    setNewSubcategoryParentId(category.id)
    setMessage({ type: 'success', text: `Категория «${category.name}» создана в Rails. Добавьте правило и сохраните настройки.` })
  })

  const createSubcategory = () => startTransition(async () => {
    const result = await createBatchAiCatalogSubcategoryAction(newSubcategoryName, newSubcategoryParentId)
    if (!result.success || !result.data) {
      setMessage({ type: 'error', text: result.error || 'Не удалось создать подкатегорию' })
      return
    }
    const subcategory = { ...result.data, category: result.data.parent_id, description: '', created: '', updated: '', collectionId: '', collectionName: 'subcategories' } as Subcategory
    setSubcategories((current) => [...current, subcategory].sort((left, right) => left.name.localeCompare(right.name, 'ru')))
    setNewSubcategoryName('')
    setMessage({ type: 'success', text: `Подкатегория «${subcategory.name}» создана в Rails и доступна AI.` })
  })

  const save = () => startTransition(async () => {
    setMessage(null)
    if (!activeSavedProvider) {
      setMessage({ type: 'error', text: 'Выберите AI-провайдера или добавьте нового.' })
      return
    }
    const result = await updateBatchAiSettingsAction(settings)
    setMessage(result.success
      ? {
          type: 'success',
          text: `Настройки сохранены. Новые запуски используют «${activeSavedProvider.name}» · ${selectedModel}.`,
        }
      : { type: 'error', text: result.error || 'Не удалось сохранить настройки' })
  })

  return (
    <div className="space-y-6 pb-24 animate-in fade-in duration-300">
      <div className="grid gap-4 md:grid-cols-3">
        <InfoCard icon={Image} title="Фото 3×3">
          AI всегда получает коллаж фотографий товара вместе с китайским текстом.
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
          <div className="space-y-3 lg:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <span className="text-xs font-bold uppercase tracking-widest text-slate-500">Провайдеры</span>
                <p className="mt-1 text-xs text-slate-500">Ключ хранится в БД зашифрованным и никогда не показывается обратно.</p>
              </div>
              <button type="button" onClick={() => openProviderForm()} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500">
                <Plus className="h-4 w-4" /> Добавить AI-провайдера
              </button>
            </div>
            {providers.length > 0 ? (
              <div className="grid gap-3 md:grid-cols-2">
                {providers.map((provider) => (
                  <div key={provider.id} className={`rounded-xl border p-4 ${settings.activeProviderId === provider.id ? 'border-indigo-500 bg-indigo-500/10' : 'border-slate-700 bg-slate-950/50'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <button type="button" onClick={() => selectSavedProvider(provider)} className="min-w-0 text-left">
                        <div className="truncate font-semibold text-white">{provider.name}</div>
                        <div className="mt-1 truncate font-mono text-xs text-slate-500">{provider.baseUrl}</div>
                        <div className="mt-2 text-xs text-emerald-300">API-ключ сохранён · {provider.models.length ? `${provider.models.length} моделей` : 'модели не загружены'}</div>
                      </button>
                      <div className="flex shrink-0 items-center gap-1">
                        <button type="button" onClick={() => testProvider(provider)} disabled={pending} className="rounded-lg p-2 text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300 disabled:opacity-50" title="Проверить подключение"><PlayCircle className="h-4 w-4" /></button>
                        <button type="button" onClick={() => openProviderForm(provider)} disabled={pending} className="rounded-lg p-2 text-indigo-300 hover:bg-indigo-500/10 hover:text-indigo-200 disabled:opacity-50" title="Редактировать провайдера"><Pencil className="h-4 w-4" /></button>
                        <button type="button" onClick={() => refreshModels(provider)} disabled={pending} className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-50" title="Обновить список моделей"><RefreshCw className="h-4 w-4" /></button>
                        <button type="button" onClick={() => removeProvider(provider)} disabled={pending} className="rounded-lg p-2 text-red-400 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-50" title="Удалить провайдера"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </div>
                    {providerTest?.id === provider.id && (
                      <div role="status" className={`mt-3 rounded-lg border px-3 py-2 text-xs leading-relaxed ${
                        providerTest.type === 'success'
                          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                          : providerTest.type === 'error'
                            ? 'border-red-500/30 bg-red-950/50 text-red-200'
                            : 'border-indigo-500/30 bg-indigo-500/10 text-indigo-200'
                      }`}>
                        {providerTest.text}
                      </div>
                    )}
                    {settings.activeProviderId === provider.id && <div className="mt-3 text-xs font-semibold text-indigo-300">Выбран для новых AI-запусков</div>}
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-700 px-4 py-5 text-sm text-slate-500">Провайдеров пока нет. Нажмите «Добавить AI-провайдера» и укажите название, Base URL и API-ключ.</div>
            )}
          </div>

          <div className="space-y-3">
            {activeSavedProvider ? (
              <>
                <label htmlFor="batch-ai-model" className="text-xs font-bold uppercase tracking-widest text-slate-500">
                  Модель «{activeSavedProvider.name}»
                </label>
                {activeSavedProvider.models.length ? <select
                  id="batch-ai-model"
                  value={selectedModel}
                  onChange={(event) => update(modelKey, event.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 font-mono text-sm text-white outline-none focus:border-indigo-500"
                >
                  {!activeSavedProvider.models.some((model) => model.value === selectedModel) && <option value={selectedModel}>{selectedModel}</option>}
                  {activeSavedProvider.models.map((model) => <option key={model.value} value={model.value}>{model.label}</option>)}
                </select> : <input
                  id="batch-ai-model"
                  value={selectedModel}
                  onChange={(event) => update(modelKey, event.target.value)}
                  placeholder="Название модели"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 font-mono text-sm text-white outline-none focus:border-indigo-500"
                />}
                {supportsReasoningToggle(activeSavedProvider.baseUrl) && (
                  <ReasoningToggle
                    provider={activeSavedProvider}
                    onSaved={(reasoning) => setProviders((current) => current.map((item) => item.id === activeSavedProvider.id ? { ...item, reasoning } : item))}
                  />
                )}
                <ModelPricingEditor
                  key={`${activeSavedProvider.id}:${selectedModel}`}
                  provider={activeSavedProvider}
                  model={selectedModel}
                  onSaved={(pricing) => setProviders((current) => current.map((item) => item.id === activeSavedProvider.id ? { ...item, pricing } : item))}
                />
              </>
            ) : (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
                Провайдер не выбран: AI-обработка не запустится. Выберите карточку провайдера выше.
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
            <span className="block text-xs text-slate-500">Общий лимит одновременных запросов к выбранному провайдеру.</span>
          </label>
        </div>
      </section>

      {showProviderForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onMouseDown={() => setShowProviderForm(false)}>
          <div className="w-full max-w-xl rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between gap-3">
              <div><h2 className="text-xl font-bold text-white">{editingProviderId ? 'Редактировать AI-провайдера' : 'Добавить AI-провайдера'}</h2><p className="mt-1 text-sm text-slate-400">OpenAI-compatible или Anthropic-compatible endpoint: OpenRouter, AgentRouter, Anthropic и другие сервисы.</p></div>
              <button type="button" onClick={() => setShowProviderForm(false)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"><X className="h-5 w-5" /></button>
            </div>
            <div className="mt-5 grid gap-4">
              <label className="space-y-2 text-sm text-slate-300"><span>Название</span><input value={providerForm.name} onChange={(event) => setProviderForm((current) => ({ ...current, name: event.target.value }))} placeholder="Мой OpenRouter" className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-indigo-500" /></label>
              <label className="space-y-2 text-sm text-slate-300"><span>Base URL</span><input value={providerForm.baseUrl} onChange={(event) => setProviderForm((current) => ({ ...current, baseUrl: event.target.value }))} placeholder="https://provider.example.com/v1" className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 font-mono text-sm text-white outline-none focus:border-indigo-500" /><span className="block text-xs text-slate-500">Протокол определяется автоматически: для OpenAI укажите адрес до `/chat/completions`, для Anthropic — базовый URL до `/messages` (AgentRouter: `https://agentrouter.org/v1`).</span></label>
              <label className="space-y-2 text-sm text-slate-300"><span>API-ключ {editingProviderId && <span className="font-normal text-slate-500">(оставьте пустым, чтобы сохранить текущий)</span>}</span><input type="password" value={providerForm.apiKey} onChange={(event) => setProviderForm((current) => ({ ...current, apiKey: event.target.value }))} autoComplete="new-password" className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 font-mono text-sm text-white outline-none focus:border-indigo-500" /></label>
              <label className="space-y-2 text-sm text-slate-300"><span>Модель <span className="font-normal text-slate-500">(необязательно)</span></span><input value={providerForm.model} onChange={(event) => setProviderForm((current) => ({ ...current, model: event.target.value }))} placeholder="Оставьте пустым, если endpoint предоставляет /models" className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 font-mono text-sm text-white outline-none focus:border-indigo-500" /><span className="block text-xs text-slate-500">Если endpoint поддерживает `/models`, система выберет первую модель автоматически. Иначе укажите модель вручную.</span></label>
            </div>
            {message?.type === 'error' && (
              <div role="alert" className="mt-5 rounded-xl border border-red-500/30 bg-red-950/60 px-4 py-3 text-sm leading-relaxed text-red-200">
                {message.text}
              </div>
            )}
            <div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => setShowProviderForm(false)} className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800">Отмена</button><button type="button" onClick={saveProvider} disabled={pending} className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50">{pending ? 'Проверяем endpoint…' : editingProviderId ? 'Сохранить изменения' : 'Добавить провайдера'}</button></div>
          </div>
        </div>
      )}

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
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold text-white">Автоматические правила категорий</h2>
              <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2.5 py-1 text-xs font-bold text-violet-200">
                {settings.categoryRules.length} наборов
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-400">
              Подключаются только к товару соответствующей категории и имеют приоритет над инструкцией поставщика. Изменения вступают в силу после «Сохранить настройки».
            </p>
          </div>
          <button type="button" onClick={addCategoryRule} className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500"><Plus className="h-4 w-4" />Добавить правило</button>
        </header>
        <div className="grid gap-4 border-b border-slate-700 p-6 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-4">
            <h3 className="font-semibold text-white">Новая категория</h3>
            <p className="mt-1 text-xs text-slate-500">Создаётся в каталоге Rails со статусом проверки.</p>
            <div className="mt-3 flex gap-2"><input value={newCategoryName} onChange={(event) => setNewCategoryName(event.target.value)} placeholder="Например, Текстиль" className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white" /><button type="button" onClick={createCategory} disabled={pending || !newCategoryName.trim()} className="rounded-lg border border-violet-500/40 px-3 text-sm font-semibold text-violet-200 disabled:opacity-50">Создать</button></div>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-4">
            <h3 className="font-semibold text-white">Новая подкатегория</h3>
            <p className="mt-1 text-xs text-slate-500">Сейчас в справочнике: {categories.length} категорий и {subcategories.length} подкатегорий.</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"><select value={newSubcategoryParentId} onChange={(event) => setNewSubcategoryParentId(event.target.value)} className="min-w-0 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white">{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select><input value={newSubcategoryName} onChange={(event) => setNewSubcategoryName(event.target.value)} placeholder="Например, Пледы" className="min-w-0 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white" /><button type="button" onClick={createSubcategory} disabled={pending || !newSubcategoryName.trim() || !newSubcategoryParentId} className="rounded-lg border border-violet-500/40 px-3 text-sm font-semibold text-violet-200 disabled:opacity-50">Создать</button></div>
          </div>
        </div>
        <div className="grid gap-4 p-6 lg:grid-cols-2">
          {settings.categoryRules.map((rule) => (
            <article key={rule.id} className="space-y-3 rounded-xl border border-slate-700 bg-slate-950/60 p-4">
              <div className="flex items-center justify-between gap-3"><span className="text-sm font-semibold text-white">Правило категории</span><button type="button" onClick={() => update('categoryRules', settings.categoryRules.filter((item) => item.id !== rule.id))} className="rounded-md p-1.5 text-slate-400 hover:bg-red-500/10 hover:text-red-300" aria-label={`Удалить правило ${rule.title}`}><Trash2 className="h-4 w-4" /></button></div>
              <label className="block text-xs text-slate-400">Категория<select value={rule.categoryName} onChange={(event) => updateCategoryRule(rule.id, { categoryName: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white">{categories.map((category) => <option key={category.id} value={category.name}>{category.name}</option>)}</select></label>
              <label className="block text-xs text-slate-400">Название<input value={rule.title} onChange={(event) => updateCategoryRule(rule.id, { title: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white" /></label>
              <label className="block text-xs text-slate-400">Краткое описание<input value={rule.description} onChange={(event) => updateCategoryRule(rule.id, { description: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white" /></label>
              <label className="block text-xs text-slate-400">Инструкции для AI<textarea value={rule.rules} onChange={(event) => updateCategoryRule(rule.id, { rules: event.target.value })} className="mt-1 min-h-40 w-full resize-y rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm leading-6 text-white" /></label>
            </article>
          ))}
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

function providerHost(baseUrl: string) {
  try {
    return new URL(baseUrl).hostname.toLowerCase()
  } catch {
    return ''
  }
}

/**
 * Цена выбранной модели для вкладки «Использование». Для DeepSeek цены
 * встроены и учитывают скидку вне часов пик; ручная цена их заменяет.
 */
function ModelPricingEditor({ provider, model, onSaved }: {
  provider: AiProviderRecord
  model: string
  onSaved: (pricing: AiPricingTable) => void
}) {
  const modelKey = normalizeModelName(model)
  const custom = provider.pricing?.[modelKey]
  const builtin = builtinPeakPrice(providerHost(provider.baseUrl), model)
  const [form, setForm] = useState({
    input: custom ? String(custom.input) : '',
    cachedInput: custom ? String(custom.cachedInput) : '',
    output: custom ? String(custom.output) : '',
  })
  const [status, setStatus] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [pending, startTransition] = useTransition()
  if (!modelKey) return null

  const save = (clear = false) => startTransition(async () => {
    setStatus(null)
    const price = clear ? null : {
      input: Number(form.input.replace(',', '.')),
      cachedInput: Number((form.cachedInput || form.input).replace(',', '.')),
      output: Number(form.output.replace(',', '.')),
    }
    if (price && (!form.input.trim() || !form.output.trim())) {
      setStatus({ type: 'error', text: 'Укажите цену входа и выхода.' })
      return
    }
    const result = await updateAiProviderPricingAction(provider.id, model, price)
    if (!result.success) {
      setStatus({ type: 'error', text: result.error || 'Не удалось сохранить цены' })
      return
    }
    onSaved(result.data?.pricing || {})
    if (clear) setForm({ input: '', cachedInput: '', output: '' })
    setStatus({ type: 'success', text: clear ? 'Ручная цена удалена.' : 'Цены сохранены: новые запросы считаются по ним.' })
  })

  const field = (key: keyof typeof form, label: string, placeholder?: number) => (
    <label className="space-y-1 text-xs text-slate-400">
      <span>{label}</span>
      <input
        inputMode="decimal"
        value={form[key]}
        onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
        placeholder={placeholder !== undefined ? String(placeholder) : '—'}
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-white outline-none focus:border-indigo-500"
      />
    </label>
  )

  return (
    <div className="space-y-3 rounded-xl border border-slate-700 bg-slate-950/50 p-3">
      <div className="text-xs font-semibold text-slate-300">Цена модели, $ за 1 млн токенов</div>
      <div className="grid gap-2 sm:grid-cols-3">
        {field('input', 'Вход', builtin?.input)}
        {field('cachedInput', 'Вход из кэша', builtin?.cachedInput)}
        {field('output', 'Выход', builtin?.output)}
      </div>
      <p className="text-xs leading-relaxed text-slate-500">
        {builtin
          ? custom
            ? 'Действует ручная цена. Удалите её, чтобы вернуть встроенный прайс DeepSeek со скидкой 50% вне часов пик.'
            : 'Цены DeepSeek встроены (в полях — пиковые). Вне часов пик (будни 01–04 и 06–10 UTC — пик) расход считается вдвое дешевле.'
          : custom
            ? 'Стоимость новых запросов считается по этим ценам.'
            : 'Без цены вкладка «Использование» покажет токены, но не стоимость (кроме провайдеров, которые сами сообщают цену, как OpenRouter).'}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => save()} disabled={pending} className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50">Сохранить цены</button>
        {custom && <button type="button" onClick={() => save(true)} disabled={pending} className="rounded-lg px-3 py-1.5 text-xs text-slate-400 hover:text-white disabled:opacity-50">Удалить ручную цену</button>}
        {status && <span className={`text-xs ${status.type === 'success' ? 'text-emerald-300' : 'text-red-300'}`}>{status.text}</span>}
      </div>
    </div>
  )
}

/**
 * Размышления модели входят в лимит «Максимум токенов» и оплачиваются как
 * выход. Для заполнения карточки по фото и тексту они обычно не нужны.
 */
function ReasoningToggle({ provider, onSaved }: {
  provider: AiProviderRecord
  onSaved: (reasoning: AiReasoningMode) => void
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const disabled = provider.reasoning === 'disabled'

  const toggle = (nextDisabled: boolean) => startTransition(async () => {
    setError(null)
    const result = await updateAiProviderReasoningAction(provider.id, nextDisabled ? 'disabled' : 'default')
    if (!result.success) {
      setError(result.error || 'Не удалось сохранить')
      return
    }
    onSaved(result.data?.reasoning || 'default')
  })

  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-700 bg-slate-950/50 p-3">
      <input
        type="checkbox"
        checked={disabled}
        disabled={pending}
        onChange={(event) => toggle(event.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-slate-600 bg-slate-900 accent-indigo-500"
      />
      <span className="space-y-1">
        <span className="block text-sm font-semibold text-white">Без размышлений модели</span>
        <span className="block text-xs leading-relaxed text-slate-500">
          Модель сразу пишет ответ. Дешевле и быстрее: размышления оплачиваются как выход и съедают лимит «Максимум токенов».
          Сохраняется сразу и действует для новых запусков; уже идущая обработка доработает с прежним режимом.
        </span>
        {error && <span className="block text-xs text-red-300">{error}</span>}
      </span>
    </label>
  )
}
