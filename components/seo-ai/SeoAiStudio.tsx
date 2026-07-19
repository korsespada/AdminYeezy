'use client'

import { useMemo, useState, useTransition, type ReactNode } from 'react'
import { Bot, Check, Layers, Lightbulb, Loader2, RefreshCw, Save, Search, Sparkles, Trash2, X } from 'lucide-react'
import {
  applySeoAiDraftAction,
  createSeoAiBatchAction,
  createSeoAiLandingIdeasAction,
  deleteSeoAiDraftAction,
  listSeoAiDraftsAction,
  rejectSeoAiDraftAction,
  runSeoAiGenerationAction,
  searchSeoAiProductsAction,
  updateSeoAiSettingsAction,
} from '@/actions/seo-ai'
import type { Brand, Category, Product, SeoAiGeneration, SeoAiSetting, Subcategory } from '@/lib/types'
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
  product_text: 'Товар: текстовый анализ',
  product_vision: 'Товар: фото-анализ',
  product_writer: 'Товар: финальный writer',
  brand_writer: 'Бренды',
  category_writer: 'Категории',
  landing_ideas: 'Идеи лендингов',
  catalog_attribute_refiner: 'Товары: нормализация атрибутов',
}

const PRODUCT_FIELDS = [
  { key: 'description', label: 'Описание' },
  { key: 'h1', label: 'H1' },
  { key: 'seo_title', label: 'SEO title' },
  { key: 'seo_description', label: 'SEO description' },
  { key: 'image_alt_texts', label: 'Alt фото' },
  { key: 'suggested_name', label: 'Название' },
]

interface SeoAiStudioProps {
  initialSettings: SeoAiSetting[]
  initialDrafts: SeoAiGeneration[]
  brands: Brand[]
  categories: Category[]
  subcategories: Subcategory[]
}

