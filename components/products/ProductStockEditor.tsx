'use client'

import { useEffect, useState, useTransition } from 'react'
import { PackageCheck } from 'lucide-react'
import { updateProductStockAction } from '@/actions/products'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { Product, ProductStockVariant } from '@/lib/types'

interface ProductStockEditorProps {
  product: Product
  onSaved?: (product: Product) => void
}

function catalogSizes(product: Product): string[] {
  const sizes = product.catalog_attributes?.sizes
  const values = Array.isArray(sizes?.values)
    ? sizes.values
    : Array.isArray(sizes?.groups)
      ? sizes.groups.flatMap((group: any) => (Array.isArray(group?.values) ? group.values : []))
      : []
  return values.map((value: unknown) => String(value || '').trim()).filter(Boolean)
}

/**
 * Остаток у магазина по каждому размеру. Пишется отдельным вызовом Rails
 * (`PATCH /admin/products/:id/stock`), а не формой товара: форма пересобирает
 * размеры из атрибутов и остаток не передаёт. Размер с остатком > 0 попадает
 * в раздел «В наличии» на chromoff.store; 0 — снова только под заказ.
 */
export default function ProductStockEditor({ product, onSaved }: ProductStockEditorProps) {
  const [variants, setVariants] = useState<ProductStockVariant[]>(product.variants || [])
  const [stock, setStock] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    const next = product.variants || []
    setVariants(next)
    setStock(Object.fromEntries(next.map((variant) => [variant.id, String(variant.stock_quantity || 0)])))
    setMessage('')
    setError('')
  }, [product.variants])

  const sizedVariants = variants.filter((variant) => variant.size)
  const missingSizes = sizedVariants.length === 0 && catalogSizes(product).length > 0
  const dirty = variants.some((variant) => Number(stock[variant.id] || 0) !== variant.stock_quantity)
  const totalInStock = variants.reduce((sum, variant) => sum + Math.max(0, Number(stock[variant.id] || 0)), 0)

  const save = () => {
    setMessage('')
    setError('')
    const changed = variants
      .map((variant) => ({ id: variant.id, stock_quantity: Math.max(0, Math.trunc(Number(stock[variant.id] || 0))) }))
      .filter((variant, index) => variant.stock_quantity !== variants[index].stock_quantity)
    if (changed.length === 0) return

    startTransition(async () => {
      const result = await updateProductStockAction(product.id, changed)
      if (!result.success) {
        setError(result.error || 'Не удалось сохранить наличие')
        return
      }
      const saved = result.data as Product
      setVariants(saved.variants || [])
      setStock(Object.fromEntries((saved.variants || []).map((variant) => [variant.id, String(variant.stock_quantity || 0)])))
      setMessage('Наличие сохранено')
      onSaved?.(saved)
    })
  }

  return (
    <section className="space-y-3 rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <PackageCheck className="h-4 w-4 text-emerald-300" />
          <h3 className="text-sm font-semibold text-emerald-100">Наличие у магазина</h3>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${totalInStock > 0 ? 'bg-emerald-500/20 text-emerald-200' : 'bg-slate-800 text-slate-400'}`}>
          {totalInStock > 0 ? `В наличии: ${totalInStock} шт.` : 'Под заказ'}
        </span>
      </div>
      <p className="text-xs text-slate-400">
        Размер с остатком больше 0 показывается в разделе «В наличии» на chromoff.store с отправкой за 1–2 дня. Продали — поставьте 0.
      </p>

      {variants.length === 0 ? (
        <p className="text-xs text-amber-300">У товара нет вариантов в Rails: сохраните карточку, чтобы они появились.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {variants.map((variant) => (
            <label key={variant.id} className="space-y-1">
              <span className="block truncate text-[11px] font-semibold text-slate-300">
                {[variant.size || 'Без размера', variant.color].filter(Boolean).join(' · ')}
              </span>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={stock[variant.id] ?? '0'}
                onChange={(event) => setStock((current) => ({ ...current, [variant.id]: event.target.value }))}
                className="h-8 border-slate-700 bg-slate-900 text-slate-100"
                aria-label={`Остаток ${variant.size || 'без размера'}`}
              />
            </label>
          ))}
        </div>
      )}

      {missingSizes && (
        <p className="text-xs text-amber-300">
          Размеры есть в атрибутах, но ещё не созданы как варианты. Сохраните карточку товара, затем отметьте наличие по размеру.
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button type="button" size="sm" onClick={save} disabled={!dirty || isPending} className="bg-emerald-600 text-white hover:bg-emerald-500">
          {isPending ? 'Сохраняю…' : 'Сохранить наличие'}
        </Button>
        {message && <span className="text-xs text-emerald-300">{message}</span>}
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
    </section>
  )
}
