'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import { type Brand } from '@/lib/types'
import { X, Check, ChevronDown } from 'lucide-react'

interface BrandSelectProps {
    brands: Brand[]
    selectedBrandIds: string[]
    onChange: (ids: string[]) => void
    disabled?: boolean
}

export default function BrandSelect({ brands, selectedBrandIds, onChange, disabled }: BrandSelectProps) {
    const [searchTerm, setSearchTerm] = useState('')
    const [isOpen, setIsOpen] = useState(false)
    const wrapperRef = useRef<HTMLDivElement>(null)

    // Filter brands based on search term
    const filteredBrands = useMemo(() => {
        if (!searchTerm) return brands
        const term = searchTerm.toLowerCase()
        return brands.filter(b => b.name.toLowerCase().includes(term))
    }, [brands, searchTerm])

    // Handle click outside to close dropdown
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
                setIsOpen(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    const handleToggle = (id: string) => {
        if (selectedBrandIds.includes(id)) {
            onChange(selectedBrandIds.filter(bid => bid !== id))
        } else {
            onChange([...selectedBrandIds, id])
        }
        // Keep open to allow multiple selections
        // User can click outside to close
    }

    const removeBrand = (id: string, e: React.MouseEvent) => {
        e.stopPropagation()
        onChange(selectedBrandIds.filter(bid => bid !== id))
    }

    const selectedBrands = brands.filter(b => selectedBrandIds.includes(b.id))

    return (
        <div className="relative" ref={wrapperRef}>
            <div
                className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 dark:text-white min-h-[42px] flex flex-wrap gap-2 items-center cursor-text transition-colors ${isOpen ? 'ring-2 ring-blue-500 border-blue-500' : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
                    } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                onClick={() => !disabled && setIsOpen(true)}
            >
                {selectedBrands.map(brand => (
                    <span
                        key={brand.id}
                        className="flex items-center gap-1 bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-200 text-xs px-2 py-1 rounded-full border border-blue-200 dark:border-blue-800"
                    >
                        {brand.name}
                        <button
                            type="button"
                            onClick={(e) => removeBrand(brand.id, e)}
                            className="hover:text-blue-600 dark:hover:text-blue-100 rounded-full p-0.5 hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors"
                            disabled={disabled}
                        >
                            <X size={12} />
                        </button>
                    </span>
                ))}

                <div className="flex-1 flex items-center min-w-[120px]">
                    <input
                        type="text"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        onFocus={() => setIsOpen(true)}
                        placeholder={selectedBrands.length === 0 ? "Выберите бренды..." : ""}
                        className="bg-transparent outline-none w-full text-sm text-gray-900 dark:text-white placeholder:text-gray-400"
                        disabled={disabled}
                    />
                </div>

                <ChevronDown size={16} className={`text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </div>

            {isOpen && !disabled && (
                <div className="absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl max-h-60 overflow-y-auto animate-in fade-in zoom-in-95 duration-100">
                    {filteredBrands.length === 0 ? (
                        <div className="p-3 text-sm text-gray-500 text-center">Бренды не найдены по запросу "{searchTerm}"</div>
                    ) : (
                        <div className="py-1">
                            {filteredBrands.map(brand => {
                                const isSelected = selectedBrandIds.includes(brand.id)
                                return (
                                    <div
                                        key={brand.id}
                                        onClick={() => handleToggle(brand.id)}
                                        className={`px-3 py-2 text-sm cursor-pointer flex items-center justify-between group transition-colors ${isSelected
                                            ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                                            : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
                                            }`}
                                    >
                                        <span>{brand.name}</span>
                                        {isSelected && (
                                            <Check size={16} className="text-blue-600 dark:text-blue-400" />
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