export default function SeoAiStudio({ initialSettings, initialDrafts, brands, categories, subcategories }: SeoAiStudioProps) {
  const [settings, setSettings] = useState(initialSettings)
  const [drafts, setDrafts] = useState(initialDrafts)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [isPending, startTransition] = useTransition()

  const [productQuery, setProductQuery] = useState('')
  const [productResults, setProductResults] = useState<Product[]>([])
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [includeImages, setIncludeImages] = useState(false)

  const [batchIds, setBatchIds] = useState('')
  const [batchBrand, setBatchBrand] = useState('__none__')
  const [batchCategory, setBatchCategory] = useState('__none__')
  const [batchSubcategory, setBatchSubcategory] = useState('__none__')
  const [batchGender, setBatchGender] = useState('__none__')
  const [batchStatus, setBatchStatus] = useState('active')
  const [batchMissingOnly, setBatchMissingOnly] = useState(true)
  const [batchImages, setBatchImages] = useState(false)

  const [brandTarget, setBrandTarget] = useState(brands[0]?.id || '__none__')
  const [categoryTarget, setCategoryTarget] = useState(categories[0]?.id || '__none__')
  const [ideaBrand, setIdeaBrand] = useState('__none__')
  const [ideaCategory, setIdeaCategory] = useState('__none__')
  const [ideaGender, setIdeaGender] = useState('__none__')

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
        imageLimit: includeImages ? 3 : 0,
      })
      handleGenerationResult(result, 'Черновик товара создан')
    })
  }

  function runTargetGeneration(targetType: 'Brand' | 'Category', targetId: string) {
    if (!targetId || targetId === '__none__') {
      setStatus('error', 'Выберите цель генерации')
      return
    }

    startTransition(async () => {
      const result = await runSeoAiGenerationAction({ targetType, targetId })
      handleGenerationResult(result, 'SEO-черновик создан')
    })
  }

  function runLandingIdeas() {
    startTransition(async () => {
      const filters = {
        brand: ideaBrand === '__none__' ? undefined : ideaBrand,
        category: ideaCategory === '__none__' ? undefined : ideaCategory,
        gender: ideaGender === '__none__' ? undefined : ideaGender,
      }
      const result = await createSeoAiLandingIdeasAction(filters)
      handleGenerationResult(result, 'Идеи лендингов созданы')
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
      })

      if (result.success) {
        setDrafts((prev) => [...(result.data?.generations || []), ...prev])
        setStatus('success', `Batch завершён: ${result.data.batch.success_count}/${result.data.batch.total_count}`)
      } else {
        setStatus('error', result.error || 'Batch не создан')
      }
    })
  }

  function refreshDrafts() {
    startTransition(async () => {
      const result = await listSeoAiDraftsAction({ limit: 100 })
      if (result.success) {
        setDrafts(result.data || [])
        setStatus('success', 'Черновики обновлены')
      } else {
        setStatus('error', result.error || 'Не удалось обновить черновики')
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
          <TabsTrigger value="test">Тестовый товар</TabsTrigger>
          <TabsTrigger value="batch">Массово</TabsTrigger>
          <TabsTrigger value="brands">Бренды</TabsTrigger>
          <TabsTrigger value="categories">Категории</TabsTrigger>
          <TabsTrigger value="ideas">Идеи лендингов</TabsTrigger>
          <TabsTrigger value="drafts">Черновики</TabsTrigger>
          <TabsTrigger value="settings">Настройки</TabsTrigger>
        </TabsList>

        <TabsContent value="test">
          <Card className="border-slate-700 bg-slate-800">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-white"><Sparkles className="h-5 w-5 text-fuchsia-400" /> Тестовый товар</CardTitle>
              <CardDescription>Прогоняет text-pass, optional vision-pass и writer-pass. Товар не меняется до apply.</CardDescription>
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
                      Анализировать фото в base64
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
              <CardDescription>До 100 товаров за запуск. По умолчанию только текст, фото включаются отдельно.</CardDescription>
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
                <label className="flex items-center gap-2 text-sm text-slate-300"><Checkbox checked={batchImages} onCheckedChange={(value) => setBatchImages(Boolean(value))} /> Включить 1 фото на товар</label>
                <Button type="button" onClick={createBatch} disabled={isPending} className="w-full">
                  {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  Запустить batch
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="brands">
          <SimpleTargetCard title="Бренды" description="Создаёт draft для SeoLanding brand-{slug} со статусом needs_review после apply." icon={<Sparkles className="h-5 w-5 text-fuchsia-400" />}>
            <Select value={brandTarget} onValueChange={setBrandTarget}>
              <SelectTrigger className="bg-slate-900"><SelectValue /></SelectTrigger>
              <SelectContent>{brands.map((brand) => <SelectItem key={brand.id} value={brand.id}>{brand.name}</SelectItem>)}</SelectContent>
            </Select>
            <Button type="button" onClick={() => runTargetGeneration('Brand', brandTarget)} disabled={isPending}>Сгенерировать бренд</Button>
          </SimpleTargetCard>
        </TabsContent>

        <TabsContent value="categories">
          <SimpleTargetCard title="Категории и подкатегории" description="Создаёт draft SEO-текста для выбранной категории или подкатегории." icon={<Layers className="h-5 w-5 text-indigo-400" />}>
            <Select value={categoryTarget} onValueChange={setCategoryTarget}>
              <SelectTrigger className="bg-slate-900"><SelectValue /></SelectTrigger>
              <SelectContent>
                {categories.map((category) => <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>)}
                {subcategories.map((subcategory) => <SelectItem key={subcategory.id} value={subcategory.id}>{subcategory.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button type="button" onClick={() => runTargetGeneration('Category', categoryTarget)} disabled={isPending}>Сгенерировать категорию</Button>
          </SimpleTargetCard>
        </TabsContent>

        <TabsContent value="ideas">
          <SimpleTargetCard title="Идеи SEO-лендингов" description="Генерирует draft со списком новых landing ideas. Apply создаст SeoLanding со статусом needs_review." icon={<Lightbulb className="h-5 w-5 text-amber-400" />}>
            <div className="grid gap-3 md:grid-cols-3">
              <Select value={ideaBrand} onValueChange={setIdeaBrand}><SelectTrigger className="bg-slate-900"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__none__">Любой бренд</SelectItem>{brands.map((brand) => <SelectItem key={brand.id} value={brand.slug || brand.id}>{brand.name}</SelectItem>)}</SelectContent></Select>
              <Select value={ideaCategory} onValueChange={setIdeaCategory}><SelectTrigger className="bg-slate-900"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__none__">Любая категория</SelectItem>{categories.map((category) => <SelectItem key={category.id} value={category.slug || category.id}>{category.name}</SelectItem>)}</SelectContent></Select>
              <Select value={ideaGender} onValueChange={setIdeaGender}><SelectTrigger className="bg-slate-900"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__none__">Любой гендер</SelectItem><SelectItem value="female">Женский</SelectItem><SelectItem value="male">Мужской</SelectItem><SelectItem value="unisex">Унисекс</SelectItem></SelectContent></Select>
            </div>
            <Button type="button" onClick={runLandingIdeas} disabled={isPending}>Сгенерировать идеи</Button>
          </SimpleTargetCard>
        </TabsContent>

        <TabsContent value="drafts">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-white">Черновики</h2>
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

function SimpleTargetCard({ title, description, icon, children }: { title: string; description: string; icon: ReactNode; children: ReactNode }) {
  return (
    <Card className="border-slate-700 bg-slate-800">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-white">{icon} {title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-[1fr_auto]">{children}</CardContent>
    </Card>
  )
}

function productBrandLabel(product: Product) {
  const brand = product.expand?.brand
  if (Array.isArray(brand)) return brand.map((item) => item.name).filter(Boolean).join(', ')
  return brand?.name || ''
}

function DraftCard({ draft, onChange, onDelete }: { draft: SeoAiGeneration; onChange: (draft: SeoAiGeneration) => void; onDelete: (id: string) => void }) {
  const [fields, setFields] = useState(PRODUCT_FIELDS.filter((field) => field.key !== 'suggested_name').map((field) => field.key))
  const [isPending, startTransition] = useTransition()
  const outputText = JSON.stringify(draft.output, null, 2)

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

  return (
    <Card className="border-slate-700 bg-slate-800">
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle className="text-base text-white">{draft.target_label || draft.target_type} <span className="text-slate-500">· {draft.draft_type}</span></CardTitle>
            <CardDescription className="mt-1">{new Date(draft.created_at).toLocaleString('ru-RU')}</CardDescription>
          </div>
          <Badge className={draft.status === 'draft' ? 'bg-indigo-600' : draft.status === 'failed' ? 'bg-red-600' : 'bg-slate-600'}>{draft.status}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {draft.error_message && <div className="rounded border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{draft.error_message}</div>}
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
        <Button type="button" variant="outline" onClick={deleteDraft} disabled={isPending} className="border-red-500/30 text-red-300 hover:bg-red-500/10 hover:text-red-200">
          <Trash2 className="h-4 w-4" />
          Удалить
        </Button>
      </CardContent>
    </Card>
  )
}
