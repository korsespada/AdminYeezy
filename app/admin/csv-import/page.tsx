'use client'

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { Upload, FileSpreadsheet, Trash2, Send, CheckCircle, AlertTriangle, ArrowLeft, X, Edit3, Save, HardDrive, RefreshCw, FolderOpen, Filter, Merge, CheckSquare, Square } from 'lucide-react'
import { pushCsvProductsAction, fetchLookupsAction, readLocalCsvAction, saveLocalCsvAction, type CsvProduct, type Lookups } from '@/actions/csv-import'
import Image from 'next/image'
import Link from 'next/link'

const IMG_SUFFIX = '?imageMogr2/auto-orient/thumbnail/!320x320r/quality/100/format/jpg'

// ─── CSV Parsing ───────────────────────────────────────────────────────

function parseCsv(text: string): { products: CsvProduct[], columns: { name: string, key: string }[] } {
    const rows: string[][] = []
    let currentRow: string[] = []
    let currentField = ''
    let inQuotes = false

    const normalizedText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    const delimiter = detectDelimiter(normalizedText.split('\n')[0] || '')

    for (let i = 0; i < normalizedText.length; i++) {
        const char = normalizedText[i]
        const nextChar = normalizedText[i + 1]

        if (inQuotes) {
            if (char === '"') {
                if (nextChar === '"') { // Escaped "" -> "
                    currentField += '"'
                    i++
                } else { // Closing quote
                    inQuotes = false
                }
            } else {
                currentField += char
            }
        } else {
            if (char === '"' && currentField.trim().length === 0) {
                inQuotes = true
                currentField = '' // reset to ignore leading spaces
            } else if (char === delimiter) {
                currentRow.push(currentField.trim())
                currentField = ''
            } else if (char === '\n') {
                currentRow.push(currentField.trim())
                if (currentRow.some(v => v.trim() !== '')) {
                    rows.push(currentRow)
                }
                currentRow = []
                currentField = ''
            } else {
                currentField += char
            }
        }
    }

    if (currentField !== '' || currentRow.length > 0) {
        currentRow.push(currentField.trim())
        if (currentRow.some(v => v.trim() !== '')) {
            rows.push(currentRow)
        }
    }

    if (rows.length < 1) return { products: [], columns: [] }

    const headerRow = rows[0]
    const columns = headerRow.map(h => {
        const lower = h.toLowerCase().trim()
        let key = lower
        if (['productid', 'product_id', 'id'].includes(lower)) key = 'productId'
        else if (['name', 'title'].includes(lower)) key = 'name'
        else if (['description', 'desc'].includes(lower)) key = 'description'
        else if (['price'].includes(lower)) key = 'price'
        else if (['status'].includes(lower)) key = 'status'
        else if (['brand'].includes(lower)) key = 'brand'
        else if (['category'].includes(lower)) key = 'category'
        else if (['subcategory'].includes(lower)) key = 'subcategory'
        else if (['photos', 'images', 'image_urls'].includes(lower)) key = 'photos'
        else if (['gender', 'пол'].includes(lower)) key = 'gender'
        return { name: h, key }
    })

    const products = rows.slice(1).map(values => {
        // --- Row Healer Logic ---
        // Если у нас слишком мало колонок (например, 3 вместо 10) и одна из них подозрительно длинная и содержит разделитель,
        // значит парсер "проглотил" несколько колонок в одну из-за кривых кавычек.
        if (values.length < columns.length / 2 && values.some(v => v.includes(delimiter))) {
            const healedValues: string[] = []
            for (const val of values) {
                if (val.includes(delimiter) && val.length > 50) {
                    // Рекурсивно пробуем распарсить это поле как мини-строку CSV без учета внешних кавычек
                    const subParts = val.split(delimiter)
                    healedValues.push(...subParts)
                } else {
                    healedValues.push(val)
                }
            }
            if (healedValues.length > values.length) {
                values = healedValues
            }
        }

        if (values.length === 0 || values.every(v => !v.trim())) return null

        const product: any = {}
        columns.forEach((col, i) => {
            let val = (values[i] || '').trim()

            if (col.key === 'photos') {
                let photos: string[] = []
                if (val) {
                    // Агрессивная очистка от кавычечного ада (от "" до """")
                    const cleanVal = val.replace(/"+/g, '"').replace(/^"|"$/g, '').trim()

                    if (cleanVal.startsWith('[') && cleanVal.endsWith(']')) {
                        try {
                            const parsed = JSON.parse(cleanVal)
                            photos = Array.isArray(parsed) ? parsed : [parsed]
                        } catch {
                            // Если не JSON, но в скобках
                            photos = cleanVal.slice(1, -1).split(/[|,;]/).map(s => s.trim().replace(/"/g, '')).filter(Boolean)
                        }
                    } else {
                        photos = cleanVal.split(/[||,;]/).map(s => s.trim().replace(/"/g, '')).filter(Boolean)
                    }
                }
                product[col.key] = photos
            } else if (col.key === 'price') {
                const numeric = val.replace(/[^\d.,]/g, '').replace(',', '.')
                product[col.key] = parseFloat(numeric) || 0
            } else if (col.key === 'status') {
                const low = val.toLowerCase()
                product[col.key] = (low === 'inactive' || low === '0' ? 'inactive' : 'active')
            } else {
                // Убираем двойные кавычки, если они пролезли в обычные поля
                product[col.key] = val.replace(/""/g, '"')
            }
        })

        // Ensure baseline fields are never undefined to prevent corruption on save
        product.productId = product.productId || ''
        product.name = product.name || ''
        product.price = product.price || 0
        product.status = product.status || 'active'
        product.photos = product.photos || []

        // Final sanity check
        if (!product.productId && !product.name) return null

        return product as CsvProduct
    }).filter((p): p is CsvProduct => p !== null)

    return { products, columns }
}

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
    const [pushProgress, setPushProgress] = useState<{ current: number; total: number } | null>(null)
    const [lookups, setLookups] = useState<Lookups | null>(null)
    const [selectedIdx, setSelectedIdx] = useState<number | null>(null)
    const [selectedForMerge, setSelectedForMerge] = useState<number[]>([]) // Список индексов в порядке выбора
    const [previousProducts, setPreviousProducts] = useState<CsvProduct[] | null>(null) // Для отмены объединения

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
    const [filterGender, setFilterGender] = useState('')

    const fileInputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        fetchLookupsAction().then(setLookups).catch(console.error)
        const savedPath = localStorage.getItem('csv_local_path')
        if (savedPath) setLocalPath(savedPath)
        const savedMode = localStorage.getItem('csv_import_mode')
        if (savedMode === 'local') setImportMode('local')
    }, [])

    // Unique values for filters (derived from all products)
    const uniqueBrands = useMemo(() => {
        const brands = [...new Set(products.map(p => p.brand).filter(Boolean))]
        if (products.some(p => !p.brand)) brands.push('__EMPTY__')
        return brands
    }, [products])

    const uniqueCategories = useMemo(() => {
        const cats = [...new Set(products.map(p => p.category).filter(Boolean))]
        if (products.some(p => !p.category)) cats.push('__EMPTY__')
        return cats
    }, [products])

    const uniqueSubcategories = useMemo(() => {
        const subcats = [...new Set(products.map(p => p.subcategory).filter(Boolean))]
        if (products.some(p => !p.subcategory)) subcats.push('__EMPTY__')
        return subcats
    }, [products])

    const uniqueGenders = useMemo(() => {
        const genders = [...new Set(products.map(p => p.gender).filter(Boolean))]
        if (products.some(p => !p.gender)) genders.push('__EMPTY__')
        return genders
    }, [products])

    // Filtered products for display
    const filteredProducts = useMemo(() => {
        return products.filter(p => {
            if (filterBrand) {
                if (filterBrand === '__EMPTY__') {
                    if (p.brand) return false
                } else if (p.brand !== filterBrand) {
                    return false
                }
            }
            if (filterCategory) {
                if (filterCategory === '__EMPTY__') {
                    if (p.category) return false
                } else if (p.category !== filterCategory) {
                    return false
                }
            }
            if (filterSubcategory) {
                if (filterSubcategory === '__EMPTY__') {
                    if (p.subcategory) return false
                } else if (p.subcategory !== filterSubcategory) {
                    return false
                }
            }
            if (filterGender) {
                if (filterGender === '__EMPTY__') {
                    if (p.gender) return false
                } else if (p.gender !== filterGender) {
                    return false
                }
            }
            return true
        })
    }, [products, filterBrand, filterCategory, filterSubcategory, filterGender])

    const handleModeChange = (mode: 'upload' | 'local') => {
        setImportMode(mode)
        localStorage.setItem('csv_import_mode', mode)
        setProducts([]); setColumns([]); setResult(null); setFileName(''); setIsDirty(false); setSaveMsg(null)
        setFilterBrand(''); setFilterCategory(''); setFilterSubcategory(''); setFilterGender('')
        setSelectedForMerge([]); setPreviousProducts(null)
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
        setIsPushing(true); setResult(null); setPushProgress({ current: 0, total: products.length })

        const CHUNK_SIZE = 20
        const total = products.length
        const errors: string[] = []
        let success = 0
        let failed = 0

        try {
            for (let i = 0; i < total; i += CHUNK_SIZE) {
                const chunk = products.slice(i, i + CHUNK_SIZE)
                setPushProgress({ current: i, total })

                const res = await pushCsvProductsAction(chunk)
                if (res.success && res.data) {
                    success += res.data.success
                    failed += res.data.failed
                    errors.push(...res.data.errors)
                } else {
                    failed += chunk.length
                    errors.push(res.error || 'Server error on chunk ' + (i / CHUNK_SIZE + 1))
                }
            }
            setResult({ success, failed, errors })
        } catch (e: any) {
            setResult({ success, failed, errors: [...errors, 'Network or unexpected error: ' + e.message] })
        }

        setPushProgress(null)
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
        setFilterBrand(''); setFilterCategory(''); setFilterSubcategory(''); setFilterGender('')
        setSelectedForMerge([]); setPreviousProducts(null)
        if (fileInputRef.current) fileInputRef.current.value = ''
    }

    const toggleMergeSelection = useCallback((index: number) => {
        setSelectedForMerge(prev => {
            if (prev.includes(index)) return prev.filter(i => i !== index)
            return [...prev, index]
        })
    }, [])

    const handleMergePhotos = () => {
        if (selectedForMerge.length < 2) return

        // Сохраняем состояние для отмены
        setPreviousProducts([...products])

        const targetIdx = selectedForMerge[0]
        const sourceIndices = selectedForMerge.slice(1)

        // Собираем все фото по порядку выбора
        const allPhotos: string[] = []
        selectedForMerge.forEach(idx => {
            products[idx].photos.forEach(url => {
                if (!allPhotos.includes(url)) allPhotos.push(url)
            })
        })

        setProducts(prev => {
            const next = [...prev]
            // Обновляем первый выбранный товар новыми фото
            next[targetIdx] = { ...next[targetIdx], photos: allPhotos }

            // Удаляем остальные товары (сортируем индексы в обратном порядке, чтобы не сбить порядок при удалении)
            const sortedIndicesToRemove = [...sourceIndices].sort((a, b) => b - a)
            sortedIndicesToRemove.forEach(idx => {
                next.splice(idx, 1)
            })
            return next
        })

        setSelectedForMerge([])
        setIsDirty(true)
    }

    const handleUndoMerge = () => {
        if (previousProducts) {
            setProducts(previousProducts)
            setPreviousProducts(null)
            setIsDirty(true)
        }
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

                                {previousProducts && (
                                    <button onClick={handleUndoMerge}
                                        className="px-4 py-2 text-sm font-medium bg-slate-800 hover:bg-slate-700 text-amber-400 border border-amber-500/30 rounded-lg transition-all flex items-center gap-2">
                                        <RefreshCw className="w-4 h-4" />
                                        Отменить объединение
                                    </button>
                                )}

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
                                    {isPushing ? (
                                        <>
                                            <RefreshCw className="w-4 h-4 animate-spin" />
                                            {pushProgress ? `Загружаю ${pushProgress.current}/${pushProgress.total}...` : 'Загружаю...'}
                                        </>
                                    ) : (
                                        <>
                                            <Send className="w-4 h-4" />
                                            Запушить в БД
                                        </>
                                    )}
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
                    <div id="import-result" className={`mb-6 p-5 rounded-2xl border shadow-xl animate-in fade-in slide-in-from-top-4 duration-500 ${result.failed === 0
                            ? 'bg-emerald-900/20 border-emerald-500/30'
                            : result.success === 0
                                ? 'bg-red-900/20 border-red-500/30'
                                : 'bg-amber-900/20 border-amber-500/30'
                        }`}>
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-3">
                                {result.failed === 0 ? (
                                    <div className="p-2 bg-emerald-500/20 rounded-lg"><CheckCircle className="w-6 h-6 text-emerald-400" /></div>
                                ) : (
                                    <div className="p-2 bg-red-500/20 rounded-lg"><AlertTriangle className="w-6 h-6 text-red-400" /></div>
                                )}
                                <div>
                                    <h3 className="text-lg font-bold text-white">Результаты импорта</h3>
                                    <p className="text-sm text-slate-400">
                                        Успешно: <span className="text-emerald-400 font-bold">{result.success}</span> |
                                        Ошибки: <span className="text-red-400 font-bold">{result.failed}</span>
                                    </p>
                                </div>
                            </div>

                            {result.errors.length > 0 && (
                                <button
                                    onClick={() => {
                                        navigator.clipboard.writeText(result.errors.join('\n'))
                                        alert('Логи ошибок скопированы в буфер обмена')
                                    }}
                                    className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium transition-colors border border-slate-700"
                                >
                                    <FileSpreadsheet className="w-4 h-4" />
                                    Копировать ошибки
                                </button>
                            )}
                        </div>

                        {result.errors.length > 0 && (
                            <div className="bg-black/40 rounded-xl p-4 border border-slate-800/50">
                                <div className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-3">Лог ошибок</div>
                                <div className="space-y-2 max-h-60 overflow-y-auto pr-2 custom-scrollbar font-mono text-xs">
                                    {result.errors.map((err, i) => (
                                        <div key={i} className="flex gap-3 text-red-300 leading-relaxed bg-red-500/5 p-2 rounded border border-red-500/10 hover:border-red-500/30 transition-colors">
                                            <span className="text-red-500/50 flex-shrink-0">{i + 1}.</span>
                                            <span>{err}</span>
                                        </div>
                                    ))}
                                </div>
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
                {products.length > 0 && (uniqueBrands.length > 1 || uniqueCategories.length > 1 || uniqueSubcategories.length > 1 || uniqueGenders.length > 1) && (
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
                                    <option key={id} value={id}>{id === '__EMPTY__' ? 'Без бренда' : resolveName(id, lookups?.brands || [])}</option>
                                ))}
                            </select>
                        )}

                        {uniqueCategories.length > 1 && (
                            <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)}
                                className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white outline-none focus:border-indigo-500 transition-colors min-w-[140px]">
                                <option value="">Все категории</option>
                                {uniqueCategories.map(id => (
                                    <option key={id} value={id}>{id === '__EMPTY__' ? 'Без категории' : resolveName(id, lookups?.categories || [])}</option>
                                ))}
                            </select>
                        )}

                        {uniqueSubcategories.length > 1 && (
                            <select value={filterSubcategory} onChange={e => setFilterSubcategory(e.target.value)}
                                className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white outline-none focus:border-indigo-500 transition-colors min-w-[140px]">
                                <option value="">Все подкатегории</option>
                                {uniqueSubcategories.map(id => (
                                    <option key={id} value={id}>{id === '__EMPTY__' ? 'Без подкатегории' : resolveName(id, lookups?.subcategories || [])}</option>
                                ))}
                            </select>
                        )}

                        {uniqueGenders.length > 1 && (
                            <select value={filterGender} onChange={e => setFilterGender(e.target.value)}
                                className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white outline-none focus:border-indigo-500 transition-colors min-w-[140px]">
                                <option value="">Все гендеры (Для кого)</option>
                                {uniqueGenders.map(g => (
                                    <option key={g} value={g}>{g === '__EMPTY__' ? 'Без гендера' : g}</option>
                                ))}
                            </select>
                        )}

                        {(filterBrand || filterCategory || filterSubcategory || filterGender) && (
                            <button onClick={() => { setFilterBrand(''); setFilterCategory(''); setFilterSubcategory(''); setFilterGender('') }}
                                className="text-xs text-slate-400 hover:text-white px-2 py-1 rounded hover:bg-slate-700 transition-colors">
                                Сбросить
                            </button>
                        )}

                        {(filterBrand || filterCategory || filterSubcategory || filterGender) && (
                            <span className="text-xs text-slate-500 ml-auto">
                                Показано <span className="text-white font-semibold">{filteredProducts.length}</span> из {products.length}
                            </span>
                        )}
                    </div>
                )}

                {/* Grid */}
                {products.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5 pb-32">
                        {filteredProducts.map((product) => {
                            const realIndex = products.indexOf(product)
                            const selectionOrder = selectedForMerge.indexOf(realIndex)
                            return (
                                <CsvProductCard key={`${product.productId}-${realIndex}`} product={product} index={realIndex} lookups={lookups}
                                    isSelected={selectionOrder !== -1}
                                    selectionOrder={selectionOrder + 1}
                                    onToggleSelection={() => toggleMergeSelection(realIndex)}
                                    onRemove={handleRemove} onUpdate={updateProduct}
                                    onClick={() => setSelectedIdx(realIndex)} />
                            )
                        })}
                    </div>
                )}

                {/* Floating Bulk Action Bar */}
                {selectedForMerge.length > 0 && (
                    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-4 duration-300">
                        <div className="bg-slate-800/90 backdrop-blur-md border border-slate-700 shadow-2xl rounded-2xl px-6 py-4 flex items-center gap-6">
                            <div className="flex items-center gap-3 pr-6 border-r border-slate-700">
                                <div className="p-2 bg-indigo-500/20 rounded-lg">
                                    <CheckSquare className="w-5 h-5 text-indigo-400" />
                                </div>
                                <div>
                                    <div className="text-sm font-bold text-white">Выбрано {selectedForMerge.length}</div>
                                    <div className="text-[10px] text-slate-400 uppercase tracking-widest font-medium">Товаров для объединения</div>
                                </div>
                            </div>

                            <div className="flex items-center gap-3">
                                <button onClick={() => setSelectedForMerge([])}
                                    className="px-4 py-2 text-sm font-medium text-slate-400 hover:text-white transition-colors">
                                    Отмена
                                </button>
                                <button onClick={handleMergePhotos} disabled={selectedForMerge.length < 2}
                                    className="px-6 py-2.5 bg-gradient-to-r from-indigo-500 to-blue-600 hover:from-indigo-400 hover:to-blue-500 text-white rounded-xl text-sm font-bold shadow-lg shadow-indigo-500/20 transition-all flex items-center gap-2 disabled:opacity-50 disabled:grayscale">
                                    <Merge className="w-4 h-4" />
                                    Объединить фото
                                </button>
                            </div>
                        </div>
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
    isSelected: boolean
    selectionOrder: number
    onToggleSelection: () => void
    onRemove: (i: number) => void
    onUpdate: (i: number, f: keyof CsvProduct, v: any) => void
    onClick: () => void
}

function CsvProductCard({ product, index, lookups, isSelected, selectionOrder, onToggleSelection, onRemove, onUpdate, onClick }: CsvProductCardProps) {
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
            <div className={`relative aspect-square overflow-hidden bg-slate-900 transition-all ${isSelected ? 'ring-4 ring-indigo-500 ring-inset' : ''}`}>
                {product.photos?.[0] ? (
                    <Image src={product.photos[0] + IMG_SUFFIX} alt={product.name || ''} fill sizes="(max-width:768px) 100vw,25vw"
                        className={`object-cover transition-transform duration-500 ${isSelected ? 'scale-105 opacity-100' : 'group-hover:scale-105 opacity-90 group-hover:opacity-100'}`} unoptimized />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-600 text-xs uppercase tracking-widest">No image</div>
                )}

                {/* Selection Overlay */}
                <div className={`absolute inset-0 transition-colors ${isSelected ? 'bg-indigo-500/10' : 'hover:bg-black/20'}`} />

                {/* Checkbox */}
                <button onClick={(e) => { e.stopPropagation(); onToggleSelection() }}
                    className={`absolute top-3 left-3 w-8 h-8 rounded-full flex items-center justify-center transition-all z-10 shadow-lg ${isSelected ? 'bg-indigo-500 text-white scale-110' : 'bg-slate-900/60 text-slate-400 opacity-0 group-hover:opacity-100'}`}>
                    {isSelected ? (
                        <span className="text-xs font-bold">{selectionOrder}</span>
                    ) : (
                        <Square className="w-4 h-4" />
                    )}
                </button>

                <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                    <button onClick={(e) => { e.stopPropagation(); onRemove(index) }}
                        className="p-2 bg-slate-900/80 backdrop-blur-sm rounded-full shadow-lg hover:bg-red-600 text-slate-300 hover:text-white transition-colors">
                        <Trash2 className="w-4 h-4" />
                    </button>
                </div>
                <span className="absolute bottom-3 left-3 px-2 py-1 text-xs font-mono bg-slate-900/80 backdrop-blur-sm rounded-md text-slate-300 z-10">#{index + 1}</span>

                {/* Photo Count Tag & Quick Actions */}
                <div className="absolute bottom-3 right-3 flex items-center gap-1.5 z-10">
                    {product.photos && product.photos.length > 0 && (
                        <>
                            <button onClick={(e) => { e.stopPropagation(); onUpdate(index, 'photos', product.photos.slice(1)) }}
                                title="Удалить первое фото"
                                className="px-2 py-1 bg-red-500/80 hover:bg-red-600 backdrop-blur-sm rounded text-[10px] font-bold text-white transition-colors border border-red-400/20">
                                Удалить 1-е
                            </button>
                            <div className="px-2 py-1 bg-slate-900/80 backdrop-blur-sm rounded-md text-[10px] font-bold text-slate-300 border border-slate-700/50">
                                {product.photos.length} фото
                            </div>
                        </>
                    )}
                </div>
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
                            <div className="flex items-center justify-between">
                                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Фотографии ({local.photos.length})</h3>
                                {local.photos.length > 0 && (
                                    <button onClick={() => removePhoto(0)}
                                        className="text-[10px] font-bold text-red-400 hover:text-red-300 transition-colors uppercase tracking-wider">
                                        Удалить первое фото
                                    </button>
                                )}
                            </div>
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
