'use client'

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { Upload, FileSpreadsheet, Trash2, Send, CheckCircle, AlertTriangle, ArrowLeft, X, Edit3, Save, HardDrive, RefreshCw, FolderOpen, Filter } from 'lucide-react'
import { pushCsvProductsAction, fetchLookupsAction, readLocalCsvAction, saveLocalCsvAction, type CsvProduct, type Lookups } from '@/actions/csv-import'
import Image from 'next/image'
import Link from 'next/link'

const IMG_SUFFIX = '?imageMogr2/auto-orient/thumbnail/!320x320r/quality/100/format/jpg'

// ─── CSV Parsing ───────────────────────────────────────────────────────

function detectDelimiter(headerLine: string): string {
    let semis = 0, commas = 0, inQuotes = false
    for (const char of headerLine) {
        if (char === '"') inQuotes = !inQuotes
        else if (!inQuotes) {
            if (char === ';') semis++
            if (char === ',') commas++
        }
    }
    return semis > commas ? ';' : ','
}

function parseCsvLine(line: string, delimiter: string): string[] {
    const result: string[] = []
    let current = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
        const char = line[i]
        if (char === '"') {
            if (inQuotes && i + 1 < line.length && line[i + 1] === '"') { current += '"'; i++ }
            else inQuotes = !inQuotes
        } else if (char === delimiter && !inQuotes) {
            result.push(current.trim()); current = ''
        } else { current += char }
    }
    result.push(current.trim())
    return result
}

function parseCsv(text: string): { products: CsvProduct[], columns: { name: string, key: string }[] } {
    const lines = text.split(/\r?\n/).filter(l => l.trim())
    if (lines.length < 2) return { products: [], columns: [] }
    const delimiter = detectDelimiter(lines[0])

    const originalHeaders = parseCsvLine(lines[0], delimiter).map(h => h.trim())
    const lowerHeaders = originalHeaders.map(h => h.toLowerCase())

    // Map headers to internal keys
    const columns = originalHeaders.map((h, i) => {
        const lower = lowerHeaders[i]
        let key = lower
        if (['productid', 'product_id', 'id'].includes(lower)) key = 'productId'
        else if (['name', 'title'].includes(lower)) key = 'name'
        else if (['description', 'desc'].includes(lower)) key = 'description'
        else if (['price'].includes(lower)) key = 'price'
        else if (['status'].includes(lower)) key = 'status'
        else if (['brand'].includes(lower)) key = 'brand'
        else if (['category'].includes(lower)) key = 'category'
        else if (['subcategory'].includes(lower)) key = 'subcategory'
        else if (['photos', 'images'].includes(lower)) key = 'photos'
        return { name: h, key }
    })

    const products = lines.slice(1).map(line => {
        const values = parseCsvLine(line, delimiter)
        const product: any = {}

        columns.forEach((col, i) => {
            const val = values[i] || ''
            if (col.key === 'photos') {
                let photos: string[] = []
                if (val) {
                    if (val.startsWith('[')) {
                        try { photos = JSON.parse(val) } catch { photos = val.split(',').map(s => s.trim()).filter(Boolean) }
                    } else {
                        photos = val.split(delimiter === ';' ? ',' : ';').map(s => s.trim()).filter(Boolean)
                    }
                }
                product[col.key] = photos
            } else if (col.key === 'price') {
                product[col.key] = parseFloat(val || '0') || 0
            } else if (col.key === 'status') {
                product[col.key] = (val === 'inactive' ? 'inactive' : 'active')
            } else {
                product[col.key] = val
            }
        })

        // Ensure required fields exist
        if (!product.productId) product.productId = ''
        if (!product.name) product.name = ''
        if (!product.price) product.price = 0
        if (!product.status) product.status = 'active'
        if (!product.brand) product.brand = ''
        if (!product.category) product.category = ''
        if (!product.subcategory) product.subcategory = ''
        if (!product.photos) product.photos = []
        if (!product.description) product.description = ''

        return product as CsvProduct
    }).filter(p => p.productId || p.name)

    return { products, columns }
}

