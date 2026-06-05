'use client'

import React, { useState, useEffect } from 'react'
import { X, Filter, Search } from 'lucide-react'
import { type Brand, type Category, type Subcategory } from '@/lib/types'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'

interface SidebarProps {
    brands: Brand[]
    categories: Category[]
    subcategories: Subcategory[]
    activeSubcategoryIds: string[]
    isOpen: boolean
    onClose: () => void
    count: number
}

const Sidebar: React.FC<SidebarProps> = ({ brands, categories, subcategories, activeSubcategoryIds, isOpen, onClose, count }) => {
    const router = useRouter()
    const searchParams = useSearchParams()
    const [brandSearch, setBrandSearch] = useState('')
    const [searchValue, setSearchValue] = useState(searchParams.get('search') || '')

    const currentBrand = searchParams.get('brand') || ''
    const currentCategory = searchParams.get('category') || ''
    const currentSubcategory = searchParams.get('subcategory') || ''
    const currentGender = searchParams.get('gender') || ''

    // Debounce search
    useEffect(() => {
        const timer = setTimeout(() => {
            if (searchValue !== (searchParams.get('search') || '')) {
                applyFilter('search', searchValue || null)
            }
        }, 500)
        return () => clearTimeout(timer)
    }, [searchValue])

    // Update local search value when URL changes (e.g. on reset)
    useEffect(() => {
        setSearchValue(searchParams.get('search') || '')
    }, [searchParams])

    const applyFilter = (key: string, value: string | null) => {
        const params = new URLSearchParams(searchParams.toString())
        if (value) {
            params.set(key, value)
        } else {
            params.delete(key)
        }

        // Reset page when filters change
        params.delete('page')

        // Special case: if category changes, reset subcategory
        if (key === 'category') {
            params.delete('subcategory')
        }

        router.push(`/admin?${params.toString()}`)
    }

    const handleReset = () => {
        setSearchValue('')
        router.push('/admin')
    }

    const availableSubcategories = currentCategory
        ? subcategories.filter(sub => sub.category === currentCategory || activeSubcategoryIds.includes(sub.id))
        : []

    // Filter brands by search
    const filteredBrands = brandSearch
        ? brands.filter(b => b.name.toLowerCase().includes(brandSearch.toLowerCase()))
        : brands

    return (
        <>
            {/* Mobile Overlay */}
            <div
                className={`fixed inset-0 bg-black/70 z-40 transition-opacity lg:hidden ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                onClick={onClose}
            />

            {/* Sidebar Container */}
            <aside className={`
        fixed lg:sticky top-0 left-0 h-screen w-72 bg-slate-800 border-r border-slate-700 z-50 overflow-y-auto transition-transform duration-300 ease-in-out
        ${isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
                <div className="p-6">
                    <div className="flex items-center justify-between mb-8">
                        <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
                            <Filter className="w-5 h-5 text-indigo-400" />
                            Фильтры
                        </h2>
                        <Button variant="ghost" size="icon" onClick={onClose} className="lg:hidden text-slate-400 hover:text-slate-200">
                            <X className="w-6 h-6" />
                        </Button>
                    </div>

                    <div className="space-y-6">

                        {/* Search (Modern) */}
                        <div>
                            <Label className="mb-2 block text-slate-300">Поиск</Label>
                            <div className="relative">
                                <Input
                                    type="text"
                                    placeholder="Поиск..."
                                    value={searchValue}
                                    onChange={(e) => setSearchValue(e.target.value)}
                                    className="bg-slate-700 pl-9 text-slate-200 placeholder:text-slate-500"
                                />
                                <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                            </div>
                        </div>

                        {/* Category Filter */}
                        <div>
                            <Label className="mb-2 block text-slate-300">Категория</Label>
                            <Select
                                value={currentCategory || '__all__'}
                                onValueChange={(value) => applyFilter('category', value === '__all__' ? null : value)}
                            >
                                <SelectTrigger className="bg-slate-700 text-slate-200">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                <SelectItem value="__all__">Все категории</SelectItem>
                                {categories.map(cat => (
                                    <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                                ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Subcategory Filter (Conditional) */}
                        <div>
                            <Label className="mb-2 block text-slate-300">Подкатегория</Label>
                            <Select
                                value={currentSubcategory || '__all__'}
                                onValueChange={(value) => applyFilter('subcategory', value === '__all__' ? null : value)}
                            >
                                <SelectTrigger className="bg-slate-700 text-slate-200">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                <SelectItem value="__all__">Все подкатегории</SelectItem>
                                <SelectItem value="__none__">Без подкатегории</SelectItem>
                                {availableSubcategories.map(sub => {
                                    const isForeign = sub.category !== currentCategory
                                    const foreignCategoryName = isForeign
                                        ? categories.find(c => c.id === sub.category)?.name || 'Другое'
                                        : '';
                                    return (
                                        <SelectItem key={sub.id} value={sub.id}>
                                            {sub.name} {isForeign ? `(из: ${foreignCategoryName})` : ''}
                                        </SelectItem>
                                    )
                                })}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Gender Filter */}
                        <div>
                            <Label className="mb-2 block text-slate-300">Пол</Label>
                            <div className="flex flex-wrap gap-2">
                                <Button
                                    type="button"
                                    size="sm"
                                    variant={!currentGender ? 'default' : 'outline'}
                                    onClick={() => applyFilter('gender', null)}
                                    className={!currentGender ? '' : 'border-slate-600 bg-slate-700 text-slate-300 hover:bg-slate-600 hover:text-white'}
                                >
                                    Все
                                </Button>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant={currentGender === 'Для мужчин' ? 'default' : 'outline'}
                                    onClick={() => applyFilter('gender', 'Для мужчин')}
                                    className={currentGender === 'Для мужчин' ? '' : 'border-slate-600 bg-slate-700 text-slate-300 hover:bg-slate-600 hover:text-white'}
                                >
                                    Мужчинам
                                </Button>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant={currentGender === 'Для женщин' ? 'default' : 'outline'}
                                    onClick={() => applyFilter('gender', 'Для женщин')}
                                    className={currentGender === 'Для женщин' ? '' : 'border-slate-600 bg-slate-700 text-slate-300 hover:bg-slate-600 hover:text-white'}
                                >
                                    Женщинам
                                </Button>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant={currentGender === '__none__' ? 'default' : 'outline'}
                                    onClick={() => applyFilter('gender', '__none__')}
                                    className={currentGender === '__none__' ? '' : 'border-slate-600 bg-slate-700 text-slate-300 hover:bg-slate-600 hover:text-white'}
                                >
                                    Без гендера
                                </Button>
                            </div>
                        </div>

                        {/* Brand Filter with Search */}
                        <div>
                            <Label className="mb-2 block text-slate-300">Бренды</Label>
                            {/* Brand Search Input */}
                            <div className="relative mb-2">
                                <Input
                                    type="text"
                                    placeholder="Поиск бренда..."
                                    value={brandSearch}
                                    onChange={(e) => setBrandSearch(e.target.value)}
                                    className="h-8 bg-slate-700 pl-8 text-xs text-slate-200 placeholder:text-slate-500"
                                />
                                <Search className="w-3 h-3 text-slate-500 absolute left-3 top-2" />
                            </div>

                            {/* Brand List */}
                            <ScrollArea className="h-60 pr-2">
                            <div className="space-y-0.5">
                                {(() => {
                                    const selectedIds = currentBrand ? currentBrand.split(',') : []

                                    // 1. Sort brands: selected first, then by name
                                    const sortedBrands = [...filteredBrands].sort((a, b) => {
                                        const aSelected = selectedIds.includes(a.id)
                                        const bSelected = selectedIds.includes(b.id)
                                        if (aSelected && !bSelected) return -1
                                        if (!aSelected && bSelected) return 1
                                        return a.name.localeCompare(b.name)
                                    })

                                    return sortedBrands.map(brand => {
                                        const isSelected = selectedIds.includes(brand.id)
                                        return (
                                            <label key={brand.id} className={`flex items-center gap-2 cursor-pointer group py-1 px-1.5 rounded-md transition-colors ${isSelected ? 'bg-indigo-500/10' : 'hover:bg-slate-700/50'}`}>
                                                <Checkbox
                                                    checked={isSelected}
                                                    onCheckedChange={() => {
                                                        let newIds: string[]
                                                        if (isSelected) {
                                                            newIds = selectedIds.filter(id => id !== brand.id)
                                                        } else {
                                                            newIds = [...selectedIds, brand.id]
                                                        }
                                                        applyFilter('brand', newIds.length > 0 ? newIds.join(',') : null)
                                                    }}
                                                    className="h-3.5 w-3.5 border-slate-500 bg-slate-700"
                                                />
                                                <span className={`text-sm transition-colors ${isSelected ? 'text-indigo-400 font-medium' : 'text-slate-400 group-hover:text-slate-200'}`}>
                                                    {brand.name}
                                                </span>
                                            </label>
                                        )
                                    })
                                })()}

                                {filteredBrands.length === 0 && (
                                    <p className="text-xs text-slate-500 py-2">Бренды не найдены</p>
                                )}
                            </div>
                            </ScrollArea>
                        </div>
                    </div>

                    <div className="mt-8 pt-6">
                        <Separator className="mb-6 bg-slate-700" />
                        <div className="flex items-center justify-between text-sm text-slate-400 mb-4">
                            <span>Найдено:</span>
                            <span className="font-semibold text-slate-200">{count} товаров</span>
                        </div>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={handleReset}
                            className="w-full border-slate-600 bg-slate-700 text-slate-300 hover:bg-slate-600 hover:text-white"
                        >
                            Сбросить фильтры
                        </Button>
                    </div>

                </div>
            </aside>
        </>
    )
}

export default Sidebar
