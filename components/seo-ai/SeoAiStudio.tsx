'use client'

import { useMemo, useState, useTransition } from 'react'
import { Bot, Check, Layers, Loader2, Pause, Play, RefreshCw, RotateCcw, Save, Search, Sparkles, Trash2, X } from 'lucide-react'
import {
  applySeoAiDraftAction,
  createSeoAiBatchAction,
  createSeoAiSuggestedSubcategoryAction,
  deleteSeoAiDraftAction,
  listSeoAiDraftsAction,
  listSeoAiBatchesAction,
  rejectSeoAiDraftAction,
  retrySeoAiGenerationAction,
  runSeoAiGenerationAction,
  searchSeoAiProductsAction,
  updateSeoAiSettingsAction,
  updateSeoAiBatchStateAction,
} from '@/actions/seo-ai'
import type { Brand, Category, Product, SeoAiBatch, SeoAiGeneration, SeoAiSetting, Subcategory } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'

const TASK_LABELS: Record<string, string> = {
  catalog_product_enricher: 'Карточка товара: Cockpit Tools',
  product_text: 'Товар: текстовый анализ',
  product_vision: 'Товар: фото-анализ',
  product_writer: 'Товар: финальный writer',
  brand_writer: 'Бренды',
  category_writer: 'Категории',
  landing_ideas: 'Идеи лендингов',
  catalog_attribute_refiner: 'Товары: нормализация атрибутов',
}

const PRODUCT_FIELDS = [
  { key: 'name', outputKey: 'suggested_name', label: 'Название' },
  { key: 'description', outputKey: 'description', label: 'Описание' },
  { key: 'h1', outputKey: 'h1', label: 'H1' },
  { key: 'seo_title', outputKey: 'seo_title', label: 'SEO title' },
  { key: 'seo_description', outputKey: 'seo_description', label: 'SEO description' },
  { key: 'gender', outputKey: 'gender', label: 'Гендер' },
  { key: 'catalog_attributes', outputKey: 'catalog_attributes', label: 'Характеристики' },
  { key: 'catalog_attributes.model_name', outputKey: 'catalog_attributes.model_name', label: 'Модель (только вручную)' },
  { key: 'subcategory_suggestion', outputKey: 'subcategory_suggestion', label: 'Подкатегория' },
  { key: 'image_alt_texts', outputKey: 'image_alt_texts', label: 'Alt фото' },
]

interface SeoAiStudioProps {
  initialSettings: SeoAiSetting[]
  initialDrafts: SeoAiGeneration[]
  initialBatches: SeoAiBatch[]
  brands: Brand[]
  categories: Category[]
  subcategories: Subcategory[]
}