function resolveName(id: string, items: { id: string; name: string }[]): string {
    if (!id) return ''
    const found = items.find(i => i.id === id)
    return found ? found.name : id
}

// ─── Main Page ─────────────────────────────────────────────────────────

export default function CsvImportPage() {
    const [products, setProducts] = useState<CsvProduct[]>([])
    const [columns, setColumns] = useState<{ name: string, key: string }[]>([])
    const [fileName, setFileName] = useState('')
    const [isPushing, setIsPushing] = useState(false)
    const [result, setResult] = useState<{ success: number; failed: number; errors: string[] } | null>(null)
    const [lookups, setLookups] = useState<Lookups | null>(null)
    const [selectedIdx, setSelectedIdx] = useState<number | null>(null)

    // Local file mode
    const [importMode, setImportMode] = useState<'upload' | 'local'>('upload')
    const [localPath, setLocalPath] = useState('')
    const [isLoadingPath, setIsLoadingPath] = useState(false)
    const [pathError, setPathError] = useState('')

    // Dirty flag — были ли изменения с момента последнего сохранения
    const [isDirty, setIsDirty] = useState(false)
    const [isSaving, setIsSaving] = useState(false)
    const [saveMsg, setSaveMsg] = useState<string | null>(null)

    // Filters
    const [filterBrand, setFilterBrand] = useState('')
    const [filterCategory, setFilterCategory] = useState('')
    const [filterSubcategory, setFilterSubcategory] = useState('')

    const fileInputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        fetchLookupsAction().then(setLookups).catch(console.error)
        const savedPath = localStorage.getItem('csv_local_path')
        if (savedPath) setLocalPath(savedPath)
        const savedMode = localStorage.getItem('csv_import_mode')
        if (savedMode === 'local') setImportMode('local')
    }, [])

    // Unique values for filters (derived from all products)
    const uniqueBrands = useMemo(() => [...new Set(products.map(p => p.brand).filter(Boolean))], [products])
    const uniqueCategories = useMemo(() => [...new Set(products.map(p => p.category).filter(Boolean))], [products])
    const uniqueSubcategories = useMemo(() => [...new Set(products.map(p => p.subcategory).filter(Boolean))], [products])

    // Filtered products for display
    const filteredProducts = useMemo(() => {
        return products.filter(p => {
            if (filterBrand && p.brand !== filterBrand) return false
            if (filterCategory && p.category !== filterCategory) return false
            if (filterSubcategory && p.subcategory !== filterSubcategory) return false
            return true
        })
    }, [products, filterBrand, filterCategory, filterSubcategory])

    const handleModeChange = (mode: 'upload' | 'local') => {
        setImportMode(mode)
        localStorage.setItem('csv_import_mode', mode)
        setProducts([]); setColumns([]); setResult(null); setFileName(''); setIsDirty(false); setSaveMsg(null)
        setFilterBrand(''); setFilterCategory(''); setFilterSubcategory('')
    }

    // ─── Upload Mode ──────────────────────────────────────────────────
    const handleFile = useCallback((file: File) => {
        if (!file.name.endsWith('.csv')) { alert('Пожалуйста, загрузите файл CSV'); return }
        setFileName(file.name); setResult(null); setIsDirty(false); setSaveMsg(null)
        const reader = new FileReader()
        reader.onload = (e) => {
            const { products, columns } = parseCsv(e.target?.result as string)
            setProducts(products)
            setColumns(columns)
        }
        reader.readAsText(file, 'utf-8')
    }, [])

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        if (importMode !== 'upload') return
        if (e.dataTransfer.files?.[0]) handleFile(e.dataTransfer.files[0])
    }, [handleFile, importMode])

    // ─── Local File Mode ──────────────────────────────────────────────
    const loadFromPath = async () => {
        if (!localPath.trim()) return
        setIsLoadingPath(true); setPathError(''); setResult(null); setSaveMsg(null); setIsDirty(false)
        const res = await readLocalCsvAction(localPath)
        if (res.success && res.content) {
            const { products, columns } = parseCsv(res.content)
            setProducts(products)
            setColumns(columns)
            setFileName(localPath.split(/[/\\]/).pop() || 'local.csv')
            localStorage.setItem('csv_local_path', localPath)
        } else {
            setPathError(res.error || 'Не удалось прочитать файл')
        }
        setIsLoadingPath(false)
    }

    // ─── Кнопка «Сохранить в файл» ───────────────────────────────────
    const handleSaveToFile = async () => {
        if (!localPath || products.length === 0) return
        setIsSaving(true); setSaveMsg(null)
        try {
            const res = await saveLocalCsvAction(localPath, products, columns)
            if (res.success) {
                setIsDirty(false)
                setSaveMsg('✓ Файл сохранён')
                setTimeout(() => setSaveMsg(null), 3000)
            } else {
                setSaveMsg('✗ Ошибка: ' + (res.error || 'unknown'))
            }
        } catch (e: any) {
            setSaveMsg('✗ ' + e.message)
        }
        setIsSaving(false)
    }

    // ─── Data Handlers ────────────────────────────────────────────────
    const handlePush = async () => {
        if (products.length === 0) return
        setIsPushing(true); setResult(null)
        try {
            const res = await pushCsvProductsAction(products)
            if (res.success && res.data) setResult(res.data)
            else setResult({ success: 0, failed: products.length, errors: [res.error || 'Unknown error'] })
        } catch {
            setResult({ success: 0, failed: products.length, errors: ['Network error'] })
        }
        setIsPushing(false)
    }

    const updateProduct = useCallback((index: number, field: keyof CsvProduct, value: any) => {
        setProducts(prev => prev.map((p, i) => i === index ? { ...p, [field]: value } : p))
        setIsDirty(true)
    }, [])

    const handleRemove = useCallback((index: number) => {
        setProducts(prev => prev.filter((_, i) => i !== index))
        setIsDirty(true)
        setSelectedIdx(prev => {
            if (prev === index) return null
            if (prev !== null && prev > index) return prev - 1
            return prev
        })
    }, [])

    const handleClear = () => {
        setProducts([]); setFileName(''); setResult(null); setSelectedIdx(null); setIsDirty(false); setSaveMsg(null)
        if (fileInputRef.current) fileInputRef.current.value = ''
    }

    // ─── Render ───────────────────────────────────────────────────────
    return (
        <div className="min-h-screen bg-slate-900 text-slate-200 font-sans">
            {/* Header */}
            <div className="bg-slate-800/80 backdrop-blur-sm border-b border-slate-700 sticky top-0 z-30 shadow-lg">
                <div className="max-w-7xl mx-auto px-6 py-4 flex flex-col md:flex-row items-center justify-between gap-4">
                    <div className="flex items-center gap-4 w-full md:w-auto">
                        <Link href="/admin" className="p-2 rounded-lg hover:bg-slate-700 transition-colors text-slate-400 hover:text-white">
                            <ArrowLeft className="w-5 h-5" />
                        </Link>
                        <div>
                            <h1 className="text-xl font-bold text-white flex items-center gap-2">
                                <FileSpreadsheet className="w-5 h-5 text-emerald-400" />
                                Импорт CSV
                            </h1>
                            <div className="flex items-center gap-4 mt-1">
                                <button onClick={() => handleModeChange('upload')}
                                    className={`text-xs px-2 py-0.5 rounded transition-colors ${importMode === 'upload' ? 'bg-emerald-500/20 text-emerald-400' : 'text-slate-500 hover:text-slate-300'}`}>
                                    Загрузка файла
                                </button>
                                <button onClick={() => handleModeChange('local')}
                                    className={`text-xs px-2 py-0.5 rounded transition-colors ${importMode === 'local' ? 'bg-indigo-500/20 text-indigo-400' : 'text-slate-500 hover:text-slate-300'}`}>
                                    Локальный файл
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-3 w-full md:w-auto justify-end flex-wrap">
                        {/* Save message */}
                        {saveMsg && (
                            <span className={`text-xs px-3 py-1 rounded-full ${saveMsg.startsWith('✓') ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                                {saveMsg}
                            </span>
                        )}

                        {products.length > 0 && (
                            <div className="flex items-center gap-3">
                                <span className="text-sm text-slate-400 hidden sm:inline">
                                    <span className="font-semibold text-white">{products.length}</span> товаров
                                </span>

                                {/* Кнопка Сохранить — только в режиме local и если есть изменения */}
                                {importMode === 'local' && (
                                    <button onClick={handleSaveToFile} disabled={isSaving || !isDirty}
                                        className={`px-5 py-2 text-sm font-medium rounded-lg transition-all flex items-center gap-2 ${isDirty
                                            ? 'bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white shadow-lg shadow-amber-500/20'
                                            : 'bg-slate-700 text-slate-500 cursor-not-allowed'
                                            }`}>
                                        <Save className="w-4 h-4" />
                                        {isSaving ? 'Сохраняю...' : isDirty ? 'Сохранить в файл' : 'Нет изменений'}
                                    </button>
                                )}

                                <button onClick={handleClear} className="px-4 py-2 text-sm bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors">
                                    Очистить
                                </button>
                                <button onClick={handlePush} disabled={isPushing}
                                    className="px-6 py-2.5 text-sm font-medium bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-white rounded-lg transition-all shadow-lg flex items-center gap-2 disabled:opacity-50">
                                    {isPushing ? 'Загружаю...' : <><Send className="w-4 h-4" /> Запушить в БД</>}
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-6 py-8">
                {/* Input Area */}
                {products.length === 0 && (
                    <div className="max-w-2xl mx-auto mb-10">
                        {importMode === 'upload' ? (
                            <div onDrop={handleDrop} onDragOver={(e) => e.preventDefault()}
                                onClick={() => fileInputRef.current?.click()}
                                className="border-2 border-dashed border-slate-600 hover:border-emerald-500 hover:bg-slate-800/50 rounded-2xl p-12 text-center cursor-pointer transition-all group">
                                <input ref={fileInputRef} type="file" accept=".csv" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} className="hidden" />
                                <div className="w-16 h-16 mx-auto mb-4 bg-slate-800 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform">
                                    <Upload className="w-8 h-8 text-slate-400 group-hover:text-emerald-400 transition-colors" />
                                </div>
                                <h3 className="text-lg font-semibold text-white mb-2">Загрузить CSV файл</h3>
                                <p className="text-sm text-slate-400">Перетащите файл сюда или нажмите для выбора</p>
                            </div>
                        ) : (
                            <div className="bg-slate-800 rounded-2xl p-8 border border-slate-700 shadow-xl">
                                <div className="flex items-center gap-3 mb-6">
                                    <div className="p-3 bg-indigo-500/10 rounded-xl"><HardDrive className="w-6 h-6 text-indigo-400" /></div>
                                    <div>
                                        <h3 className="text-lg font-bold text-white">Локальный файл</h3>
                                        <p className="text-sm text-slate-400">Откройте CSV файл, отредактируйте и сохраните</p>
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-slate-500 mb-2 uppercase tracking-wider">Путь к CSV файлу</label>
                                    <div className="flex gap-2">
                                        <div className="relative flex-1">
                                            <FolderOpen className="absolute left-3 top-2.5 w-5 h-5 text-slate-500" />
                                            <input type="text" value={localPath} onChange={(e) => setLocalPath(e.target.value)}
                                                placeholder="C:\projects\data.csv"
                                                className="w-full pl-10 pr-4 py-2.5 bg-slate-900 border border-slate-600 rounded-xl text-white focus:border-indigo-500 outline-none transition-all font-mono text-sm"
                                                onKeyDown={(e) => e.key === 'Enter' && loadFromPath()} />
                                        </div>
                                        <button onClick={loadFromPath} disabled={isLoadingPath || !localPath}
                                            className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-medium transition-colors disabled:opacity-50 flex items-center gap-2">
                                            {isLoadingPath ? <RefreshCw className="w-4 h-4 animate-spin" /> : 'Открыть'}
                                        </button>
                                    </div>
                                    {pathError && <p className="mt-2 text-sm text-red-400 flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> {pathError}</p>}
                                    <p className="mt-3 text-xs text-slate-500">Редактируйте данные, затем нажмите кнопку «Сохранить в файл» в шапке.</p>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Result */}
                {result && (
                    <div className={`mb-6 p-4 rounded-xl border ${result.failed === 0 ? 'bg-emerald-900/30 border-emerald-700' : result.success === 0 ? 'bg-red-900/30 border-red-700' : 'bg-amber-900/30 border-amber-700'}`}>
                        <div className="flex items-center gap-3 mb-2">
                            {result.failed === 0 ? <CheckCircle className="w-5 h-5 text-emerald-400" /> : <AlertTriangle className="w-5 h-5 text-amber-400" />}
                            <span className="font-semibold">Успешно: {result.success} | Ошибки: {result.failed}</span>
                        </div>
                        {result.errors.length > 0 && (
                            <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                                {result.errors.map((err, i) => <div key={i} className="text-sm text-red-300 font-mono">• {err}</div>)}
                            </div>
                        )}
                    </div>
                )}

                {/* File Info Bar */}
                {products.length > 0 && fileName && (
                    <div className="mb-6 flex items-center justify-between p-3 bg-slate-800 rounded-xl border border-slate-700">
                        <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-lg ${importMode === 'local' ? 'bg-indigo-500/10 text-indigo-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
                                {importMode === 'local' ? <HardDrive className="w-4 h-4" /> : <FileSpreadsheet className="w-4 h-4" />}
                            </div>
                            <div>
                                <h4 className="text-sm font-medium text-white">{fileName}</h4>
                                <p className="text-xs text-slate-500">{importMode === 'local' ? 'Редактирование локального файла' : 'Просмотр перед импортом'}</p>
                            </div>
                        </div>
                        {importMode === 'local' && isDirty && (
                            <div className="flex items-center gap-2 px-3 py-1 bg-amber-500/10 border border-amber-500/20 rounded-full">
                                <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                                <span className="text-xs font-medium text-amber-400">Есть несохранённые изменения</span>
                            </div>
                        )}
                    </div>
                )}

                {/* Filters */}
                {products.length > 0 && (uniqueBrands.length > 1 || uniqueCategories.length > 1 || uniqueSubcategories.length > 1) && (
                    <div className="mb-6 flex flex-wrap items-center gap-3 p-4 bg-slate-800/50 rounded-xl border border-slate-700/50">
                        <div className="flex items-center gap-2 text-slate-500 mr-1">
                            <Filter className="w-4 h-4" />
                            <span className="text-xs font-medium uppercase tracking-wider">Фильтры</span>
                        </div>

                        {uniqueBrands.length > 1 && (
                            <select value={filterBrand} onChange={e => setFilterBrand(e.target.value)}
                                className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white outline-none focus:border-indigo-500 transition-colors min-w-[140px]">
                                <option value="">Все бренды</option>
                                {uniqueBrands.map(id => (
                                    <option key={id} value={id}>{resolveName(id, lookups?.brands || [])}</option>
                                ))}
                            </select>
                        )}

                        {uniqueCategories.length > 1 && (
                            <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)}
                                className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white outline-none focus:border-indigo-500 transition-colors min-w-[140px]">
                                <option value="">Все категории</option>
                                {uniqueCategories.map(id => (
                                    <option key={id} value={id}>{resolveName(id, lookups?.categories || [])}</option>
                                ))}
                            </select>
                        )}

                        {uniqueSubcategories.length > 1 && (
                            <select value={filterSubcategory} onChange={e => setFilterSubcategory(e.target.value)}
                                className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white outline-none focus:border-indigo-500 transition-colors min-w-[140px]">
                                <option value="">Все подкатегории</option>
                                {uniqueSubcategories.map(id => (
                                    <option key={id} value={id}>{resolveName(id, lookups?.subcategories || [])}</option>
                                ))}
                            </select>
                        )}

                        {(filterBrand || filterCategory || filterSubcategory) && (
                            <button onClick={() => { setFilterBrand(''); setFilterCategory(''); setFilterSubcategory('') }}
                                className="text-xs text-slate-400 hover:text-white px-2 py-1 rounded hover:bg-slate-700 transition-colors">
                                Сбросить
                            </button>
                        )}

                        {(filterBrand || filterCategory || filterSubcategory) && (
                            <span className="text-xs text-slate-500 ml-auto">
                                Показано <span className="text-white font-semibold">{filteredProducts.length}</span> из {products.length}
                            </span>
                        )}
                    </div>
                )}

                {/* Grid */}
                {products.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5 pb-20">
                        {filteredProducts.map((product) => {
                            const realIndex = products.indexOf(product)
                            return (
                                <CsvProductCard key={`${product.productId}-${realIndex}`} product={product} index={realIndex} lookups={lookups}
                                    onRemove={handleRemove} onUpdate={updateProduct}
                                    onClick={() => setSelectedIdx(realIndex)} />
                            )
                        })}
                    </div>
                )}
            </div>

            {/* Drawer */}
            <CsvProductDrawer
                product={selectedIdx !== null ? products[selectedIdx] : null}
                index={selectedIdx ?? -1}
                lookups={lookups}
                isOpen={selectedIdx !== null}
                onClose={() => setSelectedIdx(null)}
                onUpdate={updateProduct} />
        </div>
    )
}

// ─── Card ──────────────────────────────────────────────────────────────

interface CsvProductCardProps {
    product: CsvProduct; index: number; lookups: Lookups | null
    onRemove: (i: number) => void
    onUpdate: (i: number, f: keyof CsvProduct, v: any) => void
    onClick: () => void
}

function CsvProductCard({ product, index, lookups, onRemove, onUpdate, onClick }: CsvProductCardProps) {
    const [editField, setEditField] = useState<'name' | 'price' | null>(null)
    const [editVal, setEditVal] = useState('')

    const brandName = lookups ? resolveName(product.brand, lookups.brands) : product.brand
    const categoryName = lookups ? resolveName(product.category, lookups.categories) : product.category

    const startEdit = (field: 'name' | 'price', e: React.MouseEvent) => {
        e.stopPropagation()
        setEditField(field)
        setEditVal(field === 'price' ? product.price.toString() : product.name)
    }

    const save = () => {
        if (editField === 'price') onUpdate(index, 'price', parseFloat(editVal) || 0)
        else if (editField) onUpdate(index, editField, editVal.trim())
        setEditField(null)
    }

    const onKey = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') save()
        else if (e.key === 'Escape') setEditField(null)
    }

    return (
        <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden hover:shadow-xl hover:shadow-black/20 hover:border-slate-600 transition-all duration-300 group flex flex-col cursor-pointer" onClick={onClick}>
            <div className="relative aspect-square overflow-hidden bg-slate-900">
                {product.photos?.[0] ? (
                    <Image src={product.photos[0] + IMG_SUFFIX} alt={product.name || ''} fill sizes="(max-width:768px) 100vw,25vw"
                        className="object-cover group-hover:scale-105 transition-transform duration-500 opacity-90 group-hover:opacity-100" unoptimized />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-600 text-xs uppercase tracking-widest">No image</div>
                )}
                <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={(e) => { e.stopPropagation(); onRemove(index) }}
                        className="p-2 bg-slate-900/80 backdrop-blur-sm rounded-full shadow-lg hover:bg-red-600 text-slate-300 hover:text-white transition-colors">
                        <Trash2 className="w-4 h-4" />
                    </button>
                </div>
                <span className="absolute top-3 left-3 px-2 py-1 text-xs font-mono bg-slate-900/80 backdrop-blur-sm rounded-md text-slate-300">#{index + 1}</span>
            </div>

            <div className="p-5 flex-1 flex flex-col">
                <div className="text-[10px] text-slate-500 font-mono mb-2">{product.productId}</div>
                <div className="mb-2 text-xs text-slate-500 truncate">
                    {brandName && <span className="text-indigo-400">{brandName}</span>}
                    {categoryName && <span> • {categoryName}</span>}
                </div>

                {editField === 'name' ? (
                    <input type="text" value={editVal} onChange={e => setEditVal(e.target.value)} onBlur={save} onKeyDown={onKey} autoFocus
                        className="text-base font-bold text-slate-100 mb-2 bg-slate-700 border border-indigo-500 rounded px-2 py-1 w-full outline-none"
                        onClick={e => e.stopPropagation()} />
                ) : (
                    <h3 className="text-base font-bold text-slate-100 mb-2 leading-tight cursor-text hover:bg-slate-700/50 rounded px-1 -mx-1"
                        onClick={e => startEdit('name', e)}>{product.name || 'Без имени'}</h3>
                )}

                {product.description && <p className="text-sm text-slate-400 mb-4 line-clamp-2 flex-1">{product.description}</p>}

                <div className="flex items-center justify-between pt-4 border-t border-slate-700 mt-auto">
                    {editField === 'price' ? (
                        <input type="number" value={editVal} onChange={e => setEditVal(e.target.value)} onBlur={save} onKeyDown={onKey} autoFocus
                            className="font-bold text-lg text-slate-200 bg-slate-700 border border-indigo-500 rounded px-2 py-1 w-24 outline-none"
                            onClick={e => e.stopPropagation()} />
                    ) : (
                        <div className="font-bold text-lg text-slate-200 cursor-text hover:bg-slate-700/50 rounded px-1 -mx-1"
                            onClick={e => startEdit('price', e)}>
                            {product.price > 0 ? new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(product.price) : '—'}
                        </div>
                    )}
                    <span className={`text-xs px-2 py-1 rounded-full ${product.status === 'active' ? 'bg-emerald-900/50 text-emerald-400' : 'bg-slate-700 text-slate-400'}`}>
                        {product.status}
                    </span>
                </div>
            </div>
        </div>
    )
}

// ─── Drawer ────────────────────────────────────────────────────────────

interface CsvProductDrawerProps {
    product: CsvProduct | null; index: number; lookups: Lookups | null
    isOpen: boolean; onClose: () => void
    onUpdate: (i: number, f: keyof CsvProduct, v: any) => void
}

function CsvProductDrawer({ product, index, lookups, isOpen, onClose, onUpdate }: CsvProductDrawerProps) {
    const [local, setLocal] = useState<CsvProduct | null>(null)
    const [dragIdx, setDragIdx] = useState<number | null>(null)

    useEffect(() => {
        setLocal(product ? { ...product } : null)
    }, [product, isOpen])

    if (!isOpen || !local) return null

    const change = (field: keyof CsvProduct, value: any) => {
        setLocal(prev => prev ? { ...prev, [field]: value } : null)
        onUpdate(index, field, value)
    }

    const removePhoto = (i: number) => change('photos', local.photos.filter((_, j) => j !== i))

    const onDragOver = (e: React.DragEvent, i: number) => {
        e.preventDefault()
        if (dragIdx === null || dragIdx === i) return
        const arr = [...local.photos]
        const dragged = arr[dragIdx]
        arr.splice(dragIdx, 1)
        arr.splice(i, 0, dragged)
        change('photos', arr)
        setDragIdx(i)
    }

    return (
        <>
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40" onClick={onClose} />
            <div className="fixed inset-y-0 right-0 z-50 w-full max-w-2xl bg-slate-900 shadow-2xl overflow-y-auto border-l border-slate-700">
                <div className="h-full flex flex-col">
                    <div className="px-6 py-4 border-b border-slate-700 flex items-center justify-between bg-slate-800 sticky top-0 z-10">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-indigo-500/10 rounded-lg"><Edit3 className="w-5 h-5 text-indigo-400" /></div>
                            <h2 className="text-lg font-semibold text-white">Редактирование #{index + 1}</h2>
                        </div>
                        <button onClick={onClose} className="p-2 text-slate-400 hover:text-white rounded-lg"><X size={20} /></button>
                    </div>

                    <div className="flex-1 p-6 space-y-8 pb-32">
                        {/* Photos */}
                        <section className="space-y-3">
                            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Фотографии ({local.photos.length})</h3>
                            {local.photos.length > 0 ? (
                                <div className="grid grid-cols-3 gap-3">
                                    {local.photos.map((url, i) => (
                                        <div key={i} draggable onDragStart={() => setDragIdx(i)} onDragOver={e => onDragOver(e, i)} onDragEnd={() => setDragIdx(null)}
                                            className={`relative aspect-square rounded-xl overflow-hidden border-2 group cursor-move transition-all ${dragIdx === i ? 'border-indigo-500 opacity-50' : 'border-slate-800 hover:border-slate-600'}`}>
                                            <Image src={url + IMG_SUFFIX} alt="" fill className="object-cover" unoptimized />
                                            <button onClick={() => removePhoto(i)}
                                                className="absolute top-1 right-1 p-1 bg-red-500 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 size={12} /></button>
                                            <div className="absolute bottom-1 right-1 px-1.5 py-0.5 bg-black/60 text-white text-[10px] rounded">{i + 1}</div>
                                        </div>
                                    ))}
                                </div>
                            ) : <div className="p-4 text-center text-slate-500 border border-dashed border-slate-700 rounded-lg">Нет фото</div>}
                        </section>

                        {/* Fields */}
                        <section className="space-y-4">
                            <div className="space-y-1">
                                <label className="text-xs text-slate-500">Название</label>
                                <input type="text" value={local.name} onChange={e => change('name', e.target.value)}
                                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white focus:border-indigo-500 outline-none" />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <label className="text-xs text-slate-500">Цена</label>
                                    <input type="number" value={local.price} onChange={e => change('price', parseFloat(e.target.value) || 0)}
                                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white focus:border-indigo-500 outline-none" />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs text-slate-500">Статус</label>
                                    <select value={local.status} onChange={e => change('status', e.target.value)}
                                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white outline-none">
                                        <option value="active">Active</option>
                                        <option value="inactive">Inactive</option>
                                    </select>
                                </div>
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs text-slate-500">Описание</label>
                                <textarea rows={5} value={local.description} onChange={e => change('description', e.target.value)}
                                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white focus:border-indigo-500 outline-none text-sm" />
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-slate-800">
                                <div className="space-y-1">
                                    <label className="text-xs text-slate-500">Brand ({resolveName(local.brand, lookups?.brands || [])})</label>
                                    <input type="text" value={local.brand} onChange={e => change('brand', e.target.value)}
                                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-300 font-mono text-sm outline-none" />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs text-slate-500">Category ({resolveName(local.category, lookups?.categories || [])})</label>
                                    <input type="text" value={local.category} onChange={e => change('category', e.target.value)}
                                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-300 font-mono text-sm outline-none" />
                                </div>
                                <div className="space-y-1 md:col-span-2">
                                    <label className="text-xs text-slate-500">Subcategory ({resolveName(local.subcategory, lookups?.subcategories || [])})</label>
                                    <input type="text" value={local.subcategory} onChange={e => change('subcategory', e.target.value)}
                                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-300 font-mono text-sm outline-none" />
                                </div>
                            </div>
                        </section>
                    </div>
                </div>
            </div>
        </>
    )
}
