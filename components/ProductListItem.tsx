'use client'

import React, { useState } from 'react';
import { type Product } from '@/lib/types';
import { Trash2 } from 'lucide-react';
import { updateProductAction } from '@/actions/products';

interface ProductListItemProps {
    product: Product;
    onEdit: (product: Product) => void;
    onDelete: (id: string) => void;
    onUpdate: (product: Product) => void;
}

const ProductListItem: React.FC<ProductListItemProps> = ({ product, onEdit, onDelete, onUpdate }) => {
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
        <div className="grid grid-cols-12 gap-4 p-4 items-center hover:bg-slate-700/30 transition-colors group">
            {/* Product Info */}
            <div className="col-span-12 sm:col-span-6 flex items-center gap-4">
                <div
                    className="w-12 h-12 rounded-lg bg-slate-900 overflow-hidden shrink-0 border border-slate-700 cursor-pointer"
                    onClick={() => onEdit(product)}
                >
                    {thumb ? (
                        <img src={thumb} alt={product.name} className="w-full h-full object-cover" />
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
                        <h4
                            className="text-sm font-semibold text-slate-100 truncate cursor-text hover:bg-slate-700/50 rounded px-1 -mx-1"
                            onClick={(e) => startEdit('name', e)}
                        >
                            {product.name}
                        </h4>
                    )}
                    <p className="text-xs text-slate-500 truncate">{product.productId}</p>
                </div>
            </div>

            {/* Category Info */}
            <div className="col-span-8 sm:col-span-4 flex flex-col justify-center">
                <span className="text-xs font-medium text-slate-300">
                    {product.expand?.category?.name || 'No Category'}
                </span>
                <span className="text-[10px] text-slate-500">
                    {product.expand?.subcategory?.name || 'No Subcategory'}
                </span>
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
                        className="text-sm font-bold text-slate-200 bg-slate-700 border border-indigo-500 rounded px-2 py-1 w-24 outline-none text-right"
                        onClick={(e) => e.stopPropagation()}
                    />
                ) : (
                    <div
                        className="text-sm font-bold text-slate-200 cursor-text hover:bg-slate-700/50 rounded px-1 -mx-1"
                        onClick={(e) => startEdit('price', e)}
                    >
                        {new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(product.price)}
                    </div>
                )}
                <div className="flex gap-2 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
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
};

export default ProductListItem;
