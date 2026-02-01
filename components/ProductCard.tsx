'use client'

import React, { useState } from 'react';
import { type Product } from '@/lib/types';
import { Trash2 } from 'lucide-react';
import { updateProductAction } from '@/actions/products';

interface ProductCardProps {
    product: Product;
    onEdit: (product: Product) => void;
    onDelete: (id: string) => void;
    onUpdate: (product: Product) => void;
}

const ProductCard: React.FC<ProductCardProps> = ({ product, onEdit, onDelete, onUpdate }) => {
    const [editingField, setEditingField] = useState<'name' | 'price' | null>(null);
    const [editValue, setEditValue] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    const getPhotoUrl = (product: Product) => {
        if (!product.photos || product.photos.length === 0) return null
        let photoUrl = product.photos[0]
        if (typeof photoUrl === 'string' && photoUrl.startsWith('[')) {
            try {
                const photosArray = JSON.parse(photoUrl)
                photoUrl = photosArray[0]
            } catch (e) {
                console.error('Failed to parse photos JSON:', e)
            }
        }
        return photoUrl
    }

    const thumb = getPhotoUrl(product)

    const startEdit = (field: 'name' | 'price', e: React.MouseEvent) => {
        e.stopPropagation();
        setEditingField(field);
        setEditValue(field === 'price' ? product.price.toString() : product.name);
    }

    const handleSave = async () => {
        if (isSaving) return;
        setIsSaving(true);

        const formData = new FormData();
        formData.append('productId', product.productId);
        formData.append('name', editingField === 'name' ? editValue.trim() : product.name);
        formData.append('description', product.description || '');
        formData.append('price', editingField === 'price' ? editValue : product.price.toString());
        formData.append('status', product.status);
        formData.append('brand', product.brand);
        formData.append('category', product.category);
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
            console.error('Update failed:', e);
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
                    <img
                        src={thumb}
                        alt={product.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 opacity-90 group-hover:opacity-100"
                    />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-600 bg-slate-800/50 uppercase tracking-widest text-xs">
                        No image
                    </div>
                )}
                {/* Delete button on hover */}
                <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                        onClick={(e) => { e.stopPropagation(); onDelete(product.id); }}
                        className="p-2 bg-slate-900/80 backdrop-blur-sm rounded-full shadow-lg hover:bg-red-600 text-slate-300 hover:text-white transition-colors"
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>
                </div>
            </div>

            <div className="p-5 flex-1 flex flex-col">
                {/* Product ID under the photo */}
                <div className="text-[10px] text-slate-500 font-mono mb-2">{product.productId}</div>

                <div className="mb-2">
                    <div className="text-xs text-slate-500">
                        {product.expand?.category?.name || 'No Category'}
                        {product.expand?.subcategory?.name && ` • ${product.expand.subcategory.name}`}
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
                            className="font-bold text-lg text-slate-200 bg-slate-700 border border-indigo-500 rounded px-2 py-1 w-28 outline-none"
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
};

export default ProductCard;
