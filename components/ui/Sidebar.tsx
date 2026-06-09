'use client'

import React, { useCallback, useState, useEffect, useMemo } from 'react'
import { X, Filter, Search, RotateCcw } from 'lucide-react'
import { type Brand, type Category, type ProductFilterFacets, type Subcategory } from '@/lib/types'
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
    filterFacets?: ProductFilterFacets
    isOpen: boolean
    onClose: () => void
    count: number
}

const Sidebar: React.FC<SidebarProps> = ({ brands, categories, subcategories, filterFacets, isOpen, onClose, count }) => {
    const router = useRouter()
    const searchParams = useSearchParams()
    const [brandSearch, setBrandSearch] = useState('')
    const [searchValue, setSearchValue] = useState(searchParams.get('search') || '')

    const currentBrand = searchParams.get('brand') || ''
    const currentCategory = searchParams.get('category') || ''
    const currentSubcategory = searchParams.get('subcategory') || ''
    const currentGender = searchParams.get('gender') || ''
    const currentSearch = searchParams.get('search') || ''
    const hasActiveFilters = Boolean(currentBrand || currentCategory || currentSubcategory || currentGender || currentSearch)

    const applyFilter = useCallback((key: string, value: string | null) => {
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
    }, [router, searchParams])

    // Debounce search
    useEffect(() => {
        const timer = setTimeout(() => {
            if (searchValue !== currentSearch) {
                applyFilter('search', searchValue || null)
            }
        }, 500)
        return () => clearTimeout(timer)
    }, [applyFilter, currentSearch, searchValue])

    // Update local search value when URL changes (e.g. on reset)
    useEffect(() => {
        setSearchValue(currentSearch)
    }, [currentSearch])

    const handleReset = () => {
        setSearchValue('')
        const params = new URLSearchParams()
        const perPage = searchParams.get('perPage')
        if (perPage) params.set('perPage', perPage)
        router.push(params.size > 0 ? `/admin?${params.toString()}` : '/admin')
    }

    const facetState = useMemo(() => {
        const mapSlugFacetCounts = <T extends { id: string; slug?: string }>(items: T[], facets = [] as { slug: string; count: number }[]) => {
            const bySlugOrId = new Map<string, string>()
            items.forEach(item => {
                bySlugOrId.set(item.id, item.id)
                if (item.slug) bySlugOrId.set(item.slug, item.id)
            })
            const counts = new Map<string, number>()

            facets.forEach(facet => {
                const id = bySlugOrId.get(facet.slug)
                if (id) counts.set(id, Number(facet.count || 0))
            })

            return counts
        }

        const brandCounts = mapSlugFacetCounts(brands, filterFacets?.brandFacets)
        const categoryCounts = mapSlugFacetCounts(categories, filterFacets?.categoryFacets)
        const subcategoryCounts = mapSlugFacetCounts(subcategories, filterFacets?.subcategoryFacets)
        const categoryOptionCounts = new Map(categoryCounts)

        subcategories.forEach(subcategory => {
            const count = subcategoryCounts.get(subcategory.id) || 0
            if (count > 0) {
                categoryOptionCounts.set(subcategory.category, (categoryOptionCounts.get(subcategory.category) || 0) + count)
            }
        })

        return {
            brandCounts,
            categoryCounts: categoryOptionCounts,
            subcategoryCounts,
        }
    }, [brands, categories, subcategories, filterFacets])

    const isFacetAvailable = (counts: Map<string, number>, id: string, selectedId = '') => {
        if (!filterFacets) return true
        return selectedId === id || (counts.get(id) || 0) > 0
    }

    const availableCategories = categories.filter(category =>
        isFacetAvailable(facetState.categoryCounts, category.id, currentCategory)
    )

    const availableSubcategories = currentCategory
        ? subcategories
            .filter(sub => sub.category === currentCategory)
            .filter(sub => isFacetAvailable(facetState.subcategoryCounts, sub.id, currentSubcategory))
        : []

    const genderFacetValue = (value: string) => {
        if (value === 'Для мужчин') return 'male'
        if (value === 'Для женщин') return 'female'
        if (value === 'Унисекс') return 'unisex'
        return value
    }

    const genderCount = (value: string) => {
        if (!filterFacets) return undefined
        const item = filterFacets.genderFacets.find(facet => facet.value === genderFacetValue(value))
        return item ? Number(item.count || 0) : 0
    }

    const noGenderCount = useMemo(() => {
        if (!filterFacets) return undefined
        const missingFacet = filterFacets.genderFacets.find(facet => {
            const value = String(facet.value ?? '').toLowerCase()
            return value === '' || value === '__none__' || value === 'missing' || value === 'none' || value === 'null'
        })
        return missingFacet ? Number(missingFacet.count || 0) : undefined
    }, [filterFacets])

    const genderAvailable = (value: string) => {
        const count = value === '__none__' ? noGenderCount : genderCount(value)
        return currentGender === value || count === undefined || count > 0
    }

    // Filter brands by search
    const filteredBrands = brandSearch
        ? brands
            .filter(brand => isFacetAvailable(facetState.brandCounts, brand.id, currentBrand))
            .filter(b => b.name.toLowerCase().includes(brandSearch.toLowerCase()))
        : brands.filter(brand => isFacetAvailable(facetState.brandCounts, brand.id, currentBrand))

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
                    <div className="mb-8 flex items-start justify-between gap-4">
                        <div>
                            <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
                                <Filter className="w-5 h-5 text-indigo-400" />
                                Фильтры
                            </h2>
                            <div className="mt-2 text-sm text-slate-400">
                                <span className="font-semibold text-slate-200">{count}</span> товаров
                            </div>
                        </div>
                        {hasActiveFilters && (
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={handleReset}
                                className="shrink-0 border-slate-600 bg-slate-700 text-slate-300 hover:bg-slate-600 hover:text-white"
                            >
                                <RotateCcw className="w-4 h-4" />
                                <span>Сбросить фильтры</span>
                            </Button>
                        )}
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
                                {availableCategories.map(cat => (
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
                                disabled={!currentCategory}
                            >
                                <SelectTrigger className="bg-slate-700 text-slate-200">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                <SelectItem value="__all__">Все подкатегории</SelectItem>
                                <SelectItem value="__none__">Без подкатегории</SelectItem>
                                {availableSubcategories.map(sub => (
                                    <SelectItem key={sub.id} value={sub.id}>
                                        {sub.name}
                                    </SelectItem>
                                ))}
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
                                {[
                                    { value: 'Для мужчин', label: 'Мужчинам' },
                                    { value: 'Для женщин', label: 'Женщинам' },
                                    { value: 'Унисекс', label: 'Унисекс' },
                                    { value: '__none__', label: 'Без гендера' },
                                ].map(option => (
                                    <Button
                                        key={option.value}
                                        type="button"
                                        size="sm"
                                        variant={currentGender === option.value ? 'default' : 'outline'}
                                        onClick={() => applyFilter('gender', option.value)}
                                        disabled={!genderAvailable(option.value)}
                                        className={currentGender === option.value ? '' : 'border-slate-600 bg-slate-700 text-slate-300 hover:bg-slate-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-40'}
                                    >
                                        {option.label}
                                    </Button>
                                ))}
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
                                    const selectedId = currentBrand

                                    // 1. Sort brands: selected first, then by name
                                    const sortedBrands = [...filteredBrands].sort((a, b) => {
                                        const aSelected = selectedId === a.id
                                        const bSelected = selectedId === b.id
                                        if (aSelected && !bSelected) return -1
                                        if (!aSelected && bSelected) return 1
                                        return a.name.localeCompare(b.name)
                                    })

                                    return sortedBrands.map(brand => {
                                        const isSelected = selectedId === brand.id
                                        return (
                                            <label key={brand.id} className={`flex items-center gap-2 cursor-pointer group py-1 px-1.5 rounded-md transition-colors ${isSelected ? 'bg-indigo-500/10' : 'hover:bg-slate-700/50'}`}>
                                                <Checkbox
                                                    checked={isSelected}
                                                    onCheckedChange={() => {
                                                        applyFilter('brand', isSelected ? null : brand.id)
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
