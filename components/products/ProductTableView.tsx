'use client'

import React, { useState, useCallback } from 'react'
import Image from 'next/image'
import { type Product } from '@/lib/types'
import { Square, CheckSquare, Search, ReplaceAll, RefreshCw, Copy } from 'lucide-react'
import { bulkPatchObjectsAction } from '@/actions/bulk-update'
import { createProductAction } from '@/actions/products'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface ProductTableViewProps {
    products: Product[]
    selectedIds: string[]
    onToggleSelect: (id: string) => void
    onToggleSelectAll: () => void
    onUpdateProduct: (product: Product) => void
}

const getPhotoUrl = (product: Product) => {
    if (!product) return null

    if (product.thumb && typeof product.thumb === 'string') {
        if (product.thumb.startsWith('http')) {
            return product.thumb;
        }
        return `https://yeezy-app-thumbs.hb.ru-msk.vkcloud-storage.ru/products/${product.id}/${product.thumb}`
    }

    if (!product.photos || product.photos.length === 0) return null
    let photoUrl = product.photos[0]
    if (typeof photoUrl === 'string' && photoUrl.startsWith('[')) {
        try {
            const photosArray = JSON.parse(photoUrl)
            photoUrl = photosArray[0]
        } catch (e) {
            // ignore
        }
    }

    if (typeof photoUrl === 'string') {
        if (photoUrl.includes('szwego.com')) {
            const IMG_SUFFIX = '?imageMogr2/auto-orient/thumbnail/!320x320r/quality/100/format/jpg'
            if (!photoUrl.includes('?imageMogr2')) {
                photoUrl += IMG_SUFFIX
            }
        } else if (!photoUrl.startsWith('http') && !photoUrl.includes('/')) {
            photoUrl = `https://cdn.yeezyunique.ru/products/${product.id}/${photoUrl}`;
        }
    }

    return photoUrl
}

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
        return product[field] || ''
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
            formData.append('description', product.description || '');
            formData.append('price', product.price.toString());
            formData.append('status', product.status);
            formData.append('gender', product.gender || '');
            formData.append('productMetadata', JSON.stringify(product.metadata || {}));
            formData.append('price_on_request', product.price_on_request ? 'true' : 'false');
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
        <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden shadow-sm mb-8 flex flex-col h-[calc(100vh-280px)]">
            {/* Mass Replace Toolbar */}
            <div className="p-4 border-b border-slate-700 bg-slate-800/50 shrink-0">
                <div className="flex flex-col sm:flex-row items-center gap-4">
                    <div className="flex items-center gap-2 text-sm font-medium text-slate-300">
                        <ReplaceAll className="w-4 h-4 text-indigo-400" />
                        Массовая замена
                    </div>

                    <div className="flex flex-wrap items-center gap-2 flex-1">
                        <select
                            value={replaceField}
                            onChange={e => setReplaceField(e.target.value as FieldName)}
                            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:ring-1 focus:ring-indigo-500 outline-none"
                        >
                            <option value="name">Название</option>
                            <option value="description">Описание</option>
                            <option value="price">Цена</option>
                        </select>
                        <input
                            type="text"
                            placeholder="Найти (или *)..."
                            value={findText}
                            onChange={e => setFindText(e.target.value)}
                            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:ring-1 focus:ring-indigo-500 outline-none flex-1 min-w-[120px]"
                        />
                        <input
                            type="text"
                            placeholder="Заменить на..."
                            value={replaceText}
                            onChange={e => setReplaceText(e.target.value)}
                            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:ring-1 focus:ring-indigo-500 outline-none flex-1 min-w-[120px]"
                        />
                        <button
                            onClick={handleMassReplace}
                            disabled={isReplacing || selectedIds.length === 0}
                            className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-slate-500 text-white px-4 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 whitespace-nowrap"
                        >
                            {isReplacing ? <RefreshCw className="w-4 h-4 animate-spin" /> : 'Заменить в выбранных'}
                        </button>
                    </div>
                </div>
            </div>

            {/* Table Container */}
            <div className="flex-1 overflow-auto custom-scrollbar relative">
                <table className="w-full text-left border-collapse min-w-[800px]">
                    <thead className="sticky top-0 z-10 bg-slate-800 shadow-md">
                        <tr>
                            <th className="p-3 w-12 border-b border-slate-700 text-center">
                                <button className="text-slate-400 hover:text-white transition-colors" onClick={onToggleSelectAll}>
                                    {selectedIds.length === products.length && products.length > 0 ? (
                                        <CheckSquare className="w-4 h-4 text-indigo-500" />
                                    ) : (
                                        <Square className="w-4 h-4" />
                                    )}
                                </button>
                            </th>
                            <th className="p-3 border-b border-slate-700 font-medium text-xs text-slate-400 uppercase tracking-wider w-16">Фото</th>
                            <th className="p-3 border-b border-slate-700 font-medium text-xs text-slate-400 uppercase tracking-wider">
                                <div className="min-w-[120px] max-w-xs resize-x overflow-hidden pr-2" title="Потяните за правый край, чтобы изменить ширину">Product ID</div>
                            </th>
                            <th className="p-3 border-b border-slate-700 font-medium text-xs text-slate-400 uppercase tracking-wider">
                                <div className="min-w-[200px] max-w-md resize-x overflow-hidden pr-2">Название</div>
                            </th>
                            <th className="p-3 border-b border-slate-700 font-medium text-xs text-slate-400 uppercase tracking-wider">
                                <div className="min-w-[250px] max-w-xl resize-x overflow-hidden pr-2">Описание</div>
                            </th>
                            <th className="p-3 border-b border-slate-700 font-medium text-xs text-slate-400 uppercase tracking-wider">
                                <div className="min-w-[100px] max-w-[150px] resize-x overflow-hidden pr-2">Цена</div>
                            </th>
                            <th className="p-3 border-b border-slate-700 font-medium text-xs text-slate-400 uppercase tracking-wider w-12 text-center">Действия</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700/50">
                        {products.map(product => {
                            const isSelected = selectedIds.includes(product.id)
                            const thumb = getPhotoUrl(product)
                            const isSaving = savingId === product.id

                            return (
                                <tr key={product.id} className={`hover:bg-slate-700/20 transition-colors ${isSelected ? 'bg-indigo-500/5' : ''}`}>
                                    <td className="p-3 text-center align-top">
                                        <input
                                            type="checkbox"
                                            checked={isSelected}
                                            onChange={() => onToggleSelect(product.id)}
                                            className="mt-2 w-4 h-4 rounded border-slate-600 bg-slate-700 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                                        />
                                    </td>
                                    <td className="p-3 align-top">
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
                                    </td>
                                    <td className="p-2 align-top">
                                        <input
                                            type="text"
                                            value={getValue(product, 'productId')}
                                            onChange={(e) => handleLocalChange(product.id, 'productId', e.target.value)}
                                            onBlur={() => handleSaveField(product, 'productId')}
                                            className="w-full min-w-[100px] bg-transparent border border-transparent hover:border-slate-600 focus:border-indigo-500 focus:bg-slate-800 rounded px-2 py-1.5 text-sm text-slate-300 font-mono outline-none transition-all placeholder-slate-600"
                                            placeholder="SKU"
                                        />
                                    </td>
                                    <td className="p-2 align-top">
                                        <textarea
                                            value={getValue(product, 'name')}
                                            onChange={(e) => handleLocalChange(product.id, 'name', e.target.value)}
                                            onBlur={() => handleSaveField(product, 'name')}
                                            rows={2}
                                            className="w-full min-w-[180px] bg-transparent border border-transparent hover:border-slate-600 focus:border-indigo-500 focus:bg-slate-800 rounded px-2 py-1.5 text-sm text-slate-200 font-medium outline-none transition-all placeholder-slate-600 resize-y"
                                            placeholder="Название"
                                        />
                                    </td>
                                    <td className="p-2 align-top">
                                        <textarea
                                            value={getValue(product, 'description')}
                                            onChange={(e) => handleLocalChange(product.id, 'description', e.target.value)}
                                            onBlur={() => handleSaveField(product, 'description')}
                                            rows={2}
                                            className="w-full min-w-[200px] bg-transparent border border-transparent hover:border-slate-600 focus:border-indigo-500 focus:bg-slate-800 rounded px-2 py-1.5 text-xs text-slate-400 outline-none transition-all placeholder-slate-600 shadow-none resize-y"
                                            placeholder="Описание отсутствует"
                                        />
                                    </td>
                                    <td className="p-2 align-top">
                                        <input
                                            type="number"
                                            value={getValue(product, 'price')}
                                            onChange={(e) => handleLocalChange(product.id, 'price', e.target.value)}
                                            onBlur={() => handleSaveField(product, 'price')}
                                            className="w-full min-w-[80px] bg-transparent border border-transparent hover:border-slate-600 focus:border-indigo-500 focus:bg-slate-800 rounded px-2 py-1.5 text-sm font-bold text-emerald-400 outline-none transition-all placeholder-slate-600 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                            placeholder="0"
                                        />
                                    </td>
                                    <td className="p-2 align-top text-center">
                                        <button
                                            onClick={() => handleDuplicate(product)}
                                            disabled={isCopying !== null}
                                            className="p-1.5 text-slate-400 hover:text-indigo-400 hover:bg-slate-700 rounded transition-colors disabled:opacity-30"
                                            title="Дублировать"
                                        >
                                            {isCopying === product.id ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Copy className="w-4 h-4" />}
                                        </button>
                                    </td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    )
}
