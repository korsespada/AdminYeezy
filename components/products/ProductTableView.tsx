'use client'

import React, { useState, useCallback } from 'react'
import Image from 'next/image'
import { type Product } from '@/lib/types'
import { ReplaceAll, RefreshCw, Copy } from 'lucide-react'
import { bulkPatchObjectsAction } from '@/actions/bulk-update'
import { createProductAction } from '@/actions/products'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { normalizeDescription } from '@/components/products/ProductDescription'
import { imagePresets, productImageUrl } from '@/lib/image'
import { isPriceOnRequest } from '@/lib/product-pricing'
import ProductGenderBadge from '@/components/products/ProductGenderBadge'

interface ProductTableViewProps {
    products: Product[]
    selectedIds: string[]
    onToggleSelect: (id: string) => void
    onToggleSelectAll: () => void
    onUpdateProduct: (product: Product) => void
}

const getPhotoUrl = (product: Product) => productImageUrl(product, imagePresets.productTable)

type FieldName = 'productId' | 'name' | 'description' | 'price'

export default function ProductTableView({ products, selectedIds, onToggleSelect, onToggleSelectAll, onUpdateProduct }: ProductTableViewProps) {
    const [findText, setFindText] = useState('')
    const [replaceText, setReplaceText] = useState('')
    const [replaceField, setReplaceField] = useState<FieldName>('name')
    const [isReplacing, setIsReplacing] = useState(false)
    const [isCopying, setIsCopying] = useState<string | null>(null)
    const router = useRouter()

    // Track dirty individual rows to show saving state or save on blur
    const [savingId, setSavingId] = useState<string | null>(null)

    // Local changes for controlled inputs matching Product structure
    const [localValues, setLocalValues] = useState<Record<string, Record<string, any>>>({})

    const handleLocalChange = (id: string, field: FieldName, value: string) => {
        setLocalValues(prev => ({
            ...prev,
            [id]: {
                ...(prev[id] || {}),
                [field]: value
            }
        }))
    }

    const getValue = (product: Product, field: FieldName) => {
        if (localValues[product.id] && localValues[product.id][field] !== undefined) {
            return localValues[product.id][field]
        }
        const value = product[field] || ''
        return field === 'description' ? normalizeDescription(String(value)) : value
    }

    const handleSaveField = async (product: Product, field: FieldName) => {
        const newVal = localValues[product.id]?.[field]
        if (newVal === undefined) return // No change

        let finalVal: any = newVal
        if (field === 'price') {
            finalVal = parseFloat(newVal) || 0
        }

        if (finalVal === product[field]) {
            // Unchanged after parse
            return
        }

        setSavingId(product.id)
        const res = await bulkPatchObjectsAction([{ id: product.id, data: { [field]: finalVal } }])
        if (res.success) {
            onUpdateProduct({ ...product, [field]: finalVal })
            // Clean local value to rely on product prop
            setLocalValues(prev => {
                const next = { ...prev }
                if (next[product.id]) {
                    delete next[product.id][field]
                }
                return next
            })
        }
        setSavingId(null)
    }

    const handleDuplicate = async (product: Product) => {
        if (isCopying || !confirm('Дублировать этот товар?')) return;
        setIsCopying(product.id);

        try {
            const newProductId = `SKU-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;
            const formData = new FormData();
            formData.append('productId', newProductId);
            formData.append('name', `${product.name} (Копия)`);
            formData.append('description', normalizeDescription(product.description));
            formData.append('price', product.price.toString());
            formData.append('status', product.status);
            formData.append('gender', product.gender || '');
            formData.append('productMetadata', JSON.stringify(product.metadata || {}));
            formData.append('catalog_attributes', JSON.stringify(product.catalog_attributes || product.attributes || {}));
            formData.append('price_on_request', isPriceOnRequest(product.price) ? 'true' : 'false');
            if (product.fulfillment_mode) formData.append('fulfillment_mode', product.fulfillment_mode);
            if (product.availability_confidence) formData.append('availability_confidence', product.availability_confidence);
            if (product.indexing_status) formData.append('indexing_status', product.indexing_status);

            // Handle brands
            const b = product.brand || product.expand?.brand;
            if (Array.isArray(b)) {
                b.forEach(id => {
                    if (typeof id === 'string') formData.append('brand', id);
                    else if (id && typeof id === 'object' && 'id' in id) formData.append('brand', id.id);
                });
            } else if (typeof b === 'string' && b) {
                formData.append('brand', b);
            } else if (b && typeof b === 'object' && 'id' in b) {
                formData.append('brand', b.id);
            }

            formData.append('category', product.category || product.expand?.category?.id || '');
            formData.append('subcategory', product.subcategory || product.expand?.subcategory?.id || '');

            formData.append('media', JSON.stringify(product.media || product.photos.map((url, index) => ({
                original_url: url,
                preview_url: url,
                thumb_url: url,
                og_image_url: url,
                sort_order: index,
                processing_status: 'processed',
            }))));

            const result = await createProductAction(formData);
            if (result.success) {
                router.refresh();
            } else {
                alert('Ошибка при дублировании: ' + result.error);
            }
        } catch (error) {
            console.error('Duplicate error:', error);
            alert('Не удалось дублировать товар');
        } finally {
            setIsCopying(null);
        }
    }

    const handleMassReplace = async () => {
        if (!findText) {
            alert('Введите текст для поиска (или используйте * для полной замены значения)')
            return
        }
        if (selectedIds.length === 0) {
            alert('Выберите товары для массовой замены')
            return
        }

        setIsReplacing(true)
        const updates: { id: string, data: any }[] = []

        products.forEach(p => {
            if (!selectedIds.includes(p.id)) return

            const currentVal = getValue(p, replaceField)
            const currentValStr = currentVal !== undefined && currentVal !== null ? currentVal.toString() : ''

            if (findText === '*') {
                // Если ввели звёздочку, заменяем ячейку целиком на новое значение
                const finalVal = replaceField === 'price' ? parseFloat(replaceText) || 0 : replaceText
                if (currentVal !== finalVal) {
                    updates.push({
                        id: p.id,
                        data: { [replaceField]: finalVal }
                    })
                }
            } else if (currentValStr.includes(findText)) {
                // Обычная текстовая замена
                const replaced = currentValStr.split(findText).join(replaceText)
                if (replaced !== currentValStr) {
                    updates.push({
                        id: p.id,
                        data: { [replaceField]: replaceField === 'price' ? parseFloat(replaced) || 0 : replaced }
                    })
                }
            }
        })

        if (updates.length > 0) {
            const res = await bulkPatchObjectsAction(updates)
            if (res.success) {
                // update local state
                updates.forEach(u => {
                    const product = products.find(prod => prod.id === u.id)
                    if (product) {
                        onUpdateProduct({ ...product, ...u.data })
                        // Clean up typed local values since we saved
                        setLocalValues(prev => {
                            const next = { ...prev }
                            if (next[product.id]) {
                                delete next[product.id][replaceField]
                            }
                            return next
                        })
                    }
                })
                alert(`Успешно обновлено ${updates.length} товаров`)
            } else {
                alert('Ошибка при замене')
            }
        } else {
            alert('Не найдено совпадений для замены в выбранных товарах')
        }
        setIsReplacing(false)
    }

    return (
        <Card className="mb-8 flex h-[calc(100vh-280px)] flex-col overflow-hidden border-slate-700 bg-slate-800 shadow-sm">
            {/* Mass Replace Toolbar */}
            <div className="p-4 border-b border-slate-700 bg-slate-800/50 shrink-0">
                <div className="flex flex-col sm:flex-row items-center gap-4">
                    <div className="flex items-center gap-2 text-sm font-medium text-slate-300">
                        <ReplaceAll className="w-4 h-4 text-indigo-400" />
                        Массовая замена
                    </div>

                    <div className="flex flex-wrap items-center gap-2 flex-1">
                        <Select
                            value={replaceField}
                            onValueChange={value => setReplaceField(value as FieldName)}
                        >
                            <SelectTrigger className="h-9 w-36 bg-slate-700 text-slate-200">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="name">Название</SelectItem>
                                <SelectItem value="description">Описание</SelectItem>
                                <SelectItem value="price">Цена</SelectItem>
                            </SelectContent>
                        </Select>
                        <Input
                            type="text"
                            placeholder="Найти (или *)..."
                            value={findText}
                            onChange={e => setFindText(e.target.value)}
                            className="h-9 min-w-[120px] flex-1 bg-slate-700 text-slate-200"
                        />
                        <Input
                            type="text"
                            placeholder="Заменить на..."
                            value={replaceText}
                            onChange={e => setReplaceText(e.target.value)}
                            className="h-9 min-w-[120px] flex-1 bg-slate-700 text-slate-200"
                        />
                        <Button
                            type="button"
                            onClick={handleMassReplace}
                            disabled={isReplacing || selectedIds.length === 0}
                            className="h-9 whitespace-nowrap"
                        >
                            {isReplacing ? <RefreshCw className="w-4 h-4 animate-spin" /> : 'Заменить в выбранных'}
                        </Button>
                    </div>
                </div>
            </div>

            {/* Table Container */}
            <div className="flex-1 overflow-auto custom-scrollbar relative">
                <Table className="min-w-[800px] border-collapse text-left">
                    <TableHeader className="sticky top-0 z-10 bg-slate-800 shadow-md">
                        <TableRow>
                            <TableHead className="w-12 border-b border-slate-700 p-3 text-center">
                                <Checkbox
                                    checked={selectedIds.length === products.length && products.length > 0}
                                    onCheckedChange={onToggleSelectAll}
                                    className="border-slate-600 bg-slate-700"
                                />
                            </TableHead>
                            <TableHead className="w-16 border-b border-slate-700 p-3 text-xs uppercase tracking-wider text-slate-400">Фото</TableHead>
                            <TableHead className="border-b border-slate-700 p-3 text-xs uppercase tracking-wider text-slate-400">
                                <div className="min-w-[120px] max-w-xs resize-x overflow-hidden pr-2" title="Потяните за правый край, чтобы изменить ширину">Product ID</div>
                            </TableHead>
                            <TableHead className="border-b border-slate-700 p-3 text-xs uppercase tracking-wider text-slate-400">
                                <div className="min-w-[200px] max-w-md resize-x overflow-hidden pr-2">Название</div>
                            </TableHead>
                            <TableHead className="border-b border-slate-700 p-3 text-xs uppercase tracking-wider text-slate-400">
                                <div className="min-w-[90px] max-w-[120px] resize-x overflow-hidden pr-2">Пол</div>
                            </TableHead>
                            <TableHead className="border-b border-slate-700 p-3 text-xs uppercase tracking-wider text-slate-400">
                                <div className="min-w-[250px] max-w-xl resize-x overflow-hidden pr-2">Описание</div>
                            </TableHead>
                            <TableHead className="border-b border-slate-700 p-3 text-xs uppercase tracking-wider text-slate-400">
                                <div className="min-w-[100px] max-w-[150px] resize-x overflow-hidden pr-2">Цена</div>
                            </TableHead>
                            <TableHead className="w-12 border-b border-slate-700 p-3 text-center text-xs uppercase tracking-wider text-slate-400">Действия</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody className="divide-y divide-slate-700/50">
                        {products.map(product => {
                            const isSelected = selectedIds.includes(product.id)
                            const thumb = getPhotoUrl(product)
                            const isSaving = savingId === product.id

                            return (
                                <TableRow key={product.id} className={`border-slate-700/50 transition-colors hover:bg-slate-700/20 ${isSelected ? 'bg-indigo-500/5' : ''}`}>
                                    <TableCell className="p-3 text-center align-top">
                                        <Checkbox
                                            checked={isSelected}
                                            onCheckedChange={() => onToggleSelect(product.id)}
                                            className="mt-2 border-slate-600 bg-slate-700"
                                        />
                                    </TableCell>
                                    <TableCell className="p-3 align-top">
                                        <div className="w-12 h-12 rounded bg-slate-900 border border-slate-700 overflow-hidden relative shrink-0">
                                            {thumb ? (
                                                <Image src={thumb} alt={product.name} fill sizes="48px" className="object-cover" unoptimized />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center text-[10px] text-slate-600 uppercase">No</div>
                                            )}
                                            {isSaving && (
                                                <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                                                    <RefreshCw className="w-4 h-4 text-white animate-spin" />
                                                </div>
                                            )}
                                        </div>
                                    </TableCell>
                                    <TableCell className="p-2 align-top">
                                        <Input
                                            type="text"
                                            value={getValue(product, 'productId')}
                                            onChange={(e) => handleLocalChange(product.id, 'productId', e.target.value)}
                                            onBlur={() => handleSaveField(product, 'productId')}
                                            className="h-auto min-w-[100px] border-transparent bg-transparent px-2 py-1.5 font-mono text-sm text-slate-300 placeholder:text-slate-600 hover:border-slate-600 focus:bg-slate-800"
                                            placeholder="SKU"
                                        />
                                    </TableCell>
                                    <TableCell className="p-2 align-top">
                                        <Textarea
                                            value={getValue(product, 'name')}
                                            onChange={(e) => handleLocalChange(product.id, 'name', e.target.value)}
                                            onBlur={() => handleSaveField(product, 'name')}
                                            rows={2}
                                            className="min-h-0 min-w-[180px] resize-y border-transparent bg-transparent px-2 py-1.5 text-sm font-medium text-slate-200 placeholder:text-slate-600 hover:border-slate-600 focus:bg-slate-800"
                                            placeholder="Название"
                                        />
                                    </TableCell>
                                    <TableCell className="p-3 align-top">
                                        <ProductGenderBadge gender={product.gender} />
                                    </TableCell>
                                    <TableCell className="p-2 align-top">
                                        <Textarea
                                            value={getValue(product, 'description')}
                                            onChange={(e) => handleLocalChange(product.id, 'description', e.target.value)}
                                            onBlur={() => handleSaveField(product, 'description')}
                                            rows={2}
                                            className="min-h-0 min-w-[200px] resize-y border-transparent bg-transparent px-2 py-1.5 text-xs text-slate-400 shadow-none placeholder:text-slate-600 hover:border-slate-600 focus:bg-slate-800"
                                            placeholder="Описание отсутствует"
                                        />
                                    </TableCell>
                                    <TableCell className="p-2 align-top">
                                        <Input
                                            type="number"
                                            value={getValue(product, 'price')}
                                            onChange={(e) => handleLocalChange(product.id, 'price', e.target.value)}
                                            onBlur={() => handleSaveField(product, 'price')}
                                            className="h-auto min-w-[80px] border-transparent bg-transparent px-2 py-1.5 text-sm font-bold text-emerald-400 placeholder:text-slate-600 hover:border-slate-600 focus:bg-slate-800 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                            placeholder="0"
                                        />
                                    </TableCell>
                                    <TableCell className="p-2 align-top text-center">
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => handleDuplicate(product)}
                                            disabled={isCopying !== null}
                                            className="h-8 w-8 text-slate-400 hover:bg-slate-700 hover:text-indigo-400"
                                            title="Дублировать"
                                        >
                                            {isCopying === product.id ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Copy className="w-4 h-4" />}
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            )
                        })}
                    </TableBody>
                </Table>
            </div>
        </Card>
    )
}
