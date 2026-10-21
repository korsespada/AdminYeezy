'use client'

import { useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { ArrowLeft, Check, ImagePlus, Loader2, Plus, Save, Star, Trash2 } from 'lucide-react'
import { deleteChromoffReviewAction, saveChromoffReviewAction } from '@/actions/chromoff-reviews'
import type { RailsChromoffReview, RailsChromoffReviewInput } from '@/lib/rails-admin'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

type PhotoType = 'report' | 'customer' | 'catalog'

type ReviewForm = {
  id: string | null
  city: string
  month: string
  review: string
  status: 'draft' | 'published'
  featured: boolean
  position: string
  photoSrc: string
  photoAlt: string
  photoType: PhotoType
  items: Array<{ name: string; href: string; channel: boolean }>
}

const PHOTO_LABELS: Record<PhotoType, string> = {
  report: 'Фотоотчёт перед отправкой',
  customer: 'Фото покупателя',
  catalog: 'Фото из карточки товара',
}

function currentMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function formatMonth(month: string) {
  const [year, index] = month.split('-')
  return year && index ? `${index}.${year}` : month
}

function photoTypeOf(review: RailsChromoffReview): PhotoType {
  if (review.photo?.catalog) return 'catalog'
  if (review.photo?.customer) return 'customer'
  return 'report'
}

function blankForm(): ReviewForm {
  return {
    id: null,
    city: '',
    month: currentMonth(),
    review: '',
    status: 'draft',
    featured: false,
    position: '0',
    photoSrc: '',
    photoAlt: '',
    photoType: 'report',
    items: [{ name: '', href: '', channel: false }],
  }
}

function toForm(review: RailsChromoffReview): ReviewForm {
  return {
    id: review.id,
    city: review.city || '',
    month: review.month || currentMonth(),
    review: review.review || '',
    status: review.status,
    featured: Boolean(review.featured),
    position: String(review.position ?? 0),
    photoSrc: review.photo?.src || '',
    photoAlt: review.photo?.alt || '',
    photoType: photoTypeOf(review),
    items: Array.isArray(review.items) && review.items.length
      ? review.items.map((item) => ({ name: item.name || '', href: item.href || '', channel: Boolean(item.channel) }))
      : [{ name: '', href: '', channel: false }],
  }
}

function sortReviews(a: RailsChromoffReview, b: RailsChromoffReview) {
  if (a.featured !== b.featured) return a.featured ? -1 : 1
  if (b.position !== a.position) return b.position - a.position
  if (a.month !== b.month) return b.month.localeCompare(a.month)
  return String(b.updated_at || '').localeCompare(String(a.updated_at || ''))
}

export default function ChromoffReviewsManager({ initialReviews }: { initialReviews: RailsChromoffReview[] }) {
  const [reviews, setReviews] = useState<RailsChromoffReview[]>(() => [...initialReviews].sort(sortReviews))
  const [form, setForm] = useState<ReviewForm>(() => (initialReviews[0] ? toForm(initialReviews[0]) : blankForm()))
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [isPending, startTransition] = useTransition()
  const [isUploading, setIsUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function setField<K extends keyof ReviewForm>(key: K, value: ReviewForm[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function updateItem(index: number, patch: Partial<ReviewForm['items'][number]>) {
    setForm((current) => ({
      ...current,
      items: current.items.map((item, position) => (position === index ? { ...item, ...patch } : item)),
    }))
  }

  function addItem() {
    setForm((current) => ({ ...current, items: [...current.items, { name: '', href: '', channel: false }] }))
  }

  function removeItem(index: number) {
    setForm((current) => ({
      ...current,
      items: current.items.length > 1 ? current.items.filter((_, position) => position !== index) : current.items,
    }))
  }

  function selectReview(review: RailsChromoffReview) {
    setForm(toForm(review))
    setMessage(null)
  }

  function startNew() {
    setForm(blankForm())
    setMessage(null)
  }

  function suggestAlt() {
    const name = form.items.find((item) => item.name.trim())?.name.trim() || 'изделие'
    const city = form.city.trim()
    const suffix = form.photoType === 'catalog' || !city ? '' : `, ${city}`
    setField('photoAlt', `${PHOTO_LABELS[form.photoType]}: ${name}${suffix}`)
  }

  async function uploadFiles(files: File[]) {
    if (!files.length) return
    if (files.length > 3) {
      setMessage({ tone: 'error', text: 'Максимум 3 фото: они склеиваются в один кадр 3:4.' })
      return
    }

    setIsUploading(true)
    setMessage(null)
    try {
      const body = new FormData()
      for (const file of files) body.append('photo_file', file)
      const response = await fetch('/api/admin/chromoff/reviews/photo', { method: 'POST', body })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload?.photo?.src) throw new Error(payload?.error || 'Не удалось загрузить фото')
      setForm((current) => ({ ...current, photoSrc: payload.photo.src }))
      setMessage({ tone: 'ok', text: 'Фото загружено: кадр 3:4 готов.' })
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Не удалось загрузить фото' })
    } finally {
      setIsUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function save(status: 'draft' | 'published') {
    const payload: RailsChromoffReviewInput = {
      city: form.city.trim(),
      month: form.month,
      review: form.review.trim(),
      status,
      featured: form.featured,
      position: Number.parseInt(form.position, 10) || 0,
      items: form.items
        .map((item) => ({ name: item.name.trim(), href: item.href.trim(), channel: item.channel }))
        .filter((item) => item.name),
      photo_src: form.photoSrc || null,
      photo_alt: form.photoAlt.trim() || null,
      photo_customer: form.photoType === 'customer',
      photo_catalog: form.photoType === 'catalog',
    }

    startTransition(async () => {
      const result = await saveChromoffReviewAction({ id: form.id, review: payload })
      if (!result.success || !result.review) {
        setMessage({ tone: 'error', text: result.message || 'Не удалось сохранить отзыв.' })
        return
      }

      const saved = result.review
      setReviews((current) => [saved, ...current.filter((review) => review.id !== saved.id)].sort(sortReviews))
      setForm(toForm(saved))
      setMessage({
        tone: 'ok',
        text: status === 'published'
          ? 'Опубликовано: карточка появится на главной в течение 5 минут.'
          : 'Черновик сохранён, на сайте его нет.',
      })
    })
  }

  function remove() {
    if (!form.id) return
    if (!window.confirm('Удалить отзыв? Карточка исчезнет с главной.')) return

    const id = form.id
    startTransition(async () => {
      const result = await deleteChromoffReviewAction(id)
      if (!result.success) {
        setMessage({ tone: 'error', text: result.message || 'Не удалось удалить отзыв.' })
        return
      }
      setReviews((current) => current.filter((review) => review.id !== id))
      setForm(blankForm())
      setMessage({ tone: 'ok', text: 'Отзыв удалён.' })
    })
  }

  const publishedCount = reviews.filter((review) => review.status === 'published').length

  return (
    <div className="min-h-full bg-slate-900 px-4 py-5 text-slate-200 sm:p-6">
      <div className="mx-auto max-w-[1500px]">
        <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-slate-100">Отзывы</h1>
              <Badge className="bg-violet-500/15 text-violet-200 hover:bg-violet-500/15">главная chromoff.store</Badge>
            </div>
            <p className="mt-1 max-w-3xl text-sm text-slate-400">
              Карточки блока «Отправки»: фото 3:4, город, месяц, состав заказа и текст. Опубликованный отзыв появляется
              на сайте в течение пяти минут, без деплоя.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" className="border-slate-700 bg-slate-800 text-slate-200">
              <Link href="/admin/chromoff"><ArrowLeft className="h-4 w-4" />К каталогу</Link>
            </Button>
            <Button type="button" onClick={startNew}><Plus className="h-4 w-4" />Новый отзыв</Button>
          </div>
        </header>

        <div className="grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
          <aside className="space-y-2">
            <div className="flex items-center justify-between px-1 text-xs uppercase tracking-wide text-slate-500">
              <span>Всего {reviews.length}</span>
              <span>Опубликовано {publishedCount}</span>
            </div>

            {reviews.map((review) => {
              const active = form.id === review.id
              return (
                <button
                  key={review.id}
                  type="button"
                  onClick={() => selectReview(review)}
                  className={`flex w-full gap-3 rounded-xl border p-2 text-left transition ${
                    active ? 'border-violet-500/70 bg-violet-500/10' : 'border-slate-700 bg-slate-800 hover:border-slate-500'
                  }`}
                >
                  {review.photo?.src ? (
                    <img src={review.photo.src} alt="" className="h-20 w-[60px] shrink-0 rounded-lg object-cover" />
                  ) : (
                    <div className="flex h-20 w-[60px] shrink-0 items-center justify-center rounded-lg bg-slate-900 text-[10px] text-slate-500">3:4</div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-semibold text-slate-100">{review.city || 'Без города'}</span>
                      {review.featured ? <Star className="h-3.5 w-3.5 shrink-0 fill-amber-300 text-amber-300" /> : null}
                    </div>
                    <div className="text-xs text-slate-500">{formatMonth(review.month)}</div>
                    <p className="mt-1 line-clamp-2 text-xs text-slate-400">{review.review || 'Без текста'}</p>
                    <Badge className={`mt-1.5 ${review.status === 'published' ? 'bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/15' : 'bg-slate-600/40 text-slate-300 hover:bg-slate-600/40'}`}>
                      {review.status === 'published' ? 'Опубликован' : 'Черновик'}
                    </Badge>
                  </div>
                </button>
              )
            })}

            {reviews.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-700 p-4 text-sm text-slate-400">
                Пока нет ни одного отзыва. Начните с «Новый отзыв».
              </p>
            ) : null}
          </aside>

          <section className="min-w-0">
            {message ? (
              <div className={`mb-4 rounded-lg border px-3 py-2 text-sm ${
                message.tone === 'ok'
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100'
                  : 'border-rose-500/30 bg-rose-500/10 text-rose-100'
              }`}>
                {message.text}
              </div>
            ) : null}

            <form
              onSubmit={(event) => {
                event.preventDefault()
                save(form.status)
              }}
              className="space-y-5 rounded-xl border border-slate-700 bg-slate-800/70 p-4 sm:p-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold text-slate-100">{form.id ? 'Редактирование отзыва' : 'Новый отзыв'}</h2>
                {form.id ? <span className="font-mono text-[11px] text-slate-500">{form.id}</span> : null}
              </div>

              <div className="grid gap-3 sm:grid-cols-[1fr_150px_120px]">
                <div className="space-y-1">
                  <Label htmlFor="review-city">Город</Label>
                  <Input id="review-city" value={form.city} onChange={(event) => setField('city', event.target.value)} placeholder="Москва" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="review-month">Месяц отправки</Label>
                  <Input id="review-month" type="month" value={form.month} onChange={(event) => setField('month', event.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="review-position">Позиция</Label>
                  <Input id="review-position" type="number" value={form.position} onChange={(event) => setField('position', event.target.value)} />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Товары в заказе</Label>
                  <Button type="button" size="sm" variant="outline" onClick={addItem} className="border-slate-600 bg-slate-800">
                    <Plus className="h-3.5 w-3.5" />Добавить
                  </Button>
                </div>
                {form.items.map((item, index) => (
                  <div key={index} className="grid gap-2 rounded-lg border border-slate-700 bg-slate-900/40 p-2 sm:grid-cols-[1fr_1fr_auto_auto]">
                    <Input
                      value={item.name}
                      onChange={(event) => updateItem(index, { name: event.target.value })}
                      placeholder="Chrome Hearts Кольцо"
                      aria-label={`Название товара ${index + 1}`}
                    />
                    <Input
                      value={item.href}
                      onChange={(event) => updateItem(index, { href: event.target.value })}
                      placeholder="https://chromoff.store/product/..."
                      aria-label={`Ссылка товара ${index + 1}`}
                    />
                    <label className="flex items-center gap-2 whitespace-nowrap px-1 text-xs text-slate-300">
                      <input type="checkbox" checked={item.channel} onChange={(event) => updateItem(index, { channel: event.target.checked })} />
                      Из Telegram
                    </label>
                    <Button type="button" variant="ghost" size="icon" onClick={() => removeItem(index)} disabled={form.items.length === 1} aria-label="Удалить товар">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <p className="text-xs text-slate-500">Название — с брендом. «Из Telegram» — для товара, который продавался постом в канале.</p>
              </div>

              <div className="grid gap-4 sm:grid-cols-[160px_minmax(0,1fr)]">
                <div>
                  <div className="relative aspect-[3/4] w-40 overflow-hidden rounded-lg border border-slate-700 bg-slate-900">
                    {form.photoSrc ? (
                      <img src={form.photoSrc} alt={form.photoAlt || 'Фото отзыва'} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-xs text-slate-500">Кадр 3:4</div>
                    )}
                    {isUploading ? (
                      <div className="absolute inset-0 flex items-center justify-center bg-slate-950/70">
                        <Loader2 className="h-5 w-5 animate-spin text-slate-200" />
                      </div>
                    ) : null}
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(event) => uploadFiles(Array.from(event.target.files ?? []))}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    className="mt-2 w-40 border-slate-600 bg-slate-800"
                  >
                    <ImagePlus className="h-4 w-4" />{form.photoSrc ? 'Заменить' : 'Загрузить'}
                  </Button>
                </div>

                <div className="space-y-3">
                  <div className="space-y-1">
                    <Label htmlFor="review-photo-type">Что на фото</Label>
                    <select
                      id="review-photo-type"
                      value={form.photoType}
                      onChange={(event) => setField('photoType', event.target.value as PhotoType)}
                      className="h-9 w-full rounded-md border border-slate-600 bg-slate-700 px-2.5 text-sm text-slate-200 outline-none focus:border-violet-400"
                    >
                      <option value="report">Фотоотчёт перед отправкой</option>
                      <option value="customer">Фото покупателя</option>
                      <option value="catalog">Фото из карточки товара</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="review-photo-alt">Alt фото</Label>
                      <button type="button" onClick={suggestAlt} className="text-xs text-violet-300 hover:underline">Шаблон</button>
                    </div>
                    <Input
                      id="review-photo-alt"
                      value={form.photoAlt}
                      onChange={(event) => setField('photoAlt', event.target.value)}
                      placeholder="Фотоотчёт перед отправкой: кольцо, Москва"
                    />
                    <p className="text-xs text-slate-500">Что видно на фото и город. Без перечисления ключевых слов.</p>
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="review-text">Текст отзыва</Label>
                <Textarea
                  id="review-text"
                  rows={3}
                  value={form.review}
                  onChange={(event) => setField('review', event.target.value)}
                  placeholder="Дословно, как написал покупатель"
                  className="bg-slate-900/60"
                />
                <p className="text-xs text-slate-500">Кавычки сайт добавит сам, орфографию не правим. Можно оставить пустым — карточка будет без цитаты.</p>
              </div>

              <label className="flex items-start gap-2 rounded-lg border border-slate-700 bg-slate-900/40 p-3 text-sm">
                <input
                  type="checkbox"
                  checked={form.featured}
                  onChange={(event) => setField('featured', event.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium text-slate-200">В цитату на главной</span>
                  <span className="block text-xs text-slate-500">Крупная цитата над лентой и первые карточки.</span>
                </span>
              </label>

              <div className="flex flex-wrap gap-2 border-t border-slate-700 pt-4">
                <Button type="button" variant="outline" onClick={() => save('draft')} disabled={isPending || isUploading} className="border-slate-600 bg-slate-800">
                  <Save className="h-4 w-4" />Сохранить черновик
                </Button>
                <Button type="button" onClick={() => save('published')} disabled={isPending || isUploading}>
                  <Check className="h-4 w-4" />Опубликовать
                </Button>
                {form.id ? (
                  <Button type="button" variant="ghost" onClick={remove} disabled={isPending} className="ml-auto text-rose-300 hover:bg-rose-500/10 hover:text-rose-200">
                    <Trash2 className="h-4 w-4" />Удалить
                  </Button>
                ) : null}
              </div>
            </form>
          </section>
        </div>
      </div>
    </div>
  )
}
