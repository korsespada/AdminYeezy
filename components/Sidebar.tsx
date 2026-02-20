'use client'

import React, { useState, useEffect } from 'react'
import { X, Filter, Search, LogOut, FileSpreadsheet } from 'lucide-react'
import Link from 'next/link'
import { type Brand, type Category, type Subcategory } from '@/lib/types'
import { useRouter, useSearchParams } from 'next/navigation'
import { logoutAction } from '@/actions/auth'

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
                        <button onClick={onClose} className="lg:hidden p-1 text-slate-400 hover:text-slate-200">
                            <X className="w-6 h-6" />
                        </button>
                    </div>

                    <div className="space-y-6">

                        {/* Search (Modern) */}
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-2">Поиск</label>
                            <div className="relative">
                                <input
                                    type="text"
                                    placeholder="Поиск..."
                                    value={searchValue}
                                    onChange={(e) => setSearchValue(e.target.value)}
                                    className="w-full pl-9 pr-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                                />
                                <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                            </div>
                        </div>

                        {/* Category Filter */}
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-2">Категория</label>
                            <select
                                value={currentCategory}
                                onChange={(e) => applyFilter('category', e.target.value || null)}
                                className="w-full rounded-lg border-slate-600 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 py-2.5 px-3 bg-slate-700 text-slate-200 border"
                            >
                                <option value="">Все категории</option>
                                {categories.map(cat => (
                                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                                ))}
                            </select>
                        </div>

                        {/* Subcategory Filter (Conditional) */}
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-2">Подкатегория</label>
                            <select
                                value={currentSubcategory}
                                onChange={(e) => applyFilter('subcategory', e.target.value || null)}
                                className="w-full rounded-lg border-slate-600 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 py-2.5 px-3 bg-slate-700 text-slate-200 border"
                            >
                                <option value="">Все подкатегории</option>
                                <option value="__none__">Без подкатегории</option>
                                {availableSubcategories.map(sub => {
                                    const isForeign = sub.category !== currentCategory
                                    const foreignCategoryName = isForeign
                                        ? categories.find(c => c.id === sub.category)?.name || 'Другое'
                                        : '';
                                    return (
                                        <option key={sub.id} value={sub.id}>
                                            {sub.name} {isForeign ? `(из: ${foreignCategoryName})` : ''}
                                        </option>
                                    )
                                })}
                            </select>
                        </div>

                        {/* Gender Filter */}
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-2">Пол</label>
                            <div className="flex flex-wrap gap-2">
                                <button
                                    onClick={() => applyFilter('gender', null)}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${!currentGender
                                        ? 'bg-indigo-600 border-indigo-500 text-white'
                                        : 'bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600'
                                        }`}
                                >
                                    Все
                                </button>
                                <button
                                    onClick={() => applyFilter('gender', 'Для мужчин')}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${currentGender === 'Для мужчин'
                                        ? 'bg-indigo-600 border-indigo-500 text-white'
                                        : 'bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600'
                                        }`}
                                >
                                    Мужчинам
                                </button>
                                <button
                                    onClick={() => applyFilter('gender', 'Для женщин')}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${currentGender === 'Для женщин'
                                        ? 'bg-indigo-600 border-indigo-500 text-white'
                                        : 'bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600'
                                        }`}
                                >
                                    Женщинам
                                </button>
                                <button
                                    onClick={() => applyFilter('gender', '__none__')}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${currentGender === '__none__'
                                        ? 'bg-indigo-600 border-indigo-500 text-white'
                                        : 'bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600'
                                        }`}
                                >
                                    Без гендера
                                </button>
                            </div>
                        </div>

                        {/* Brand Filter with Search */}
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-2">Бренды</label>
                            {/* Brand Search Input */}
                            <div className="relative mb-2">
                                <input
                                    type="text"
                                    placeholder="Поиск бренда..."
                                    value={brandSearch}
                                    onChange={(e) => setBrandSearch(e.target.value)}
                                    className="w-full pl-8 pr-3 py-1.5 bg-slate-700 border border-slate-600 rounded-lg text-xs text-slate-200 placeholder-slate-500 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                                />
                                <Search className="w-3 h-3 text-slate-500 absolute left-3 top-2" />
                            </div>

                            {/* Brand List */}
                            <div className="space-y-0.5 max-h-60 overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-slate-600 scrollbar-track-slate-800">
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
                                                <input
                                                    type="checkbox"
                                                    checked={isSelected}
                                                    onChange={() => {
                                                        let newIds: string[]
                                                        if (isSelected) {
                                                            newIds = selectedIds.filter(id => id !== brand.id)
                                                        } else {
                                                            newIds = [...selectedIds, brand.id]
                                                        }
                                                        applyFilter('brand', newIds.length > 0 ? newIds.join(',') : null)
                                                    }}
                                                    className="w-3.5 h-3.5 text-indigo-500 border-slate-500 bg-slate-700 focus:ring-indigo-500 focus:ring-offset-slate-800 rounded"
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
                        </div>
                    </div>

                    <div className="mt-8 pt-6 border-t border-slate-700">
                        <div className="flex items-center justify-between text-sm text-slate-400 mb-4">
                            <span>Найдено:</span>
                            <span className="font-semibold text-slate-200">{count} товаров</span>
                        </div>
                        <button
                            onClick={handleReset}
                            className="w-full py-2 px-4 bg-slate-700 border border-slate-600 text-slate-300 rounded-lg hover:bg-slate-600 hover:text-white transition-colors text-sm font-medium"
                        >
                            Сбросить фильтры
                        </button>
                    </div>

                </div>
            </aside>
        </>
    )
}

export default Sidebar
