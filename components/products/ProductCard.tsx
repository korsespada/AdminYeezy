'use client'

import React, { useState, memo, useMemo } from 'react';
import Image from 'next/image';
import { type Category, type Product, type Subcategory } from '@/lib/types';
import { Trash2, Copy } from 'lucide-react';
import { updateProductAction, createProductAction } from '@/actions/products';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import ProductDescription, { normalizeDescription } from '@/components/products/ProductDescription';
import { imagePresets, productImageUrl } from '@/lib/image';
import ProductGenderBadge from '@/components/products/ProductGenderBadge';

interface ProductCardProps {
    product: Product;
    onEdit: (product: Product) => void;
    onDelete: (id: string) => void;
    onUpdate: (product: Product) => void;
    selected: boolean;
    onToggleSelect: (id: string) => void;
    categories?: Category[];
    subcategories?: Subcategory[];
}

const ProductCard: React.FC<ProductCardProps> = memo(({ product, onEdit, onDelete, onUpdate, selected, onToggleSelect, categories = [], subcategories = [] }) => {
    const [editingField, setEditingField] = useState<'name' | 'price' | null>(null);
    const [editValue, setEditValue] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [isCopying, setIsCopying] = useState(false);
    const router = useRouter();

    const thumb = useMemo(() => productImageUrl(product, imagePresets.productGrid), [product])

    const categoryLabel = useMemo(() => {
        const categoryName = product.expand?.category?.name
            || categories.find((category) => category.id === product.category)?.name
            || ''
        const subcategoryName = product.expand?.subcategory?.name
            || subcategories.find((subcategory) => subcategory.id === product.subcategory)?.name
            || ''

        return {
            category: categoryName || (product.category ? 'Категория' : 'Без категории'),
            subcategory: subcategoryName,
        }
    }, [product.category, product.subcategory, product.expand?.category?.name, product.expand?.subcategory?.name, categories, subcategories])

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
        formData.append('description', normalizeDescription(product.description));
        formData.append('price', editingField === 'price' ? editValue : product.price.toString());
        formData.append('status', product.status);
        formData.append('gender', product.gender || '');
        formData.append('productMetadata', JSON.stringify(product.metadata || {}));
        formData.append('price_on_request', product.price_on_request ? 'true' : 'false');

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
            setIsCopying(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleSave();
        } else if (e.key === 'Escape') {
            setEditingField(null);
        }
    }

    return (
        <Card className="group flex h-full flex-col overflow-hidden border-slate-700 bg-slate-800 transition-all duration-300 hover:border-slate-600 hover:shadow-xl hover:shadow-black/20">
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
                    <Checkbox
                        checked={selected}
                        onCheckedChange={() => onToggleSelect(product.id)}
                        className="h-5 w-5 border-slate-700 bg-slate-900/80 shadow-lg backdrop-blur-sm"
                        onClick={(e) => e.stopPropagation()}
                    />
                </div>
                {/* Delete button on hover */}
                <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col gap-2">
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={(e) => { e.stopPropagation(); onDelete(product.id); }}
                        className="h-8 w-8 rounded-full bg-slate-900/80 text-slate-300 shadow-lg backdrop-blur-sm hover:bg-red-600 hover:text-white"
                        title="Удалить"
                    >
                        <Trash2 className="w-4 h-4" />
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={handleDuplicate}
                        disabled={isCopying}
                        className="h-8 w-8 rounded-full bg-slate-900/80 text-slate-300 shadow-lg backdrop-blur-sm hover:bg-indigo-600 hover:text-white"
                        title="Дублировать"
                    >
                        <Copy className="w-4 h-4" />
                    </Button>
                </div>

                {/* Photo Count Tag */}
                {product.photos && product.photos.length > 0 && (
                    <Badge variant="outline" className="absolute bottom-3 right-3 z-10 border-slate-700/50 bg-slate-900/80 text-[10px] text-slate-300 backdrop-blur-sm">
                        {product.photos.length} фото
                    </Badge>
                )}
            </div>

            <CardContent className="flex flex-1 flex-col p-5">
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
                        {categoryLabel.category}
                        {categoryLabel.subcategory && ` • ${categoryLabel.subcategory}`}
                        <ProductGenderBadge gender={product.gender} className="ml-2" />
                    </div>
                </div>

                {/* Editable Name */}
                {editingField === 'name' ? (
                    <Input
                        type="text"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={handleSave}
                        onKeyDown={handleKeyDown}
                        autoFocus
                        className="mb-2 h-auto bg-slate-700 px-2 py-1 text-base font-bold leading-tight text-slate-100"
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
                        <p className="mb-4 line-clamp-2 text-sm text-slate-400">
                            <ProductDescription text={product.description} />
                        </p>
                    )}
                </div>

                <div className="flex items-center justify-between pt-4 border-t border-slate-700 mt-auto">
                    {/* Editable Price */}
                    {editingField === 'price' ? (
                        <Input
                            type="number"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={handleSave}
                            onKeyDown={handleKeyDown}
                            autoFocus
                            className="h-auto w-28 bg-slate-700 px-2 py-1 text-lg font-bold text-slate-200 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
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
            </CardContent>
        </Card>
    );
});

ProductCard.displayName = 'ProductCard';

export default ProductCard;
