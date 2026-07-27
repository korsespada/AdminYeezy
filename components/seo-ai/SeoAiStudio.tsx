'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import Image from 'next/image'
import { Bot, Check, ChevronDown, ChevronUp, Clock3, ExternalLink, Folder, Layers, Loader2, Pause, Pencil, Play, RefreshCw, RotateCcw, Save, Search, Sparkles, Trash2, X } from 'lucide-react'
import {
  applySeoAiDraftAction,
  applySeoAiDecisionGroupAction,
  createSeoAiBatchAction,
  createSeoAiSuggestedSubcategoryAction,
  deleteSeoAiDraftAction,
  getSeoAiBatchAction,
  listSeoAiDraftsAction,
  listSeoAiBatchesAction,
  previewSeoAiBatchAction,
  rejectSeoAiDraftAction,
  renameSeoAiBatchAction,
  reviewSeoAiBatchAction,
  retrySeoAiGenerationAction,
  runSeoAiGenerationAction,
  searchSeoAiProductsAction,
  updateSeoAiSettingsAction,
  updateSeoAiBatchStateAction,
} from '@/actions/seo-ai'
import type { Brand, Category, Product, SeoAiBatch, SeoAiBatchPreview, SeoAiBatchSummary, SeoAiGeneration, SeoAiSetting, Subcategory } from '@/lib/types'
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
  const [batchImages, setBatchImages] = useState(false)
  const [batchAutoApply, setBatchAutoApply] = useState(false)
  const [batchLimit, setBatchLimit] = useState(100)
  const [batchConcurrency, setBatchConcurrency] = useState(5)
  const [batchPreview, setBatchPreview] = useState<SeoAiBatchPreview | null>(null)
  const [batchPreviewLoading, setBatchPreviewLoading] = useState(false)
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

  const batchIdsParsed = useMemo(() => batchIds
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean), [batchIds])

  useEffect(() => {
    let current = true
    const timer = window.setTimeout(async () => {
      setBatchPreviewLoading(true)
      const result = await previewSeoAiBatchAction({
        ids: batchIdsParsed,
        brand: batchBrand === '__none__' ? undefined : batchBrand,
        category: batchCategory === '__none__' ? undefined : batchCategory,
        subcategory: batchSubcategory === '__none__' ? undefined : batchSubcategory,
        gender: batchGender === '__none__' ? undefined : batchGender,
        status: batchStatus,
        missingSeoOnly: batchMissingOnly,
      })
      if (!current) return
      setBatchPreviewLoading(false)
      if (!result.success) {
        setBatchPreview(null)
        return
      }

      const preview = result.data as SeoAiBatchPreview
      setBatchPreview(preview)
      setBatchBrand((value) => value === '__none__' || preview.brands.some((item) => item.id === value) ? value : '__none__')
      setBatchCategory((value) => value === '__none__' || preview.categories.some((item) => item.id === value) ? value : '__none__')
      setBatchSubcategory((value) => value === '__none__' || preview.subcategories.some((item) => item.id === value) ? value : '__none__')
      setBatchGender((value) => value === '__none__' || preview.genders.some((item) => item.value === value) ? value : '__none__')
    }, 250)
    return () => {
      current = false
      window.clearTimeout(timer)
    }
  }, [batchBrand, batchCategory, batchGender, batchIdsParsed, batchMissingOnly, batchStatus, batchSubcategory])

  const subcategoriesForBatch = useMemo(
    () => (batchPreview?.subcategories || subcategories.map((subcategory) => ({
      id: subcategory.id,
      name: subcategory.name,
      category_id: subcategory.category,
      count: 0,
    }))).filter((subcategory) => batchCategory === '__none__' || subcategory.category_id === batchCategory),
    [batchCategory, batchPreview, subcategories]
  )
  const draftGroups = useMemo(() => {
    const knownBatchIds = new Set(batches.map((batch) => batch.id))
    const batchGroups = batches.map((batch) => ({ batch, drafts: drafts.filter((draft) => draft.batch_id === batch.id) }))
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
      const result = await createSeoAiBatchAction({
        ids: batchIdsParsed,
        brand: batchBrand === '__none__' ? undefined : batchBrand,
        category: batchCategory === '__none__' ? undefined : batchCategory,
        subcategory: batchSubcategory === '__none__' ? undefined : batchSubcategory,
        gender: batchGender === '__none__' ? undefined : batchGender,
        status: batchStatus === '__all__' ? undefined : batchStatus,
        missingSeoOnly: batchMissingOnly,
        includeImages: batchImages,
        autoApply: batchAutoApply,
        itemLimit: batchLimit,
        concurrency: batchConcurrency,
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

  async function reviewBatch(id: string, action: 'apply_drafts' | 'apply_safe_drafts' | 'reject_drafts' | 'requeue_rejected') {
    const result = await reviewSeoAiBatchAction(id, action)
    if (!result.success) {
      setStatus('error', result.error || 'Не удалось выполнить массовое действие')
      return false
    }

    const batchDrafts: SeoAiGeneration[] = result.data.generations || []
    setDrafts((prev) => [...batchDrafts, ...prev.filter((draft) => draft.batch_id !== id)])
    setBatches((prev) => prev.map((batch) => batch.id === id ? result.data.batch : batch))
    const errors = result.data.errors?.length || 0
    setStatus(errors > 0 ? 'error' : 'success', `Обработано товаров: ${result.data.processed}${errors > 0 ? ` · ошибок: ${errors}` : ''}`)
    return errors === 0
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
                    <SelectContent><SelectItem value="__none__">Все бренды</SelectItem>{(batchPreview?.brands || brands).map((brand) => <SelectItem key={brand.id} value={brand.id}>{brand.name}{'count' in brand ? ` (${brand.count})` : ''}</SelectItem>)}</SelectContent>
                  </Select>
                  <Select value={batchCategory} onValueChange={(value) => { setBatchCategory(value); setBatchSubcategory('__none__') }}>
                    <SelectTrigger className="bg-slate-900"><SelectValue placeholder="Категория" /></SelectTrigger>
                    <SelectContent><SelectItem value="__none__">Все категории</SelectItem>{(batchPreview?.categories || categories).map((category) => <SelectItem key={category.id} value={category.id}>{category.name}{'count' in category ? ` (${category.count})` : ''}</SelectItem>)}</SelectContent>
                  </Select>
                  <Select value={batchSubcategory} onValueChange={setBatchSubcategory} disabled={batchCategory === '__none__'}>
                    <SelectTrigger className="bg-slate-900"><SelectValue placeholder="Подкатегория" /></SelectTrigger>
                    <SelectContent><SelectItem value="__none__">Все подкатегории</SelectItem>{subcategoriesForBatch.map((subcategory) => <SelectItem key={subcategory.id} value={subcategory.id}>{subcategory.name}{subcategory.count ? ` (${subcategory.count})` : ''}</SelectItem>)}</SelectContent>
                  </Select>
                  <Select value={batchGender} onValueChange={setBatchGender}>
                    <SelectTrigger className="bg-slate-900"><SelectValue placeholder="Гендер" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Любой гендер</SelectItem>
                      {(batchPreview?.genders || [{ value: 'female', count: 0 }, { value: 'male', count: 0 }, { value: 'unisex', count: 0 }]).map((item) => (
                        <SelectItem key={item.value} value={item.value}>{genderLabel(item.value)}{item.count ? ` (${item.count})` : ''}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={batchStatus} onValueChange={setBatchStatus} disabled>
                    <SelectTrigger className="bg-slate-900"><SelectValue placeholder="Статус" /></SelectTrigger>
                    <SelectContent><SelectItem value="active">Опубликованные (Active)</SelectItem></SelectContent>
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
                  <div className="space-y-1">
                    <Label>Параллельных товаров</Label>
                    <Select value={String(batchConcurrency)} onValueChange={(value) => setBatchConcurrency(Number(value))}>
                      <SelectTrigger className="bg-slate-900"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">1 — последовательно</SelectItem>
                        <SelectItem value="3">3</SelectItem>
                        <SelectItem value="5">5 — рекомендуется</SelectItem>
                        <SelectItem value="10">10 — максимум</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-slate-500">Одновременно обрабатываемых карточек</p>
                  </div>
                </div>
              </div>
              <div className="space-y-4 rounded-lg border border-slate-700 bg-slate-900 p-4">
                <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/10 p-3">
                  <p className="text-sm font-semibold text-indigo-100">
                    {batchPreviewLoading ? 'Считаем товары…' : `Под условия подходит: ${batchPreview?.total_count ?? '—'}`}
                  </p>
                  {batchPreview && batchPreview.total_count > batchLimit && <p className="mt-1 text-xs text-indigo-300">В эту партию попадут первые {batchLimit}. Следующую можно запустить с теми же фильтрами.</p>}
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-300"><Checkbox checked={batchMissingOnly} onCheckedChange={(value) => setBatchMissingOnly(Boolean(value))} /> Только товары с пустым SEO/описанием</label>
                <label className="flex items-center gap-2 text-sm text-slate-300"><Checkbox checked={batchImages} onCheckedChange={(value) => setBatchImages(Boolean(value))} /> Анализировать до 9 фото сеткой 3×3</label>
                <label className="flex items-center gap-2 text-sm text-slate-300"><Checkbox checked={batchAutoApply} onCheckedChange={(value) => setBatchAutoApply(Boolean(value))} /> Автоприменение безопасных полей</label>
                <p className="text-xs leading-5 text-slate-500">Модель и новая подкатегория всегда остаются на ручной проверке. Гендер, характеристики и существующая подкатегория применяются автоматически только при уверенности от 90%.</p>
                <Button type="button" onClick={createBatch} disabled={isPending || batchPreviewLoading || batchPreview?.total_count === 0} className="w-full">
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
                    <p className="mt-1 text-xs text-slate-500">Запрошено: {batch.item_limit || batch.total_count} · параллельно: {batch.concurrency || 1} · {new Date(batch.created_at).toLocaleString('ru-RU')} · {batchStatusLabel(batch.status)}{batch.auto_apply ? ' · автоприменение' : ''}</p>
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
              {draftGroups.length === 0 ? <p className="text-sm text-slate-400">Черновиков пока нет.</p> : draftGroups.map((group) => (
                <DraftFolder
                  key={group.batch?.id || 'standalone'}
                  batch={group.batch}
                  drafts={group.drafts}
                  attributeDefinitions={attributeDefinitions}
                  onRename={renameBatch}
                  onBulkAction={reviewBatch}
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

type SeoAiDecisionKind = 'subcategory' | 'attribute' | 'value'

interface SeoAiDecisionGroup {
  key: string
  kind: SeoAiDecisionKind
  title: string
  detail: string
  confidence: number
  draftIds: string[]
  examples: Array<{
    draftId: string
    label: string
    imageUrl: string
    url: string
  }>
}

function buildDecisionGroups(drafts: SeoAiGeneration[], attributeDefinitions: CatalogAttributeDefinition[]) {
  const definitions = new Map(attributeDefinitions.map((definition) => [definition.code, definition]))
  const groups = new Map<string, SeoAiDecisionGroup>()

  drafts.filter((draft) => draft.status === 'draft' && draft.draft_type === 'product').forEach((draft) => {
    const product = draft.input_snapshot?.product || {}
    const isWatch = isWatchTaxonomy(draft.input_snapshot?.catalog?.current_taxonomy)
    const suggestion = draft.output?.subcategory_suggestion

    if (!isWatch && suggestion?.kind === 'new' && suggestion?.name) {
      addDecisionGroup(groups, {
        key: `subcategory:${suggestion.parent_category_id || ''}:${normalizeDecisionValue(suggestion.name)}`,
        kind: 'subcategory',
        title: `Создать подкатегорию «${suggestion.name}»`,
        detail: suggestion.evidence || '',
        confidence: Number(suggestion.confidence || 0),
      }, draft)
    }

    const before = product.catalog_attributes || {}
    const after = normalizeVisibleAttributes(draft.output?.catalog_attributes || {}, isWatch)
    Object.entries(after).forEach(([code, value]) => {
      const definition = definitions.get(code)
      if (!definition || !['enum', 'multi_enum'].includes(definition.value_type)) return
      if ((definition.dictionary_values?.length || 0) === 0 && (definition.values?.length || 0) === 0) return

      const suggested = formatAttributeValue(value, definition)
      const current = formatAttributeValue(before[code], definition)
      if (!suggested || suggested === '—' || normalizeDecisionValue(suggested) === normalizeDecisionValue(current)) return

      const kind: SeoAiDecisionKind = current === '—' ? 'attribute' : 'value'
      const confidence = Number(
        draft.output?.field_confidence?.[`catalog_attributes.${code}`]
        || draft.output?.field_confidence?.[code]
        || 0
      )
      const evidence = draft.output?.field_evidence?.[`catalog_attributes.${code}`]
        || draft.output?.field_evidence?.[code]
        || ''
      addDecisionGroup(groups, {
        key: `${kind}:${code}:${normalizeDecisionValue(suggested)}`,
        kind,
        title: `${definition.label}: ${suggested}`,
        detail: String(evidence),
        confidence,
      }, draft)
    })
  })

  return [...groups.values()].sort((left, right) => {
    const priority = { subcategory: 0, attribute: 1, value: 2 }
    return priority[left.kind] - priority[right.kind] || right.draftIds.length - left.draftIds.length
  })
}

function addDecisionGroup(
  groups: Map<string, SeoAiDecisionGroup>,
  proposal: Pick<SeoAiDecisionGroup, 'key' | 'kind' | 'title' | 'detail' | 'confidence'>,
  draft: SeoAiGeneration,
) {
  const current: SeoAiDecisionGroup = groups.get(proposal.key) || { ...proposal, draftIds: [], examples: [] }
  if (!current.draftIds.includes(draft.id)) current.draftIds.push(draft.id)
  current.confidence = Math.max(current.confidence, proposal.confidence)
  if (!current.detail && proposal.detail) current.detail = proposal.detail
  if (current.examples.length < 4) {
    const slug = draft.input_snapshot?.product?.slug || ''
    current.examples.push({
      draftId: draft.id,
      label: draft.target_label || draft.input_snapshot?.product?.name || 'Товар',
      imageUrl: draftImageUrl(draft),
      url: slug ? storefrontProductUrl(slug) : '',
    })
  }
  groups.set(proposal.key, current)
}

function normalizeDecisionValue(value: unknown) {
  return String(value || '').trim().toLocaleLowerCase('ru-RU').replace(/ё/g, 'е')
}

function decisionKindLabel(kind: SeoAiDecisionKind) {
  if (kind === 'subcategory') return 'Новая подкатегория'
  if (kind === 'attribute') return 'Новая характеристика'
  return 'Новое значение'
}

function DraftFolder({
  batch,
  drafts,
  attributeDefinitions,
  onRename,
  onBulkAction,
  onChange,
  onDelete,
}: {
  batch: SeoAiBatch | null
  drafts: SeoAiGeneration[]
  attributeDefinitions: CatalogAttributeDefinition[]
  onRename: (id: string, name: string) => Promise<boolean>
  onBulkAction: (id: string, action: 'apply_drafts' | 'apply_safe_drafts' | 'reject_drafts' | 'requeue_rejected') => Promise<boolean>
  onChange: (draft: SeoAiGeneration) => void
  onDelete: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(batch?.name || '')
  const [folderDrafts, setFolderDrafts] = useState(drafts)
  const [view, setView] = useState<'attention' | 'errors' | 'all'>('attention')
  const [selectedDecision, setSelectedDecision] = useState<string | null>(null)
  const [decisionInFlight, setDecisionInFlight] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isRenaming, startRenaming] = useTransition()
  const [isReviewing, startReviewing] = useTransition()
  const label = batch?.name || (batch ? `Выгрузка ${new Date(batch.created_at).toLocaleString('ru-RU')}` : 'Отдельные товары')
  const summary = batch && folderDrafts.length < batch.total_count
    ? batch.summary || summarizeDrafts(folderDrafts)
    : summarizeDrafts(folderDrafts)
  const readyCount = summary.status_counts.draft || 0
  const safeCount = summary.safe_count || 0
  const rejectedCount = summary.status_counts.rejected || 0
  const failedCount = summary.status_counts.failed || 0
  const decisionGroups = buildDecisionGroups(folderDrafts, attributeDefinitions)
  const selectedDecisionGroup = decisionGroups.find((group) => group.key === selectedDecision)
  const visibleDrafts = folderDrafts.filter((draft) => {
    if (selectedDecisionGroup && !selectedDecisionGroup.draftIds.includes(draft.id)) return false
    if (view === 'errors') return draft.status === 'failed'
    if (view === 'attention') return draftNeedsAttention(draft)
    return true
  })

  useEffect(() => {
    if (drafts.length === 0) return
    setFolderDrafts((current) => {
      const merged = new Map(current.map((draft) => [draft.id, draft]))
      drafts.forEach((draft) => merged.set(draft.id, draft))
      return [...merged.values()]
    })
  }, [drafts])

  function saveName() {
    if (!batch || !name.trim()) return
    startRenaming(async () => {
      if (await onRename(batch.id, name.trim())) setEditing(false)
    })
  }

  async function toggleExpanded() {
    if (expanded) {
      setExpanded(false)
      return
    }

    if (batch && folderDrafts.length < batch.total_count) {
      setIsLoading(true)
      const result = await getSeoAiBatchAction(batch.id)
      setIsLoading(false)
      if (!result.success) {
        alert(result.error || 'Не удалось загрузить товары выгрузки')
        return
      }
      setFolderDrafts(result.data.generations || [])
    }
    setView(summary.attention_count > 0 ? 'attention' : 'all')
    setExpanded(true)
  }

  function runBulkAction(action: 'apply_drafts' | 'apply_safe_drafts' | 'reject_drafts' | 'requeue_rejected') {
    if (!batch) return
    const confirmation = action === 'apply_drafts'
      ? `Применить все ${readyCount} готовых черновиков? ${summary.attention_count > 0 ? `${summary.attention_count} из них требуют внимания.` : ''}`
      : action === 'apply_safe_drafts'
        ? `Применить ${safeCount} безопасных черновиков? Спорные товары останутся на проверке.`
        : action === 'reject_drafts'
          ? `Отклонить ${readyCount} готовых черновиков? Их можно будет вернуть в очередь отдельной кнопкой.`
          : `Вернуть ${rejectedCount} отклонённых товаров в очередь на новую генерацию?`
    if (!window.confirm(confirmation)) return

    startReviewing(async () => { await onBulkAction(batch.id, action) })
  }

  function applyDecisionGroup(group: SeoAiDecisionGroup) {
    const entityText = group.kind === 'subcategory' ? 'Подкатегория будет создана и назначена товарам. ' : ''
    if (!window.confirm(`${entityText}Будут применены все подготовленные изменения для ${group.draftIds.length} товаров. Продолжить?`)) return

    setDecisionInFlight(group.key)
    void applySeoAiDecisionGroupAction({
      draftIds: group.draftIds,
      createSubcategory: group.kind === 'subcategory',
    }).then((result) => {
      setDecisionInFlight(null)
      if (!result.success) {
        alert(result.error || 'Не удалось применить групповое решение')
        return
      }

      const updated: SeoAiGeneration[] = result.data.generations || []
      const updatedById = new Map(updated.map((draft) => [draft.id, draft]))
      setFolderDrafts((current) => current.map((draft) => updatedById.get(draft.id) || draft))
      updated.forEach(onChange)
      const errors = result.data.errors?.length || 0
      if (errors > 0) alert(`Применено: ${result.data.processed}. Ошибок: ${errors}.`)
      setSelectedDecision(null)
    })
  }

  return (
    <section className="min-w-0 overflow-hidden rounded-xl border border-slate-700 bg-slate-900/60">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        className="flex cursor-pointer items-center justify-between gap-3 p-3 hover:bg-slate-800/70 sm:p-4"
        onClick={(event) => { if (!isInteractiveElement(event.target)) void toggleExpanded() }}
        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void toggleExpanded() } }}
      >
        <div className="flex min-w-0 items-center gap-3">
          <Folder className="h-5 w-5 shrink-0 text-indigo-400" />
          <div className="min-w-0">
            <p className="truncate font-semibold text-white">{label}</p>
            <p className="text-xs text-slate-400">
              {batch?.total_count || folderDrafts.length} товаров{batch ? ` · ${batchStatusLabel(batch.status)}` : ''}
              {` · готово ${readyCount} · безопасно ${safeCount} · внимание ${summary.attention_count} · ошибки ${failedCount}`}
            </p>
            <p className="mt-1 hidden text-xs text-slate-500 md:block">{summaryFieldsLabel(summary)}{summaryProblemsLabel(summary)}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {batch && readyCount > 0 && <Button type="button" size="sm" onClick={(event) => { event.stopPropagation(); runBulkAction('apply_drafts') }} disabled={isReviewing}><Check className="h-4 w-4" /><span className="hidden lg:inline">Принять все готовые ({readyCount})</span></Button>}
          {batch && safeCount > 0 && <Button type="button" size="sm" onClick={(event) => { event.stopPropagation(); runBulkAction('apply_safe_drafts') }} disabled={isReviewing}><Check className="h-4 w-4" /><span className="hidden lg:inline">Применить безопасные</span></Button>}
          {batch && readyCount > 0 && <Button type="button" size="sm" variant="outline" onClick={(event) => { event.stopPropagation(); runBulkAction('reject_drafts') }} disabled={isReviewing}><X className="h-4 w-4" /><span className="hidden lg:inline">Отклонить готовые</span></Button>}
          {batch && rejectedCount > 0 && <Button type="button" size="sm" variant="outline" onClick={(event) => { event.stopPropagation(); runBulkAction('requeue_rejected') }} disabled={isReviewing}><RotateCcw className="h-4 w-4" /><span className="hidden lg:inline">Вернуть отклонённые</span></Button>}
          {batch && <Button type="button" size="icon" variant="ghost" aria-label="Переименовать выгрузку" onClick={(event) => { event.stopPropagation(); setEditing(true) }}><Pencil className="h-4 w-4" /></Button>}
          {isLoading ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" /> : expanded ? <ChevronUp className="h-5 w-5 text-slate-400" /> : <ChevronDown className="h-5 w-5 text-slate-400" />}
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
          {decisionGroups.length > 0 && (
            <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-3 sm:p-4">
              <div className="mb-3">
                <p className="font-semibold text-white">Решения ИИ</p>
                <p className="mt-1 text-xs text-slate-400">Одинаковые предложения собраны вместе. Их можно принять, не открывая каждый товар.</p>
              </div>
              <div className="grid gap-3">
                {decisionGroups.map((group) => (
                  <div key={group.key} className="rounded-lg border border-slate-700 bg-slate-950/70 p-3">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline">{decisionKindLabel(group.kind)}</Badge>
                          <p className="font-medium text-white">{group.title}</p>
                          <span className="text-xs text-slate-400">{group.draftIds.length} товаров</span>
                        </div>
                        {group.detail && <p className="mt-1 break-words text-sm text-slate-300">{group.detail}</p>}
                        {group.confidence > 0 && <p className="mt-1 text-xs text-slate-500">Уверенность: {Math.round(group.confidence * 100)}%</p>}
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        <Button type="button" size="sm" variant="outline" onClick={() => { setSelectedDecision(group.key); setView('all') }}>Показать товары</Button>
                        <Button type="button" size="sm" onClick={() => applyDecisionGroup(group)} disabled={decisionInFlight !== null}>
                          {decisionInFlight === group.key ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                          Принять для всех
                        </Button>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {group.examples.map((example) => (
                        <a key={example.draftId} href={example.url || '#'} target={example.url ? '_blank' : undefined} rel={example.url ? 'noreferrer' : undefined} className="flex max-w-full items-center gap-2 rounded-md border border-slate-700 bg-slate-900 p-1.5 pr-3 hover:border-sky-500/60">
                          {example.imageUrl ? <Image src={example.imageUrl} alt="" width={40} height={40} className="h-10 w-10 shrink-0 rounded object-cover" /> : <div className="h-10 w-10 shrink-0 rounded bg-slate-800" />}
                          <span className="max-w-56 truncate text-xs text-sky-300">{example.label}</span>
                          {example.url && <ExternalLink className="h-3 w-3 shrink-0 text-slate-500" />}
                        </a>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {selectedDecisionGroup && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sm text-sky-200">
              <span>Показаны товары решения «{selectedDecisionGroup.title}» ({selectedDecisionGroup.draftIds.length})</span>
              <Button type="button" size="sm" variant="ghost" onClick={() => setSelectedDecision(null)}>Сбросить</Button>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant={view === 'attention' ? 'default' : 'outline'} onClick={() => setView('attention')}>Требуют внимания ({summary.attention_count})</Button>
            <Button type="button" size="sm" variant={view === 'errors' ? 'default' : 'outline'} onClick={() => setView('errors')}>Ошибки ({failedCount})</Button>
            <Button type="button" size="sm" variant={view === 'all' ? 'default' : 'outline'} onClick={() => setView('all')}>Все ({folderDrafts.length})</Button>
          </div>
          {visibleDrafts.length === 0 && <p className="rounded-lg border border-slate-700 bg-slate-950/50 p-4 text-sm text-slate-400">В этой группе товаров нет.</p>}
          {visibleDrafts.map((draft) => (
            <DraftCard
              key={draft.id}
              draft={draft}
              compact={folderDrafts.length > 3}
              attributeDefinitions={attributeDefinitions}
              onChange={(next) => {
                setFolderDrafts((current) => current.map((item) => item.id === next.id ? next : item))
                onChange(next)
              }}
              onDelete={(id) => {
                setFolderDrafts((current) => current.filter((item) => item.id !== id))
                onDelete(id)
              }}
            />
          ))}
        </div>
      )}
    </section>
  )
}

const SUMMARY_FIELD_LABELS: Record<string, string> = {
  name: 'название',
  description: 'описание',
  h1: 'H1',
  seo_title: 'SEO title',
  seo_description: 'SEO description',
  gender: 'гендер',
  catalog_attributes: 'характеристики',
  image_alt_texts: 'alt фото',
}

const WATCH_ATTRIBUTE_CODES = new Set([
  'colors',
  'model_name',
  'watch_movement',
  'watch_case_size',
  'watch_case_material',
  'strap_material',
  'dial_color',
  'water_resistance',
])

const DEPRECATED_AI_ATTRIBUTE_CODES = new Set([
  'season',
  'age_group',
  'country_of_origin',
  'collection',
  'pattern',
  'print',
])

function summarizeDrafts(drafts: SeoAiGeneration[]): SeoAiBatchSummary {
  const statusCounts: Record<string, number> = {}
  const fieldCounts: Record<string, number> = {}
  const problemCounts = { low_confidence: 0, conflicts: 0, quality_warnings: 0, subcategory: 0, invalid_attributes: 0 }
  let safeCount = 0
  let attentionCount = 0

  drafts.forEach((draft) => {
    statusCounts[draft.status] = (statusCounts[draft.status] || 0) + 1
    if (draft.status !== 'draft') return
    const isWatch = isWatchTaxonomy(draft.input_snapshot?.catalog?.current_taxonomy)
    const outputFields: Record<string, unknown> = {
      name: draft.output?.suggested_name,
      description: draft.output?.description,
      h1: draft.output?.h1,
      seo_title: draft.output?.seo_title,
      seo_description: draft.output?.seo_description,
      gender: draft.output?.gender,
      catalog_attributes: normalizeVisibleAttributes(draft.output?.catalog_attributes || {}, isWatch),
      image_alt_texts: draft.output?.image_alt_texts,
    }
    Object.entries(outputFields).forEach(([field, value]) => {
      if (valuePresent(value)) fieldCounts[field] = (fieldCounts[field] || 0) + 1
    })
    const lowConfidence = Object.values(draft.output?.field_confidence || {}).some((value) => Number(value) > 0 && Number(value) < 0.9)
    const conflicts = Array.isArray(draft.output?.conflicts) && draft.output.conflicts.some((conflict: any) => visibleConflict(conflict, isWatch))
    const warnings = Array.isArray(draft.output?.quality_warnings) && draft.output.quality_warnings.length > 0
    const subcategory = !isWatch && ['existing', 'new'].includes(draft.output?.subcategory_suggestion?.kind)
    if (lowConfidence) problemCounts.low_confidence += 1
    if (conflicts) problemCounts.conflicts += 1
    if (warnings) problemCounts.quality_warnings += 1
    if (subcategory) problemCounts.subcategory += 1
    if (lowConfidence || conflicts || warnings || subcategory) attentionCount += 1
    else safeCount += 1
  })

  return { status_counts: statusCounts, field_counts: fieldCounts, problem_counts: problemCounts, safe_count: safeCount, attention_count: attentionCount }
}

function draftNeedsAttention(draft: SeoAiGeneration) {
  if (draft.status !== 'draft') return false
  const isWatch = isWatchTaxonomy(draft.input_snapshot?.catalog?.current_taxonomy)
  const lowConfidence = Object.values(draft.output?.field_confidence || {}).some((value) => Number(value) > 0 && Number(value) < 0.9)
  const conflicts = Array.isArray(draft.output?.conflicts) && draft.output.conflicts.some((conflict: any) => visibleConflict(conflict, isWatch))
  const warnings = Array.isArray(draft.output?.quality_warnings) && draft.output.quality_warnings.length > 0
  const subcategory = !isWatch && ['existing', 'new'].includes(draft.output?.subcategory_suggestion?.kind)
  return lowConfidence || conflicts || warnings || subcategory
}

function summaryFieldsLabel(summary: SeoAiBatchSummary) {
  const fields = Object.entries(summary.field_counts)
    .filter(([, count]) => count > 0)
    .map(([field, count]) => `${SUMMARY_FIELD_LABELS[field] || field} ${count}`)
  return fields.length > 0 ? `Изменения: ${fields.join(' · ')}` : 'Изменений пока нет'
}

function summaryProblemsLabel(summary: SeoAiBatchSummary) {
  const labels = [
    ['низкая уверенность', summary.problem_counts.low_confidence],
    ['противоречия', summary.problem_counts.conflicts],
    ['предупреждения', summary.problem_counts.quality_warnings],
    ['подкатегория', summary.problem_counts.subcategory],
    ['недопустимые поля', summary.problem_counts.invalid_attributes],
  ].filter(([, count]) => Number(count) > 0).map(([label, count]) => `${label} ${count}`)
  return labels.length > 0 ? ` · Проблемы: ${labels.join(' · ')}` : ''
}

function valuePresent(value: unknown) {
  if (Array.isArray(value)) return value.length > 0
  if (value && typeof value === 'object') return Object.keys(value).length > 0
  return value !== undefined && value !== null && value !== ''
}

function isWatchTaxonomy(taxonomy: any) {
  const root = taxonomy?.top_level || taxonomy?.assigned || {}
  const slug = String(root.slug || '').toLocaleLowerCase('ru-RU')
  const name = String(root.name || '').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е')
  return slug === 'chasy' || slug.startsWith('chasy-test-') || name === 'часы'
}

function normalizeVisibleAttributes(attributes: Record<string, any>, isWatch: boolean) {
  const supported = Object.fromEntries(Object.entries(attributes).filter(([code]) => !DEPRECATED_AI_ATTRIBUTE_CODES.has(code)))
  if (!isWatch) return supported

  const visible = Object.fromEntries(Object.entries(supported).filter(([code]) => WATCH_ATTRIBUTE_CODES.has(code)))
  if (!visible.watch_case_size && attributes.dimensions) {
    const dimensions = numericValues(attributes.dimensions).filter((value) => value >= 16 && value <= 60)
    const value = Math.max(...dimensions)
    if (Number.isFinite(value)) visible.watch_case_size = { value, display_value: `${formatDecimal(value)} мм` }
  }
  return visible
}

function visibleConflict(conflict: any, isWatch: boolean) {
  const field = String(conflict?.field || '')
  if (field.startsWith('catalog_attributes.')) {
    const code = field.replace('catalog_attributes.', '')
    if (DEPRECATED_AI_ATTRIBUTE_CODES.has(code)) return false
    if (!isWatch) return true
    if (!WATCH_ATTRIBUTE_CODES.has(code)) return false
  }
  if (!isWatch) return true
  if (field !== 'catalog_attributes.watch_case_size') return true
  const current = Math.max(...numericValues(conflict?.current_value).filter((value) => value >= 16 && value <= 60))
  const suggested = Math.max(...numericValues(conflict?.suggested_value).filter((value) => value >= 16 && value <= 60))
  return !Number.isFinite(current) || !Number.isFinite(suggested) || current !== suggested
}

function numericValues(value: unknown): number[] {
  if (Array.isArray(value)) return value.flatMap(numericValues)
  if (value && typeof value === 'object') return Object.values(value).flatMap(numericValues)
  return String(value ?? '').match(/\d+(?:[.,]\d+)?/g)?.map((number) => Number(number.replace(',', '.'))) || []
}

function formatDecimal(value: number) {
  return String(value).replace('.', ',')
}

function genderLabel(value: string) {
  return ({ female: 'Женский', male: 'Мужской', unisex: 'Унисекс' } as Record<string, string>)[value] || value
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
  const imageUrl = draftImageUrl(draft)
  const productSlug = productBefore.slug
  const taxonomy = draft.input_snapshot?.catalog?.current_taxonomy
  const isWatch = isWatchTaxonomy(taxonomy)
  const attributesAfter = normalizeVisibleAttributes(draft.output?.catalog_attributes || {}, isWatch)
  const subcategorySuggestion = draft.output?.subcategory_suggestion
  const visibleConflicts = Array.isArray(draft.output?.conflicts)
    ? draft.output.conflicts.filter((conflict: any) => visibleConflict(conflict, isWatch))
    : []
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
        {draft.status === 'draft' && !isWatch && subcategorySuggestion?.kind && subcategorySuggestion.kind !== 'none' && (
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
        {visibleConflicts.length > 0 && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
            <p className="font-semibold">Обнаружены противоречия</p>
            {visibleConflicts.map((conflict: any, index: number) => <p key={index} className="mt-1 break-words"><strong>{fieldLabel(conflict.field, attributeDefinitionsByCode)}:</strong> {conflict.evidence} ({Math.round(Number(conflict.confidence || 0) * 100)}%)</p>)}
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
            {PRODUCT_FIELDS.filter((field) => !isWatch || field.key !== 'subcategory_suggestion').map((field) => (
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
