'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import Image from 'next/image'
import { Bot, Check, ChevronDown, ChevronUp, Clock3, ExternalLink, Folder, Layers, Loader2, Pause, Pencil, Play, RefreshCw, RotateCcw, Save, Search, Sparkles, Trash2, X } from 'lucide-react'
import {
  applySeoAiDraftAction,
  createSeoAiBatchAction,
  createSeoAiSuggestedSubcategoryAction,
  deleteSeoAiDraftAction,
  listSeoAiDraftsAction,
  listSeoAiBatchesAction,
  rejectSeoAiDraftAction,
  renameSeoAiBatchAction,
  retrySeoAiGenerationAction,
  runSeoAiGenerationAction,
  searchSeoAiProductsAction,
  updateSeoAiSettingsAction,
  updateSeoAiBatchStateAction,
} from '@/actions/seo-ai'
import type { Brand, Category, Product, SeoAiBatch, SeoAiGeneration, SeoAiSetting, Subcategory } from '@/lib/types'
import type { CatalogAttributeDefinition } from '@/lib/catalog-attribute-schema'
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

const AI_FIELD_LABELS: Record<string, string> = {
  materials: 'Материал / состав',
  stones: 'Камни и декоративные вставки',
  jewelry_metal: 'Металл украшения',
  center_material: 'Материал центральной части',
}

interface SeoAiStudioProps {
  initialSettings: SeoAiSetting[]
  initialDrafts: SeoAiGeneration[]
  initialBatches: SeoAiBatch[]
  brands: Brand[]
  categories: Category[]
  subcategories: Subcategory[]
  attributeDefinitions: CatalogAttributeDefinition[]
}