export default function SeoAiStudio({ initialSettings, initialDrafts, initialBatches, brands, categories, subcategories }: SeoAiStudioProps) {
  const [settings, setSettings] = useState(initialSettings)
  const [drafts, setDrafts] = useState(initialDrafts)
  const [batches, setBatches] = useState(initialBatches)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [isPending, startTransition] = useTransition()

  const [productQuery, setProductQuery] = useState('')
  const [productResults, setProductResults] = useState<Product[]>([])
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [includeImages, setIncludeImages] = useState(true)

  const [batchIds, setBatchIds] = useState('')
  const [batchBrand, setBatchBrand] = useState('__none__')
  const [batchCategory, setBatchCategory] = useState('__none__')
  const [batchSubcategory, setBatchSubcategory] = useState('__none__')
  const [batchGender, setBatchGender] = useState('__none__')
  const [batchStatus, setBatchStatus] = useState('active')
  const [batchMissingOnly, setBatchMissingOnly] = useState(false)
  const [batchImages, setBatchImages] = useState(true)
  const [batchAutoApply, setBatchAutoApply] = useState(false)

  const subcategoriesForBatch = useMemo(
    () => subcategories.filter((subcategory) => subcategory.category === batchCategory),
    [batchCategory, subcategories]
  )

  function setStatus(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
  }

  function updateSetting(taskKey: string, patch: Partial<SeoAiSetting>) {
    setSettings((prev) => prev.map((setting) => setting.task_key === taskKey ? { ...setting, ...patch } : setting))
  }

  function saveSettings() {
    startTransition(async () => {
      const result = await updateSeoAiSettingsAction(settings)
      if (result.success) {
        setSettings(result.data)
        setStatus('success', 'Настройки SEO AI сохранены')
      } else {
        setStatus('error', result.error || 'Не удалось сохранить настройки')
      }
    })
  }

  function searchProducts() {
    startTransition(async () => {
      const result = await searchSeoAiProductsAction(productQuery)
      if (result.success) {
        setProductResults(result.data || [])
        setStatus('success', `Найдено товаров: ${(result.data || []).length}`)
      } else {
        setStatus('error', result.error || 'Поиск не удался')
      }
    })
  }

  function runProductGeneration() {
    if (!selectedProduct) {
      setStatus('error', 'Сначала выберите тестовый товар')
      return
    }

    startTransition(async () => {
      const result = await runSeoAiGenerationAction({
        targetType: 'Product',
        targetId: selectedProduct.id,
        includeImages,
        imageLimit: includeImages ? 9 : 0,
      })
      handleGenerationResult(result, 'Задание поставлено в очередь Cockpit Tools')
    })
  }

  function createBatch() {
    startTransition(async () => {
      const ids = batchIds
        .split(/[\s,]+/)
        .map((item) => item.trim())
        .filter(Boolean)
      const result = await createSeoAiBatchAction({
        ids,
        brand: batchBrand === '__none__' ? undefined : batchBrand,
        category: batchCategory === '__none__' ? undefined : batchCategory,
        subcategory: batchSubcategory === '__none__' ? undefined : batchSubcategory,
        gender: batchGender === '__none__' ? undefined : batchGender,
        status: batchStatus === '__all__' ? undefined : batchStatus,
        missingSeoOnly: batchMissingOnly,
        includeImages: batchImages,
        autoApply: batchAutoApply,
      })

      if (result.success) {
        setDrafts((prev) => [...(result.data?.generations || []), ...prev])
        setBatches((prev) => [result.data.batch, ...prev])
        setStatus('success', `В очередь поставлено: ${result.data.batch.total_count}`)
      } else {
        setStatus('error', result.error || 'Batch не создан')
      }
    })
  }

  function refreshDrafts() {
    startTransition(async () => {
      const [draftResult, batchResult] = await Promise.all([
        listSeoAiDraftsAction({ limit: 100 }),
        listSeoAiBatchesAction(),
      ])
      if (draftResult.success && batchResult.success) {
        setDrafts(draftResult.data || [])
        setBatches(batchResult.data || [])
        setStatus('success', 'Очередь обновлена')
      } else {
        setStatus('error', draftResult.error || batchResult.error || 'Не удалось обновить очередь')
      }
    })
  }

  function updateBatchState(id: string, action: 'pause' | 'resume' | 'cancel') {
    startTransition(async () => {
      const result = await updateSeoAiBatchStateAction(id, action)
      if (result.success) {
        setBatches((prev) => prev.map((batch) => batch.id === id ? result.data : batch))
        await refreshDrafts()
      } else {
        setStatus('error', result.error || 'Не удалось изменить состояние партии')
      }
    })
  }

  function handleGenerationResult(result: any, successText: string) {
    if (result.success) {
      setDrafts((prev) => [result.data, ...prev])
      setStatus('success', successText)
    } else {
      setStatus('error', result.error || 'Генерация не удалась')
    }
  }

  return (
    <div className="space-y-6">
      {message && (
        <div className={`rounded-lg border px-4 py-3 text-sm ${message.type === 'success' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-red-500/30 bg-red-500/10 text-red-300'}`}>
          {message.text}
        </div>
      )}

      <Tabs defaultValue="test" className="space-y-6">
        <TabsList className="flex h-auto flex-wrap justify-start gap-1 bg-slate-800 p-1">
          <TabsTrigger value="test">Один товар</TabsTrigger>
          <TabsTrigger value="batch">Массово</TabsTrigger>
          <TabsTrigger value="drafts">Очередь и сравнение</TabsTrigger>
          <TabsTrigger value="settings">Настройки</TabsTrigger>
        </TabsList>

        <TabsContent value="test">
          <Card className="border-slate-700 bg-slate-800">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-white"><Sparkles className="h-5 w-5 text-fuchsia-400" /> Проверить один товар</CardTitle>
              <CardDescription>Создаёт задание для локального Cockpit Tools. Опубликованный товар не меняется до применения черновика.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex flex-col gap-3 md:flex-row">
                <Input value={productQuery} onChange={(event) => setProductQuery(event.target.value)} placeholder="URL, slug, id или название товара" className="bg-slate-900" />
                <Button type="button" onClick={searchProducts} disabled={isPending}>
                  <Search className="h-4 w-4" />
                  Найти
                </Button>
              </div>

              {productResults.length > 0 && (
                <div className="grid gap-2 md:grid-cols-2">
                  {productResults.map((product) => (
                    <button
                      type="button"
                      key={product.id}
                      onClick={() => setSelectedProduct(product)}
                      className={`rounded-lg border p-3 text-left text-sm transition ${selectedProduct?.id === product.id ? 'border-fuchsia-400 bg-fuchsia-500/10' : 'border-slate-700 bg-slate-900 hover:border-slate-500'}`}
                    >
                      <span className="block font-semibold text-slate-100">{product.name}</span>
                      <span className="mt-1 block text-xs text-slate-400">{product.slug || product.id}</span>
                    </button>
                  ))}
                </div>
              )}

              {selectedProduct && (
                <div className="rounded-lg border border-slate-700 bg-slate-900 p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-white">{selectedProduct.name}</p>
                      <p className="text-xs text-slate-400">{productBrandLabel(selectedProduct) || 'Без бренда'} · {selectedProduct.gender || 'Без гендера'}</p>
                    </div>
                    <label className="flex items-center gap-2 text-sm text-slate-300">
                      <Checkbox checked={includeImages} onCheckedChange={(value) => setIncludeImages(Boolean(value))} />
                      Анализировать до 9 фото сеткой 3×3
                    </label>
                    <Button type="button" onClick={runProductGeneration} disabled={isPending}>
                      {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
                      Сгенерировать
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="batch">
          <Card className="border-slate-700 bg-slate-800">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-white"><Layers className="h-5 w-5 text-indigo-400" /> Массовая генерация</CardTitle>
              <CardDescription>До 500 опубликованных товаров за запуск. Очередь продолжится после повторного запуска локального worker.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-4">
                <Label>ID товаров, если нужен точный список</Label>
                <Textarea value={batchIds} onChange={(event) => setBatchIds(event.target.value)} placeholder="uuid-1, uuid-2 или с новой строки" className="min-h-28 bg-slate-900 font-mono" />
                <div className="grid gap-3 md:grid-cols-2">
                  <Select value={batchBrand} onValueChange={setBatchBrand}>
                    <SelectTrigger className="bg-slate-900"><SelectValue placeholder="Бренд" /></SelectTrigger>
                    <SelectContent><SelectItem value="__none__">Все бренды</SelectItem>{brands.map((brand) => <SelectItem key={brand.id} value={brand.id}>{brand.name}</SelectItem>)}</SelectContent>
                  </Select>
                  <Select value={batchCategory} onValueChange={(value) => { setBatchCategory(value); setBatchSubcategory('__none__') }}>
                    <SelectTrigger className="bg-slate-900"><SelectValue placeholder="Категория" /></SelectTrigger>
                    <SelectContent><SelectItem value="__none__">Все категории</SelectItem>{categories.map((category) => <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>)}</SelectContent>
                  </Select>
                  <Select value={batchSubcategory} onValueChange={setBatchSubcategory} disabled={batchCategory === '__none__'}>
                    <SelectTrigger className="bg-slate-900"><SelectValue placeholder="Подкатегория" /></SelectTrigger>
                    <SelectContent><SelectItem value="__none__">Все подкатегории</SelectItem>{subcategoriesForBatch.map((subcategory) => <SelectItem key={subcategory.id} value={subcategory.id}>{subcategory.name}</SelectItem>)}</SelectContent>
                  </Select>
                  <Select value={batchGender} onValueChange={setBatchGender}>
                    <SelectTrigger className="bg-slate-900"><SelectValue placeholder="Гендер" /></SelectTrigger>
                    <SelectContent><SelectItem value="__none__">Любой гендер</SelectItem><SelectItem value="female">Женский</SelectItem><SelectItem value="male">Мужской</SelectItem><SelectItem value="unisex">Унисекс</SelectItem></SelectContent>
                  </Select>
                  <Select value={batchStatus} onValueChange={setBatchStatus}>
                    <SelectTrigger className="bg-slate-900"><SelectValue placeholder="Статус" /></SelectTrigger>
                    <SelectContent><SelectItem value="__all__">Любой статус</SelectItem><SelectItem value="active">Active</SelectItem><SelectItem value="draft">Draft</SelectItem><SelectItem value="hidden">Hidden</SelectItem></SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-4 rounded-lg border border-slate-700 bg-slate-900 p-4">
                <label className="flex items-center gap-2 text-sm text-slate-300"><Checkbox checked={batchMissingOnly} onCheckedChange={(value) => setBatchMissingOnly(Boolean(value))} /> Только товары с пустым SEO/описанием</label>
                <label className="flex items-center gap-2 text-sm text-slate-300"><Checkbox checked={batchImages} onCheckedChange={(value) => setBatchImages(Boolean(value))} /> Анализировать до 9 фото сеткой 3×3</label>
                <label className="flex items-center gap-2 text-sm text-slate-300"><Checkbox checked={batchAutoApply} onCheckedChange={(value) => setBatchAutoApply(Boolean(value))} /> Автоприменение безопасных полей</label>
                <p className="text-xs leading-5 text-slate-500">Модель и новая подкатегория всегда остаются на ручной проверке. Гендер, характеристики и существующая подкатегория применяются автоматически только при уверенности от 90%.</p>
                <Button type="button" onClick={createBatch} disabled={isPending} className="w-full">
                  {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  Запустить batch
                </Button>
              </div>
            </CardContent>
          </Card>
          {batches.length > 0 && (
            <div className="mt-4 space-y-2">
              <h3 className="text-sm font-semibold text-slate-300">Последние партии</h3>
              {batches.slice(0, 10).map((batch) => (
                <div key={batch.id} className="flex flex-col gap-3 rounded-lg border border-slate-700 bg-slate-900 p-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-sm font-medium text-white">{batch.total_count} товаров · {batch.success_count} готово · {batch.failure_count} ошибок</p>
                    <p className="mt-1 text-xs text-slate-500">{new Date(batch.created_at).toLocaleString('ru-RU')} · {batch.status}{batch.auto_apply ? ' · автоприменение' : ''}</p>
                  </div>
                  <div className="flex gap-2">
                    {batch.status === 'running' && <Button type="button" size="sm" variant="outline" onClick={() => updateBatchState(batch.id, 'pause')} disabled={isPending}><Pause className="h-4 w-4" /> Пауза</Button>}
                    {batch.status === 'paused' && <Button type="button" size="sm" variant="outline" onClick={() => updateBatchState(batch.id, 'resume')} disabled={isPending}><Play className="h-4 w-4" /> Продолжить</Button>}
                    {(batch.status === 'running' || batch.status === 'paused') && <Button type="button" size="sm" variant="outline" onClick={() => updateBatchState(batch.id, 'cancel')} disabled={isPending}><X className="h-4 w-4" /> Отменить</Button>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="drafts">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-white">Очередь и сравнение</h2>
              <Button type="button" variant="outline" onClick={refreshDrafts} disabled={isPending}><RefreshCw className="h-4 w-4" /> Обновить</Button>
            </div>
            <div className="grid gap-4">
              {drafts.length === 0 ? <p className="text-sm text-slate-400">Черновиков пока нет.</p> : drafts.map((draft) => (
                <DraftCard
                  key={draft.id}
                  draft={draft}
                  onChange={(next) => setDrafts((prev) => prev.map((item) => item.id === next.id ? next : item))}
                  onDelete={(id) => setDrafts((prev) => prev.filter((item) => item.id !== id))}
                />
              ))}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="settings">
          <div className="space-y-4">
            <div className="flex justify-end">
              <Button type="button" onClick={saveSettings} disabled={isPending}><Save className="h-4 w-4" /> Сохранить настройки</Button>
            </div>
            {settings.map((setting) => (
              <Card key={setting.task_key} className="border-slate-700 bg-slate-800">
                <CardHeader>
                  <CardTitle className="text-white">{TASK_LABELS[setting.task_key] || setting.task_key}</CardTitle>
                  <CardDescription className="font-mono">{setting.task_key}</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 lg:grid-cols-[260px_140px_140px_1fr]">
                  <div className="space-y-2">
                    <Label>Model</Label>
                    <Input value={setting.model} onChange={(event) => updateSetting(setting.task_key, { model: event.target.value })} className="bg-slate-900 font-mono text-xs" />
                  </div>
                  <div className="space-y-2">
                    <Label>Temperature</Label>
                    <Input type="number" min="0" max="2" step="0.05" value={setting.temperature} onChange={(event) => updateSetting(setting.task_key, { temperature: Number(event.target.value) })} className="bg-slate-900" />
                  </div>
                  <div className="space-y-2">
                    <Label>Max tokens</Label>
                    <Input type="number" min="200" value={setting.max_tokens} onChange={(event) => updateSetting(setting.task_key, { max_tokens: Number(event.target.value) })} className="bg-slate-900" />
                  </div>
                  <label className="mt-7 flex items-center gap-2 text-sm text-slate-300"><Checkbox checked={setting.enabled} onCheckedChange={(value) => updateSetting(setting.task_key, { enabled: Boolean(value) })} /> Enabled</label>
                  <div className="space-y-2 lg:col-span-2">
                    <Label>System prompt</Label>
                    <Textarea value={setting.system_prompt || ''} onChange={(event) => updateSetting(setting.task_key, { system_prompt: event.target.value })} className="min-h-36 bg-slate-900 font-mono text-xs" />
                  </div>
                  <div className="space-y-2 lg:col-span-2">
                    <Label>User prompt template</Label>
                    <Textarea value={setting.user_prompt_template || ''} onChange={(event) => updateSetting(setting.task_key, { user_prompt_template: event.target.value })} className="min-h-36 bg-slate-900 font-mono text-xs" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function productBrandLabel(product: Product) {
  const brand = product.expand?.brand
  if (Array.isArray(brand)) return brand.map((item) => item.name).filter(Boolean).join(', ')
  return brand?.name || ''
}

function DraftCard({ draft, onChange, onDelete }: { draft: SeoAiGeneration; onChange: (draft: SeoAiGeneration) => void; onDelete: (id: string) => void }) {
  const [fields, setFields] = useState(PRODUCT_FIELDS.filter((field) => field.key !== 'catalog_attributes.model_name' && field.key !== 'subcategory_suggestion').map((field) => field.key))
  const [isPending, startTransition] = useTransition()
  const outputText = JSON.stringify(draft.output, null, 2)
  const productBefore = draft.input_snapshot?.product || {}

  function toggleField(field: string) {
    setFields((prev) => prev.includes(field) ? prev.filter((item) => item !== field) : [...prev, field])
  }

  function applyDraft() {
    startTransition(async () => {
      const result = await applySeoAiDraftAction(draft.id, draft.draft_type === 'product' ? fields : undefined)
      if (result.success) onChange(result.data.generation)
      else alert(result.error || 'Не удалось применить draft')
    })
  }

  function rejectDraft() {
    startTransition(async () => {
      const result = await rejectSeoAiDraftAction(draft.id)
      if (result.success) onChange(result.data)
      else alert(result.error || 'Не удалось отклонить draft')
    })
  }

  function deleteDraft() {
    if (!confirm('Удалить этот AI-черновик?')) return

    startTransition(async () => {
      const result = await deleteSeoAiDraftAction(draft.id)
      if (result.success) onDelete(draft.id)
      else alert(result.error || 'Не удалось удалить draft')
    })
  }

  function retryDraft() {
    startTransition(async () => {
      const result = await retrySeoAiGenerationAction(draft.id)
      if (result.success) onChange(result.data)
      else alert(result.error || 'Не удалось повторить задание')
    })
  }

  function createSubcategory() {
    startTransition(async () => {
      const result = await createSeoAiSuggestedSubcategoryAction(draft.id)
      if (result.success) onChange(result.data.generation)
      else alert(result.error || 'Не удалось создать подкатегорию')
    })
  }

  return (
    <Card className="border-slate-700 bg-slate-800">
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle className="text-base text-white">{draft.target_label || draft.target_type} <span className="text-slate-500">· {draft.draft_type}</span></CardTitle>
            <CardDescription className="mt-1">{new Date(draft.created_at).toLocaleString('ru-RU')}</CardDescription>
          </div>
          <Badge className={draft.status === 'draft' ? 'bg-indigo-600' : draft.status === 'failed' ? 'bg-red-600' : draft.status === 'processing' ? 'bg-amber-600' : draft.status === 'queued' ? 'bg-cyan-700' : 'bg-slate-600'}>{statusLabel(draft)}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {draft.error_message && <div className="rounded border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{draft.error_message}</div>}
        {draft.status === 'draft' && draft.draft_type === 'product' && (
          <div className="grid gap-3 lg:grid-cols-2">
            {PRODUCT_FIELDS.filter((field) => field.key !== 'catalog_attributes.model_name').map((field) => {
              const before = field.key === 'catalog_attributes' ? productBefore.catalog_attributes : productBefore[field.key]
              const after = nestedOutputValue(draft.output, field.outputKey)
              if (after === undefined || after === null || after === '') return null
              return (
                <div key={field.key} className="rounded-lg border border-slate-700 bg-slate-900 p-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{field.label}</p>
                  <div className="grid gap-2 text-xs md:grid-cols-2">
                    <div><span className="text-slate-500">Было</span><pre className="mt-1 whitespace-pre-wrap text-slate-300">{formatValue(before)}</pre></div>
                    <div><span className="text-emerald-500">Предложение</span><pre className="mt-1 whitespace-pre-wrap text-emerald-200">{formatValue(after)}</pre></div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
        {Array.isArray(draft.output?.conflicts) && draft.output.conflicts.length > 0 && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
            <p className="font-semibold">Обнаружены противоречия</p>
            {draft.output.conflicts.map((conflict: any, index: number) => <p key={index} className="mt-1">{conflict.field}: {conflict.evidence} ({Math.round(Number(conflict.confidence || 0) * 100)}%)</p>)}
          </div>
        )}
        {draft.status === 'draft' && draft.output?.subcategory_suggestion?.kind === 'new' && (
          <div className="rounded-lg border border-fuchsia-500/30 bg-fuchsia-500/10 p-3">
            <p className="text-sm font-semibold text-fuchsia-200">Новая подкатегория: {draft.output.subcategory_suggestion.name}</p>
            <p className="mt-1 text-xs text-fuchsia-300">{draft.output.subcategory_suggestion.evidence} · уверенность {Math.round(Number(draft.output.subcategory_suggestion.confidence || 0) * 100)}%</p>
            <Button type="button" size="sm" className="mt-3" onClick={createSubcategory} disabled={isPending}>Создать и назначить товару</Button>
          </div>
        )}
        {draft.draft_type === 'product' && draft.status === 'draft' && (
          <div className="flex flex-wrap gap-3">
            {PRODUCT_FIELDS.map((field) => (
              <label key={field.key} className="flex items-center gap-2 text-xs text-slate-300">
                <Checkbox checked={fields.includes(field.key)} onCheckedChange={() => toggleField(field.key)} />
                {field.label}
              </label>
            ))}
          </div>
        )}
        <pre className="max-h-96 overflow-auto rounded-lg bg-slate-950 p-4 text-xs text-slate-300">{outputText}</pre>
        {draft.status === 'draft' && (
          <div className="flex gap-2">
            <Button type="button" onClick={applyDraft} disabled={isPending}><Check className="h-4 w-4" /> Применить</Button>
            <Button type="button" variant="outline" onClick={rejectDraft} disabled={isPending}><X className="h-4 w-4" /> Отклонить</Button>
          </div>
        )}
        {(draft.status === 'failed' || draft.status === 'canceled') && (
          <Button type="button" variant="outline" onClick={retryDraft} disabled={isPending}>
            <RotateCcw className="h-4 w-4" /> Повторить
          </Button>
        )}
        <Button type="button" variant="outline" onClick={deleteDraft} disabled={isPending} className="border-red-500/30 text-red-300 hover:bg-red-500/10 hover:text-red-200">
          <Trash2 className="h-4 w-4" />
          Удалить
        </Button>
      </CardContent>
    </Card>
  )
}

function nestedOutputValue(output: Record<string, any>, path: string) {
  return path.split('.').reduce<any>((value, key) => value?.[key], output)
}

function formatValue(value: any) {
  if (value === undefined || value === null || value === '') return '—'
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

function statusLabel(draft: SeoAiGeneration) {
  if (draft.status === 'queued') return 'Ожидает локальный worker'
  if (draft.status === 'processing') return draft.progress_stage || 'Обрабатывается'
  if (draft.status === 'draft') return 'Готов к проверке'
  if (draft.status === 'applied') return 'Применён'
  if (draft.status === 'rejected') return 'Отклонён'
  if (draft.status === 'canceled') return 'Отменён'
  return 'Ошибка'
}
