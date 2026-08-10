'use client'

import React, { useState, memo } from 'react';
import Image from 'next/image';
import { type Product } from '@/lib/types';
import { Trash2, Copy, RefreshCw } from 'lucide-react';
import { updateProductAction, createProductAction } from '@/actions/products';
import { useRouter } from 'next/navigation';
import { normalizeDescription } from '@/components/products/ProductDescription';
import { imagePresets, productImageUrl } from '@/lib/image';
import { isPriceOnRequest } from '@/lib/product-pricing';
import ProductGenderBadge from '@/components/products/ProductGenderBadge';
import ProductAttributeSummary from '@/components/products/ProductAttributeSummary';

interface ProductListItemProps {
    product: Product;
    onEdit: (product: Product) => void;
    onDelete: (id: string) => void;
    onUpdate: (product: Product) => void;
    selected: boolean;
    onToggleSelect: (id: string) => void;
}

const ProductListItem: React.FC<ProductListItemProps> = memo(({ product, onEdit, onDelete, onUpdate, selected, onToggleSelect }) => {
    const [editingField, setEditingField] = useState<'name' | 'price' | null>(null);
    const [editValue, setEditValue] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [isCopying, setIsCopying] = useState(false);
    const router = useRouter();

    const thumb = productImageUrl(product, imagePresets.productTable)

    const startEdit = (field: 'name' | 'price', e: React.MouseEvent) => {
        e.stopPropagation();
        setEditingField(field);
        setEditValue(field === 'price' ? product.price.toString() : product.name);
    }

    const handleSave = async () => {
        if (isSaving) return;
        setIsSaving(true);

        const categoryId = product.category || product.expand?.category?.id || '';
        const subcategoryId = product.subcategory || product.expand?.subcategory?.id || '';
        const nextPrice = editingField === 'price' ? parseFloat(editValue) || 0 : product.price;
        const priceOnRequest = isPriceOnRequest(nextPrice);

        const formData = new FormData();
        formData.append('productId', product.productId);
        formData.append('name', editingField === 'name' ? editValue.trim() : product.name);
        formData.append('description', normalizeDescription(product.description));
        formData.append('price', nextPrice.toString());
        formData.append('status', product.status);
        formData.append('gender', product.gender || '');
        formData.append('productMetadata', JSON.stringify(product.metadata || {}));
        formData.append('price_on_request', priceOnRequest ? 'true' : 'false');

        // Handle multiple brands
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

        formData.append('category', categoryId);
        formData.append('subcategory', subcategoryId);
        formData.append('media', JSON.stringify(product.media || product.photos.map((url, index) => ({
            original_url: url,
            preview_url: url,
            thumb_url: url,
            og_image_url: url,
            sort_order: index,
            processing_status: 'processed',
        }))));

        try {
            const result = await updateProductAction(product.id, formData);
            if (result.success) {
                const updatedProduct = {
                    ...product,
                    [editingField!]: editingField === 'price' ? nextPrice : editValue.trim(),
                    price_on_request: priceOnRequest,
                    metadata: {
                        ...(product.metadata || {}),
                        price_on_request: priceOnRequest,
                    },
                };
                onUpdate(updatedProduct);
            }
        } catch (e) {
            // update failed silently
        }
        setEditingField(null);
        setIsSaving(false);
    }

    const handleDuplicate = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (isCopying || !confirm('Дублировать этот товар?')) return;
        setIsCopying(true);

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
            formData.append('price_on_request', isPriceOnRequest(product.price) ? 'true' : 'false');
            formData.append('fulfillment_mode', 'made_to_order');
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
            setIsCopying(false);
        }
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleSave();
        } else if (e.key === 'Escape') {
            setEditingField(null);
        }
    }

    return (
        <div className="grid grid-cols-12 gap-4 p-4 items-center hover:bg-slate-700/30 transition-colors group">
            {/* Checkbox & Product Info */}
            <div className="col-span-12 sm:col-span-6 flex items-center gap-4">
                <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => onToggleSelect(product.id)}
                    className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                    onClick={(e) => e.stopPropagation()}
                />
                <div
                    className="relative w-12 h-12 rounded-lg bg-slate-900 overflow-hidden shrink-0 border border-slate-700 cursor-pointer"
                    onClick={() => onEdit(product)}
                >
                    {thumb ? (
                        <>
                            <Image
                                src={thumb}
                                alt={product.name}
                                fill
                                sizes="48px"
                                className="object-cover"
                                unoptimized
                            />
                            {product.photos && product.photos.length > 0 && (
                                <div className="absolute bottom-0 right-0 px-1 bg-slate-900/90 text-[8px] font-bold text-slate-300 rounded-tl-sm border-t border-l border-slate-700/50">
                                    {product.photos.length}
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-[10px] text-slate-600 uppercase">No</div>
                    )}
                </div>

                <div className="min-w-0 flex-1">
                    {/* Editable Name */}
                    {editingField === 'name' ? (
                        <input
                            type="text"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={handleSave}
                            onKeyDown={handleKeyDown}
                            autoFocus
                            className="text-sm font-semibold text-slate-100 bg-slate-700 border border-indigo-500 rounded px-2 py-1 outline-none w-full"
                            onClick={(e) => e.stopPropagation()}
                        />
                    ) : (
                        <>
                            <h4
                                className="text-sm font-semibold text-slate-100 truncate cursor-text hover:bg-slate-700/50 rounded px-1 -mx-1"
                                onClick={(e) => startEdit('name', e)}
                            >
                                {product.name}
                            </h4>
                            <div className="flex items-center gap-2">
                                <p className="text-[10px] text-slate-500 font-mono">{product.productId}</p>
                                <p className="text-[10px] text-indigo-400 font-semibold truncate">
                                    {(() => {
                                        const b = product.expand?.brand;
                                        if (Array.isArray(b)) return b.map(x => x.name).join(', ');
                                        if (b && typeof b === 'object') return b.name;
                                        return 'No Brand';
                                    })()}
                                </p>
                            </div>
                            <ProductAttributeSummary product={product} compact />
                        </>
                    )}
                </div>
            </div>

            {/* Category Info */}
            <div className="col-span-8 sm:col-span-4 flex flex-col justify-center">
                <span className="text-xs font-medium text-slate-300">
                    {product.expand?.category?.name || (product.category ? 'Категория' : 'Без категории')}
                </span>
                <span className="text-[10px] text-slate-500">
                    {product.expand?.subcategory?.name || 'Без подкатегории'}
                </span>
                <ProductGenderBadge gender={product.gender} className="mt-1 w-fit" />
            </div>

            {/* Price & Actions */}
            <div className="col-span-4 sm:col-span-2 flex flex-col items-end justify-center">
                {/* Editable Price */}
                {editingField === 'price' ? (
                    <input
                        type="number"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={handleSave}
                        onKeyDown={handleKeyDown}
                        autoFocus
                        className="text-sm font-bold text-slate-200 bg-slate-700 border border-indigo-500 rounded px-2 py-1 w-24 outline-none text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        onClick={(e) => e.stopPropagation()}
                    />
                ) : (
                    <div
                        className="text-sm font-bold text-slate-200 cursor-text hover:bg-slate-700/50 rounded px-1 -mx-1"
                        onClick={(e) => startEdit('price', e)}
                    >
                        {isPriceOnRequest(product.price)
                            ? 'Цена по запросу'
                            : new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(product.price)}
                    </div>
                )}
                <div className="flex gap-2 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                        onClick={handleDuplicate}
                        disabled={isCopying}
                        className="p-1 text-slate-400 hover:text-indigo-400 disabled:opacity-30"
                        title="Дублировать"
                    >
                        {isCopying ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Copy className="w-4 h-4" />}
                    </button>
                    <button
                        onClick={() => onDelete(product.id)}
                        className="p-1 text-slate-400 hover:text-red-400"
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>
                </div>
            </div>
        </div>
    );
});

ProductListItem.displayName = 'ProductListItem';

export default ProductListItem;
