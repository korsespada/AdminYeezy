'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Image from 'next/image'
import { Layers3, X } from 'lucide-react'
import { bulkAssignVariantFamilyAction } from '@/actions/bulk-update'
import type { Product } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { imagePresets, resizeImageUrl } from '@/lib/image'

type ExistingFamily = {
  key: string
  title: string
  colors: string[]
  count: number
  thumb: string
}

export function collectVariantFamilies(products: Product[]): ExistingFamily[] {
  const byKey = new Map<string, { title: string; colors: Set<string>; count: number; thumb: string }>()
  for (const product of products) {
    const key = String(product.variant_group_key || '').trim()
    if (!key) continue
    const entry = byKey.get(key) || {
      title: product.name || 'Семья без названия',
      colors: new Set<string>(),
      count: 0,
      thumb: product.thumb || product.photos?.[0] || '',
    }
    for (const variant of product.color_variants || []) {
      if (variant.color) entry.colors.add(variant.color)
    }
    entry.count += 1
    byKey.set(key, entry)
  }
  return [...byKey.entries()].map(([key, entry]) => ({
    key,
    title: entry.title,
    colors: [...entry.colors],
    count: entry.count,
    thumb: entry.thumb,
  }))
}

type VariantFamilyBulkDialogProps = {
  open: boolean
  onClose: () => void
  products: Product[]
  selectedIds: string[]
  onAssigned: () => void
}

export default function VariantFamilyBulkDialog({ open, onClose, products, selectedIds, onAssigned }: VariantFamilyBulkDialogProps) {
  const [targetFamilyKey, setTargetFamilyKey] = useState<string | null>(null)
  const [groupName, setGroupName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const contentRef = useRef<HTMLDivElement>(null)
  const families = collectVariantFamilies(products)

  useEffect(() => {
    if (!open) {
      setTargetFamilyKey(null)
      setGroupName('')
      setError('')
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  const apply = async () => {
    if (!selectedIds.length || busy) return
    if (!targetFamilyKey && selectedIds.length < 2) {
      setError('Для новой семьи выберите минимум два товара')
      return
    }
    if (!targetFamilyKey && !groupName.trim()) {
      setError('Укажите название новой семьи')
      return
    }
    setBusy(true)
    setError('')
    const result = await bulkAssignVariantFamilyAction(
      selectedIds,
      targetFamilyKey ? { familyKey: targetFamilyKey } : { familyName: groupName.trim() },
    )
    if (!result.success) {
      setError(result.error || 'Не удалось сохранить цветовую семью')
      setBusy(false)
      return
    }
    setBusy(false)
    onAssigned()
    onClose()
  }

  return createPortal(
    <div className="fixed inset-0 z-[180] flex items-center justify-center bg-black/80 p-4" onMouseDown={onClose}>
      <div
        ref={contentRef}
        className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Объединить в цветовую семью"
      >
        <div className="flex items-center justify-between border-b border-slate-700 px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 font-semibold text-slate-100"><Layers3 className="h-5 w-5 text-violet-300" />В цветовую семью</h2>
            <p className="mt-1 text-xs text-slate-400">Выбрано товаров: {selectedIds.length}. Выберите существующую семью или создайте новую.</p>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 text-slate-400 hover:text-slate-100" aria-label="Закрыть"><X className="h-5 w-5" /></Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">
          <button
            type="button"
            onClick={() => setTargetFamilyKey(null)}
            className={`mb-4 w-full rounded-xl border p-3 text-left transition ${targetFamilyKey === null ? 'border-violet-400 bg-violet-500/15 ring-1 ring-violet-400/30' : 'border-slate-700 bg-slate-800 hover:border-slate-500'}`}
          >
            <div className="text-sm font-semibold text-slate-100">Создать новую семью</div>
            <div className="mt-1 text-xs text-slate-400">Объединит выбранные товары в отдельную цветовую семью.</div>
          </button>

          {targetFamilyKey === null && (
            <div className="mb-5 space-y-1.5">
              <Label htmlFor="variant-family-name" className="text-xs text-slate-400">Название группы</Label>
              <Input
                id="variant-family-name"
                value={groupName}
                onChange={(event) => setGroupName(event.target.value)}
                placeholder="Например: BC0013 — лоферы"
                autoFocus
                className="h-10 border-slate-700 bg-slate-950 text-slate-100"
              />
            </div>
          )}

          {families.length > 0 && (
            <>
              <div className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">Или добавить в существующую</div>
              <div className="grid gap-2 sm:grid-cols-2">
                {families.map((family) => (
                  <button
                    type="button"
                    key={family.key}
                    onClick={() => setTargetFamilyKey(family.key)}
                    className={`flex min-w-0 items-center gap-3 rounded-xl border p-3 text-left transition ${targetFamilyKey === family.key ? 'border-violet-400 bg-violet-500/15 ring-1 ring-violet-400/30' : 'border-slate-700 bg-slate-800 hover:border-slate-500'}`}
                  >
                    <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-slate-950">
                      {family.thumb ? (
                        <Image src={resizeImageUrl(family.thumb, imagePresets.productGrid)} alt="" fill className="object-cover" unoptimized />
                      ) : null}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-100">{family.title}</div>
                      <div className="mt-1 truncate text-xs text-violet-300">
                        {family.count} тов. {family.colors.length ? `· ${family.colors.join(', ')}` : ''}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="border-t border-slate-700 px-5 py-4">
          {error && <div className="mb-3 text-sm text-red-300">{error}</div>}
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy} className="border-slate-700 bg-transparent text-slate-400 hover:text-slate-100">Отмена</Button>
            <Button type="button" onClick={apply} disabled={busy || !selectedIds.length}>
              {busy ? 'Сохраняем…' : targetFamilyKey ? 'Добавить в семью' : 'Создать семью'}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
