'use client'

import { useMemo, useState } from 'react'
import Image from 'next/image'
import { RotateCcw, Trash2 } from 'lucide-react'
import { deleteProductPermanentlyAction, restoreProductFromTrashAction } from '@/actions/products'
import { type Category, type Product, type Subcategory } from '@/lib/types'
import ProductDescription from '@/components/products/ProductDescription'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { imagePresets, productImageUrl } from '@/lib/image'

interface ProductTrashListProps {
  initialData: Product[]
  categories: Category[]
  subcategories: Subcategory[]
}

export default function ProductTrashList({ initialData, categories, subcategories }: ProductTrashListProps) {
  const [products, setProducts] = useState(initialData)
  const [busyId, setBusyId] = useState<string | null>(null)

  const categoryNames = useMemo(() => ({
    categories: new Map(categories.map((category) => [category.id, category.name])),
    subcategories: new Map(subcategories.map((subcategory) => [subcategory.id, subcategory.name])),
  }), [categories, subcategories])

  const handleRestore = async (id: string) => {
    setBusyId(id)
    const result = await restoreProductFromTrashAction(id)
    setBusyId(null)
    if (result.success) {
      setProducts((prev) => prev.filter((product) => product.id !== id))
    } else {
      alert(result.error || 'Не удалось восстановить товар')
    }
  }

  const handlePermanentDelete = async (id: string) => {
    if (!confirm('Удалить товар навсегда? Это действие нельзя отменить.')) return
    setBusyId(id)
    const result = await deleteProductPermanentlyAction(id)
    setBusyId(null)
    if (result.success) {
      setProducts((prev) => prev.filter((product) => product.id !== id))
    } else {
      alert(result.error || 'Не удалось удалить товар')
    }
  }

  if (products.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-slate-800">
          <Trash2 className="h-9 w-9 text-slate-600" />
        </div>
        <h2 className="text-lg font-semibold text-slate-100">Корзина пуста</h2>
        <p className="mt-1 max-w-sm text-sm text-slate-500">Удалённые из каталога товары будут появляться здесь.</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {products.map((product) => {
        const image = productImageUrl(product, imagePresets.productGrid)
        const categoryName = product.expand?.category?.name || categoryNames.categories.get(product.category) || 'Без категории'
        const subcategoryName = product.expand?.subcategory?.name || categoryNames.subcategories.get(product.subcategory) || ''
        const busy = busyId === product.id

        return (
          <Card key={product.id} className="flex h-full flex-col overflow-hidden border-slate-700 bg-slate-800">
            <div className="relative aspect-square bg-slate-900">
              {image ? (
                <Image src={image} alt={product.name} fill sizes="(max-width: 768px) 100vw, 25vw" className="object-cover opacity-90" unoptimized />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs uppercase tracking-widest text-slate-600">
                  No image
                </div>
              )}
              <Badge className="absolute left-3 top-3 bg-slate-950/80 text-slate-200">В корзине</Badge>
            </div>
            <CardContent className="flex flex-1 flex-col p-5">
              <div className="mb-2 text-xs text-slate-500">
                {categoryName}{subcategoryName && ` • ${subcategoryName}`}
              </div>
              <h3 className="mb-2 text-base font-bold leading-tight text-slate-100">{product.name}</h3>
              {product.description && (
                <p className="mb-4 line-clamp-3 text-sm text-slate-400">
                  <ProductDescription text={product.description} />
                </p>
              )}
              <div className="mt-auto flex items-center gap-2 border-t border-slate-700 pt-4">
                <Button type="button" onClick={() => handleRestore(product.id)} disabled={busy} className="flex-1">
                  <RotateCcw className="h-4 w-4" />
                  Восстановить
                </Button>
                <Button type="button" variant="destructive" size="icon" onClick={() => handlePermanentDelete(product.id)} disabled={busy} title="Удалить навсегда">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