export default function SeoAiStudio({ initialSettings, initialDrafts, initialBatches, brands, categories, subcategories, attributeDefinitions }: SeoAiStudioProps) {
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
  const [batchLimit, setBatchLimit] = useState(100)
  const [now, setNow] = useState(() => Date.now())

  const hasActiveBatches = batches.some((batch) => batch.status === 'pending' || batch.status === 'running')

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!hasActiveBatches) return

    const timer = window.setInterval(async () => {
      const [draftResult, batchResult] = await Promise.all([
        listSeoAiDraftsAction({ limit: 100 }),
        listSeoAiBatchesAction(),
      ])
      if (draftResult.success) setDrafts(draftResult.data || [])
      if (batchResult.success) setBatches(batchResult.data || [])
    }, 5000)
    return () => window.clearInterval(timer)
  }, [hasActiveBatches])

  const subcategoriesForBatch = useMemo(
    () => subcategories.filter((subcategory) => subcategory.category === batchCategory),
    [batchCategory, subcategories]
  )
  const draftGroups = useMemo(() => {
    const knownBatchIds = new Set(batches.map((batch) => batch.id))
    const batchGroups = batches
      .map((batch) => ({ batch, drafts: drafts.filter((draft) => draft.batch_id === batch.id) }))
      .filter((group) => group.drafts.length > 0)
    const standaloneDrafts = drafts.filter((draft) => !draft.batch_id || !knownBatchIds.has(draft.batch_id))
    return standaloneDrafts.length > 0
      ? [...batchGroups, { batch: null, drafts: standaloneDrafts }]
      : batchGroups
  }, [batches, drafts])

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
        itemLimit: batchLimit,
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

  async function renameBatch(id: string, name: string) {
    const result = await renameSeoAiBatchAction(id, name)
    if (result.success) {
      setBatches((prev) => prev.map((batch) => batch.id === id ? result.data : batch))
      setStatus('success', 'Выгрузка переименована')
      return true
    }
    setStatus('error', result.error || 'Не удалось переименовать выгрузку')
    return false
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
    <div className="min-w-0 max-w-full space-y-6 overflow-x-hidden">
      {message && (
        <div className={`rounded-lg border px-4 py-3 text-sm ${message.type === 'success' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-red-500/30 bg-red-500/10 text-red-300'}`}>
          {message.text}
        </div>
      )}

      <Tabs defaultValue="test" className="space-y-6">
        <TabsList className="flex h-auto w-full max-w-full flex-nowrap justify-start gap-1 overflow-x-auto bg-slate-800 p-1">
          <TabsTrigger value="test" className="shrink-0">Один товар</TabsTrigger>
          <TabsTrigger value="batch" className="shrink-0">Массово</TabsTrigger>
          <TabsTrigger value="drafts" className="shrink-0">Очередь и сравнение</TabsTrigger>
          <TabsTrigger value="settings" className="shrink-0">Настройки</TabsTrigger>
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
                      className={`flex min-w-0 items-center gap-3 rounded-lg border p-3 text-left text-sm transition ${selectedProduct?.id === product.id ? 'border-fuchsia-400 bg-fuchsia-500/10' : 'border-slate-700 bg-slate-900 hover:border-slate-500'}`}
                    >
                      {productImageUrl(product) ? <Image src={productImageUrl(product)} alt="" width={56} height={56} className="h-14 w-14 shrink-0 rounded-md bg-slate-800 object-cover" /> : <div className="h-14 w-14 shrink-0 rounded-md bg-slate-800" />}
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-slate-100">{product.name}</span>
                        <span className="mt-1 block truncate text-xs text-slate-400">{product.slug || product.id}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {selectedProduct && (
                <div className="rounded-lg border border-slate-700 bg-slate-900 p-4">
                  <div className="flex min-w-0 flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                      {productImageUrl(selectedProduct) ? <Image src={productImageUrl(selectedProduct)} alt="" width={64} height={64} className="h-16 w-16 shrink-0 rounded-lg bg-slate-800 object-cover" /> : null}
                      <div className="min-w-0">
                      <p className="text-sm font-semibold text-white">{selectedProduct.name}</p>
                      <p className="text-xs text-slate-400">{productBrandLabel(selectedProduct) || 'Без бренда'} · {selectedProduct.gender || 'Без гендера'}</p>
                      {selectedProduct.slug && <a href={storefrontProductUrl(selectedProduct.slug)} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-sky-400 hover:text-sky-300"><ExternalLink className="h-3 w-3" /> Открыть карточку</a>}
                      </div>
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
            <CardContent className="grid min-w-0 gap-4 xl:grid-cols-2">
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
                  <div className="space-y-1">
                    <Label htmlFor="batch-limit">Сколько товаров проверить</Label>
                    <Input
                      id="batch-limit"
                      type="number"
                      min={1}
                      max={500}
                      value={batchLimit}
                      onChange={(event) => setBatchLimit(Math.min(500, Math.max(1, Number(event.target.value) || 1)))}
                      className="bg-slate-900"
                    />
                    <p className="text-xs text-slate-500">От 1 до 500 за одну партию</p>
                  </div>
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
                    <p className="mb-1 text-sm font-semibold text-white">{batch.name || `Выгрузка ${new Date(batch.created_at).toLocaleString('ru-RU')}`}</p>
                    <p className="text-sm font-medium text-white">{batch.total_count} товаров · {batch.success_count} готово · {batch.failure_count} ошибок</p>
                    <p className="mt-1 text-xs text-slate-500">Запрошено: {batch.item_limit || batch.total_count} · {new Date(batch.created_at).toLocaleString('ru-RU')} · {batchStatusLabel(batch.status)}{batch.auto_apply ? ' · автоприменение' : ''}</p>
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-cyan-300"><Clock3 className="h-3.5 w-3.5" /> {batchTimingLabel(batch, now)}</p>
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
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-xl font-bold text-white">Очередь и сравнение</h2>
              <Button type="button" variant="outline" onClick={refreshDrafts} disabled={isPending}><RefreshCw className="h-4 w-4" /> Обновить</Button>
            </div>
            <div className="grid gap-4">
              {drafts.length === 0 ? <p className="text-sm text-slate-400">Черновиков пока нет.</p> : draftGroups.map((group) => (
                <DraftFolder
                  key={group.batch?.id || 'standalone'}
                  batch={group.batch}
                  drafts={group.drafts}
                  attributeDefinitions={attributeDefinitions}
                  onRename={renameBatch}
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

function productImageUrl(product: Product) {
  const medium = product.media?.[0]
  return medium?.thumb_url || medium?.preview_url || medium?.original_url || product.thumb || product.photos?.[0] || ''
}

function draftImageUrl(draft: SeoAiGeneration) {
  const image = Array.isArray(draft.input_snapshot?.images) ? draft.input_snapshot.images[0] : null
  return image?.thumb_url || image?.preview_url || image?.original_url || ''
}

function storefrontProductUrl(slug: string) {
  return `https://yeezyunique.ru/product/${encodeURIComponent(slug)}`
}

function DraftFolder({
  batch,
  drafts,
  attributeDefinitions,
  onRename,
  onChange,
  onDelete,
}: {
  batch: SeoAiBatch | null
  drafts: SeoAiGeneration[]
  attributeDefinitions: CatalogAttributeDefinition[]
  onRename: (id: string, name: string) => Promise<boolean>
  onChange: (draft: SeoAiGeneration) => void
  onDelete: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(true)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(batch?.name || '')
  const [isRenaming, startRenaming] = useTransition()
  const label = batch?.name || (batch ? `Выгрузка ${new Date(batch.created_at).toLocaleString('ru-RU')}` : 'Отдельные товары')

  function saveName() {
    if (!batch || !name.trim()) return
    startRenaming(async () => {
      if (await onRename(batch.id, name.trim())) setEditing(false)
    })
  }

  return (
    <section className="min-w-0 overflow-hidden rounded-xl border border-slate-700 bg-slate-900/60">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        className="flex cursor-pointer items-center justify-between gap-3 p-3 hover:bg-slate-800/70 sm:p-4"
        onClick={(event) => { if (!isInteractiveElement(event.target)) setExpanded((value) => !value) }}
        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setExpanded((value) => !value) } }}
      >
        <div className="flex min-w-0 items-center gap-3">
          <Folder className="h-5 w-5 shrink-0 text-indigo-400" />
          <div className="min-w-0">
            <p className="truncate font-semibold text-white">{label}</p>
            <p className="text-xs text-slate-400">{drafts.length} товаров{batch ? ` · ${batchStatusLabel(batch.status)}` : ''}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {batch && <Button type="button" size="icon" variant="ghost" aria-label="Переименовать выгрузку" onClick={(event) => { event.stopPropagation(); setEditing(true) }}><Pencil className="h-4 w-4" /></Button>}
          {expanded ? <ChevronUp className="h-5 w-5 text-slate-400" /> : <ChevronDown className="h-5 w-5 text-slate-400" />}
        </div>
      </div>
      {editing && batch && (
        <div className="flex flex-col gap-2 border-t border-slate-700 p-3 sm:flex-row sm:items-center">
          <Input value={name} maxLength={120} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') saveName() }} className="bg-slate-950" autoFocus />
          <Button type="button" size="sm" onClick={saveName} disabled={isRenaming || !name.trim()}>{isRenaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Сохранить</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => { setName(batch.name); setEditing(false) }}>Отмена</Button>
        </div>
      )}
      {expanded && (
        <div className="grid gap-3 border-t border-slate-700 p-3 sm:p-4">
          {drafts.map((draft) => (
            <DraftCard
              key={draft.id}
              draft={draft}
              compact={drafts.length > 3}
              attributeDefinitions={attributeDefinitions}
              onChange={onChange}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function DraftCard({
  draft,
  compact,
  attributeDefinitions,
  onChange,
  onDelete,
}: {
  draft: SeoAiGeneration
  compact: boolean
  attributeDefinitions: CatalogAttributeDefinition[]
  onChange: (draft: SeoAiGeneration) => void
  onDelete: (id: string) => void
}) {
  const [fields, setFields] = useState(PRODUCT_FIELDS.filter((field) => field.key !== 'catalog_attributes.model_name' && field.key !== 'subcategory_suggestion').map((field) => field.key))
  const [expanded, setExpanded] = useState(!compact)
  const [isPending, startTransition] = useTransition()
  const outputText = JSON.stringify(draft.output, null, 2)
  const productBefore = draft.input_snapshot?.product || {}
  const attributesBefore = productBefore.catalog_attributes || {}
  const attributesAfter = draft.output?.catalog_attributes || {}
  const subcategorySuggestion = draft.output?.subcategory_suggestion
  const imageUrl = draftImageUrl(draft)
  const productSlug = productBefore.slug
  const taxonomy = draft.input_snapshot?.catalog?.current_taxonomy
  const categoryPath = [taxonomy?.top_level?.name, taxonomy?.assigned?.name].filter((name, index, values) => name && values.indexOf(name) === index).join(' → ')
  const attributeDefinitionsByCode = new Map(attributeDefinitions.map((definition) => [definition.code, definition]))

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
    <Card className="min-w-0 overflow-hidden border-slate-700 bg-slate-800">
      <CardHeader
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        className="cursor-pointer p-3 hover:bg-slate-700/30 sm:p-4"
        onClick={(event) => { if (!isInteractiveElement(event.target)) setExpanded((value) => !value) }}
        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setExpanded((value) => !value) } }}
      >
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            {imageUrl ? <Image src={imageUrl} alt="" width={64} height={64} className="h-16 w-16 shrink-0 rounded-lg bg-slate-900 object-cover" /> : <div className="h-16 w-16 shrink-0 rounded-lg bg-slate-900" />}
            <div className="min-w-0">
              <CardTitle className="truncate text-base text-white">{draft.target_label || draft.target_type}</CardTitle>
              <CardDescription className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                <span>{new Date(draft.created_at).toLocaleString('ru-RU')}</span>
                {draft.completed_at && <span>· {formatDuration(new Date(draft.completed_at).getTime() - new Date(draft.created_at).getTime())}</span>}
              </CardDescription>
              {categoryPath && <p className="mt-1 truncate text-xs text-slate-400">{categoryPath}</p>}
              {productSlug && <a href={storefrontProductUrl(productSlug)} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-sky-400 hover:text-sky-300"><ExternalLink className="h-3 w-3" /> Оригинальная карточка</a>}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 self-start sm:self-auto">
            <Badge className={draft.status === 'draft' ? 'bg-indigo-600' : draft.status === 'failed' ? 'bg-red-600' : draft.status === 'processing' ? 'bg-amber-600' : draft.status === 'queued' ? 'bg-cyan-700' : 'bg-slate-600'}>{statusLabel(draft)}</Badge>
            <span className="flex items-center gap-1 text-sm text-slate-300">
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              <span className="hidden sm:inline">{expanded ? 'Свернуть' : 'Подробнее'}</span>
            </span>
          </div>
        </div>
      </CardHeader>
      {expanded && <CardContent className="min-w-0 space-y-4 px-3 pb-4 pt-0 sm:px-4">
        {draft.error_message && <div className="rounded border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{draft.error_message}</div>}
        {draft.status === 'draft' && draft.draft_type === 'product' && (
          <div className="grid min-w-0 gap-3 xl:grid-cols-2">
            {PRODUCT_FIELDS.filter((field) => !['catalog_attributes', 'catalog_attributes.model_name', 'subcategory_suggestion', 'image_alt_texts'].includes(field.key)).map((field) => {
              const before = productBefore[field.key]
              const after = nestedOutputValue(draft.output, field.outputKey)
              if (after === undefined || after === null || after === '') return null
              return (
                <div key={field.key} className={`min-w-0 overflow-hidden rounded-lg border border-slate-700 bg-slate-900 p-3 ${field.key === 'description' ? 'xl:col-span-2' : ''}`}>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{field.label}</p>
                  <div className="grid min-w-0 gap-3 text-sm md:grid-cols-2">
                    <div className="min-w-0"><span className="text-xs text-slate-500">Было</span><p className="mt-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-slate-300">{formatValue(before, field.key)}</p></div>
                    <div className="min-w-0"><span className="text-xs text-emerald-500">Предложение</span><p className="mt-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-emerald-200">{formatValue(after, field.key)}</p></div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
        {draft.status === 'draft' && Object.keys(attributesAfter).length > 0 && (
          <div className="rounded-lg border border-slate-700 bg-slate-900 p-3 sm:p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Характеристики</p>
            <div className="grid min-w-0 gap-3 lg:grid-cols-2">
              {Object.entries(attributesAfter).map(([code, value]) => {
                const definition = attributeDefinitionsByCode.get(code)
                return (
                  <div key={code} className="min-w-0 rounded-md border border-slate-700/70 bg-slate-950/60 p-3">
                    <p className="font-medium text-white">{definition?.label || code}</p>
                    <p className="mt-0.5 break-all text-[11px] text-slate-500"><code>{code}</code>{definition?.category_scope ? ` · для категории: ${definition.category_scope}` : ' · характеристика товара'}</p>
                    <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                      <div><span className="text-xs text-slate-500">Было</span><p className="mt-0.5 break-words text-slate-300">{formatAttributeValue(attributesBefore[code], definition)}</p></div>
                      <div><span className="text-xs text-emerald-500">Предложение</span><p className="mt-0.5 break-words text-emerald-200">{formatAttributeValue(value, definition)}</p></div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
        {draft.status === 'draft' && subcategorySuggestion?.kind && subcategorySuggestion.kind !== 'none' && (
          <div className="rounded-lg border border-slate-700 bg-slate-900 p-3 sm:p-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold text-white">Подкатегория: {subcategorySuggestion.name || 'Без названия'}</p>
              <Badge variant="outline">{subcategorySuggestion.kind === 'new' ? 'Новая' : 'Существующая'}</Badge>
            </div>
            <p className="mt-2 break-words text-sm text-slate-300">{subcategorySuggestion.evidence || 'Без пояснения'}</p>
            <p className="mt-1 text-xs text-slate-500">Уверенность: {Math.round(Number(subcategorySuggestion.confidence || 0) * 100)}%</p>
            {subcategorySuggestion.kind === 'new' && <Button type="button" size="sm" className="mt-3" onClick={createSubcategory} disabled={isPending}>Создать и назначить товару</Button>}
          </div>
        )}
        {Array.isArray(draft.output?.conflicts) && draft.output.conflicts.length > 0 && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
            <p className="font-semibold">Обнаружены противоречия</p>
            {draft.output.conflicts.map((conflict: any, index: number) => <p key={index} className="mt-1 break-words"><strong>{fieldLabel(conflict.field, attributeDefinitionsByCode)}:</strong> {conflict.evidence} ({Math.round(Number(conflict.confidence || 0) * 100)}%)</p>)}
          </div>
        )}
        {Array.isArray(draft.output?.image_alt_texts) && draft.output.image_alt_texts.length > 0 && (
          <details className="rounded-lg border border-slate-700 bg-slate-900 p-3 text-sm text-slate-300">
            <summary className="cursor-pointer font-medium text-white">Alt-тексты фотографий ({draft.output.image_alt_texts.length})</summary>
            <ol className="mt-3 space-y-1 pl-5 text-xs">
              {draft.output.image_alt_texts.map((alt: string, index: number) => <li key={index} className="list-decimal break-words">{alt}</li>)}
            </ol>
          </details>
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
        <details className="rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs text-slate-400">
          <summary className="cursor-pointer font-medium text-slate-300">Технический JSON</summary>
          <pre className="mt-3 max-h-96 max-w-full overflow-auto whitespace-pre-wrap break-all">{outputText}</pre>
        </details>
        {draft.status === 'draft' && (
          <div className="flex flex-wrap gap-2">
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
      </CardContent>}
    </Card>
  )
}

function nestedOutputValue(output: Record<string, any>, path: string) {
  return path.split('.').reduce<any>((value, key) => value?.[key], output)
}

function formatValue(value: any, field?: string) {
  if (value === undefined || value === null || value === '') return '—'
  if (field === 'gender') return ({ female: 'Женский', male: 'Мужской', unisex: 'Унисекс' } as Record<string, string>)[String(value)] || String(value)
  return typeof value === 'string' ? value.replace(/\\n/g, '\n') : JSON.stringify(value, null, 2)
}

function formatAttributeValue(value: unknown, definition?: CatalogAttributeDefinition) {
  const values = attributeDisplayValues(value)
  if (values.length === 0) return '—'
  const displayValues = values.map((text) => {
    const dictionaryValue = definition?.dictionary_values?.find((candidate) => candidate.filter_value === text || candidate.canonical_value === text)
    return dictionaryValue?.canonical_value || text
  })
  return [...new Set(displayValues)].join(', ')
}

function attributeDisplayValues(value: unknown): string[] {
  if (value === undefined || value === null || value === '') return []
  if (Array.isArray(value)) return [...new Set(value.flatMap(attributeDisplayValues))]
  if (typeof value !== 'object') return [String(value)]

  const record = value as Record<string, unknown>
  if (record.display_value) return attributeDisplayValues([record.display_value, record.purity])
  const preferredKey = ['canonical_value', 'label', 'value', 'name', 'normalized_value', 'values', 'filter_value'].find((key) => attributeDisplayValues(record[key]).length > 0)
  if (preferredKey) return attributeDisplayValues(record[preferredKey])

  const ignored = new Set(['confidence', 'evidence', 'code', 'source'])
  return [...new Set(Object.entries(record).filter(([key]) => !ignored.has(key)).flatMap(([, item]) => attributeDisplayValues(item)))]
}

function isInteractiveElement(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest('a,button,input,textarea,select,label,[role="checkbox"]'))
}

function fieldLabel(field: string, attributeDefinitions?: Map<string, CatalogAttributeDefinition>) {
  const direct = PRODUCT_FIELDS.find((item) => item.key === field || item.outputKey === field)?.label
  if (direct) return direct
  const attributeCode = field.replace(/^catalog_attributes\./, '')
  const definition = attributeDefinitions?.get(attributeCode)
  if (definition) return definition.label
  if (AI_FIELD_LABELS[attributeCode]) return AI_FIELD_LABELS[attributeCode]
  if (field.startsWith('catalog_attributes.')) return `Характеристика «${attributeCode}»`
  return field || 'Поле товара'
}

function batchTimingLabel(batch: SeoAiBatch, now: number) {
  const start = new Date(batch.started_at || batch.created_at).getTime()
  const end = batch.completed_at
    ? new Date(batch.completed_at).getTime()
    : ['completed', 'failed', 'canceled'].includes(batch.status)
      ? new Date(batch.updated_at).getTime()
      : now
  const elapsed = Math.max(0, end - start)
  const processed = batch.status === 'completed' ? batch.total_count : batch.success_count + batch.failure_count
  const average = processed > 0 ? elapsed / processed : 0
  return `Всего ${formatDuration(elapsed)} · в среднем ${processed > 0 ? formatDuration(average) : '—'} на товар`
}

function formatDuration(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours} ч ${minutes} мин ${seconds} сек`
  if (minutes > 0) return `${minutes} мин ${seconds} сек`
  return `${seconds} сек`
}

function batchStatusLabel(status: SeoAiBatch['status']) {
  return ({
    pending: 'Ожидает',
    running: 'В работе',
    paused: 'На паузе',
    completed: 'Готово',
    failed: 'Ошибка',
    canceled: 'Отменено',
  } as Record<SeoAiBatch['status'], string>)[status]
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
