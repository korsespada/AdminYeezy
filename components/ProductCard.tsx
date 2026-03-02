'use client'

import React, { useState, memo, useMemo } from 'react';
import Image from 'next/image';
import { type Product } from '@/lib/types';
import { Trash2 } from 'lucide-react';
import { updateProductAction } from '@/actions/products';

interface ProductCardProps {
    product: Product;
    onEdit: (product: Product) => void;
    onDelete: (id: string) => void;
    onUpdate: (product: Product) => void;
    selected: boolean;
    onToggleSelect: (id: string) => void;
}

const ProductCard: React.FC<ProductCardProps> = memo(({ product, onEdit, onDelete, onUpdate, selected, onToggleSelect }) => {
    const [editingField, setEditingField] = useState<'name' | 'price' | null>(null);
    const [editValue, setEditValue] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    const thumb = useMemo(() => {
        if (!product) return null

        if (product.thumb && typeof product.thumb === 'string') {
            if (product.thumb.startsWith('http')) return product.thumb
            return `https://yeezy-app-thumbs.hb.ru-msk.vkcloud-storage.ru/products/${product.id}/${product.thumb}`
        }

        if (!product.photos || product.photos.length === 0) return null
        let photoUrl = product.photos[0]
        if (typeof photoUrl === 'string' && photoUrl.startsWith('[')) {
            try {
                const photosArray = JSON.parse(photoUrl)
                photoUrl = photosArray[0]
            } catch (e) { /* ignore */ }
        }

        if (typeof photoUrl === 'string') {
            if (photoUrl.includes('szwego.com')) {
                const IMG_SUFFIX = '?imageMogr2/auto-orient/thumbnail/!320x320r/quality/100/format/jpg'
                if (!photoUrl.includes('?imageMogr2')) photoUrl += IMG_SUFFIX
            } else if (!photoUrl.startsWith('http') && !photoUrl.includes('/')) {
                photoUrl = `https://cdn.yeezyunique.ru/products/${product.id}/${photoUrl}`
            }
        }

        return photoUrl
    }, [product.id, product.thumb, product.photos])

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

        const formData = new FormData();
        formData.append('productId', product.productId);
        formData.append('name', editingField === 'name' ? editValue.trim() : product.name);
        formData.append('description', product.description || '');
        formData.append('price', editingField === 'price' ? editValue : product.price.toString());
        formData.append('status', product.status);
        formData.append('gender', product.gender || '');

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
        if (product.photos && product.photos.length > 0) {
            formData.append('existingPhotos', JSON.stringify(product.photos));
        }

        try {
            const result = await updateProductAction(product.id, formData);
            if (result.success) {
                const updatedProduct = {
                    ...product,
                    [editingField!]: editingField === 'price' ? parseFloat(editValue) : editValue.trim()
                };
                onUpdate(updatedProduct);
            }
        } catch (e) {
            // update failed silently
        }
        setEditingField(null);
        setIsSaving(false);
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleSave();
        } else if (e.key === 'Escape') {
            setEditingField(null);
        }
    }

    return (
        <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden hover:shadow-xl hover:shadow-black/20 hover:border-slate-600 transition-all duration-300 group flex flex-col h-full">
            {/* Image area - clickable to edit */}
            <div
                className="relative aspect-square overflow-hidden bg-slate-900 cursor-pointer"
                onClick={() => onEdit(product)}
            >
                {thumb ? (
                    <Image
                        src={thumb}
                        alt={product.name}
                        fill
                        sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 25vw"
                        className="object-cover group-hover:scale-105 transition-transform duration-500 opacity-90 group-hover:opacity-100"
                        unoptimized
                    />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-600 bg-slate-800/50 uppercase tracking-widest text-xs">
                        No image
                    </div>
                )}

                {/* Selection Checkbox */}
                <div className="absolute top-3 left-3 z-10">
                    <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => onToggleSelect(product.id)}
                        className="w-5 h-5 rounded border-slate-700 bg-slate-900/80 text-indigo-600 focus:ring-indigo-500 cursor-pointer shadow-lg backdrop-blur-sm"
                        onClick={(e) => e.stopPropagation()}
                    />
                </div>
                {/* Delete button on hover */}
                <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                        onClick={(e) => { e.stopPropagation(); onDelete(product.id); }}
                        className="p-2 bg-slate-900/80 backdrop-blur-sm rounded-full shadow-lg hover:bg-red-600 text-slate-300 hover:text-white transition-colors"
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>
                </div>

                {/* Photo Count Tag */}
                {product.photos && product.photos.length > 0 && (
                    <div className="absolute bottom-3 right-3 px-2 py-1 bg-slate-900/80 backdrop-blur-sm rounded-md text-[10px] font-bold text-slate-300 z-10 border border-slate-700/50">
                        {product.photos.length} фото
                    </div>
                )}
            </div>

            <div className="p-5 flex-1 flex flex-col">
                {/* Product ID under the photo */}
                <div className="mb-2">
                    <div className="text-[10px] text-slate-500 font-mono">{product.productId}</div>
                    <div className="text-[10px] text-indigo-400 font-semibold truncate">
                        {useMemo(() => {
                            const b = product.expand?.brand;
                            if (Array.isArray(b)) return b.map(x => x.name).join(', ');
                            if (b && typeof b === 'object') return b.name;
                            return 'No Brand';
                        }, [product.expand?.brand])}
                    </div>
                </div>

                <div className="mb-2">
                    <div className="text-xs text-slate-500">
                        {product.expand?.category?.name || 'No Category'}
                        {product.expand?.subcategory?.name && ` • ${product.expand.subcategory.name}`}
                        {product.gender && (
                            <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] font-medium ${product.gender === 'Для мужчин'
                                ? 'bg-blue-900/30 text-blue-400'
                                : 'bg-pink-900/30 text-pink-400'
                                }`}>
                                {product.gender.replace('Для ', '')}
                            </span>
                        )}
                    </div>
                </div>

                {/* Editable Name */}
                {editingField === 'name' ? (
                    <input
                        type="text"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={handleSave}
                        onKeyDown={handleKeyDown}
                        autoFocus
                        className="text-base font-bold text-slate-100 mb-2 leading-tight bg-slate-700 border border-indigo-500 rounded px-2 py-1 outline-none"
                        onClick={(e) => e.stopPropagation()}
                    />
                ) : (
                    <h3
                        className="text-base font-bold text-slate-100 mb-2 leading-tight cursor-text hover:bg-slate-700/50 rounded px-1 -mx-1"
                        onClick={(e) => startEdit('name', e)}
                    >
                        {product.name}
                    </h3>
                )}

                <div className="flex-1">
                    {product.description && (
                        <p className="text-sm text-slate-400 mb-4 line-clamp-2">{product.description}</p>
                    )}
                </div>

                <div className="flex items-center justify-between pt-4 border-t border-slate-700 mt-auto">
                    {/* Editable Price */}
                    {editingField === 'price' ? (
                        <input
                            type="number"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={handleSave}
                            onKeyDown={handleKeyDown}
                            autoFocus
                            className="font-bold text-lg text-slate-200 bg-slate-700 border border-indigo-500 rounded px-2 py-1 w-28 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            onClick={(e) => e.stopPropagation()}
                        />
                    ) : (
                        <div
                            className="font-bold text-lg text-slate-200 cursor-text hover:bg-slate-700/50 rounded px-1 -mx-1"
                            onClick={(e) => startEdit('price', e)}
                        >
                            {new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(product.price)}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
});

ProductCard.displayName = 'ProductCard';

export default ProductCard;
