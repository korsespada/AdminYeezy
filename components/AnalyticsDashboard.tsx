'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { BarChart3, Users, Eye, ShoppingCart, Heart, MessageCircle, Package, RefreshCw, ArrowLeft, TrendingUp, Clock, Image as ImageIcon, UserPlus, Trash2, ChevronDown } from 'lucide-react'
import Link from 'next/link'
import Image from 'next/image'
import { type Brand, type Category, type Subcategory, type Product } from '@/lib/types'
import ProductForm from './ProductForm'
import AnalyticsCharts from './AnalyticsCharts'

type Period = 'today' | 'week' | 'month' | 'all'

interface AnalyticsEvent {
    id: string
    event: string
    productId: string
    name: string
    price: number
    session_id: string
    user_agent: string
    meta: Record<string, unknown>
    created: string
}

interface OverviewStats {
    unique_visitors: number
    online_now: number
    total_events: number
    page_views: number
    product_views: number
    add_to_cart: number
    add_to_favorites: number
    order_submit: number
    ask_manager: number
    new_profiles: number
}

interface ProductStat {
    product_id: string
    product_name: string
    views: number
    add_to_cart: number
    add_to_favorites: number
    order_submit: number
    ask_manager: number
    fullProduct?: Product
}

interface SeriesData {
    date: string
    views: number
    carts: number
    manager: number
    favorites: number
}

interface AnalyticsDashboardProps {
    brands?: Brand[]
    categories?: Category[]
    subcategories?: Subcategory[]
}

function periodFilter(period: Period): string {
    const now = new Date()
    let since: Date

    switch (period) {
        case 'today':
            since = new Date(now.getFullYear(), now.getMonth(), now.getDate())
            break
        case 'week':
            since = new Date(now)
            since.setDate(since.getDate() - 7)
            break
        case 'month':
            since = new Date(now)
            since.setMonth(since.getMonth() - 1)
            break
        case 'all':
        default:
            return ''
    }

    return `created >= "${since.toISOString().replace('T', ' ').replace('Z', '')}"`
}

export default function AnalyticsDashboard({ brands = [], categories = [], subcategories = [] }: AnalyticsDashboardProps) {
    const [period, setPeriod] = useState<Period>('today')
    const [overview, setOverview] = useState<OverviewStats | null>(null)
    const [products, setProducts] = useState<ProductStat[]>([])
    const [seriesData, setSeriesData] = useState<SeriesData[]>([])
    const [osList, setOsList] = useState<{ name: string, visitors: number }[]>([])
    const [countryList, setCountryList] = useState<{ name: string, visitors: number }[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [activeTab, setActiveTab] = useState<'overview' | 'products' | 'favorites' | 'orders' | 'manager'>('overview')
    const [editingProduct, setEditingProduct] = useState<Product | null>(null)
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [isResetMenuOpen, setIsResetMenuOpen] = useState(false)
    const [isResetting, setIsResetting] = useState(false)

    const handleReset = async (type: 'period' | 'all') => {
        if (!confirm(`Вы уверены, что хотите сбросить аналитику ${type === 'all' ? 'за всё время' : 'за выбранный период'}? Это действие нельзя отменить.`)) {
            return;
        }

        setIsResetting(true)
        try {
            const res = await fetch(`/api/analytics?type=${type}&period=${period}`, {
                method: 'DELETE',
            })
            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: 'Ошибка сервера' }))
                throw new Error(err.error || `HTTP ${res.status}`)
            }
            fetchData()
        } catch (err: any) {
            console.error('Analytics reset error:', err)
            setError(err?.message || 'Ошибка сброса аналитики')
        } finally {
            setIsResetting(false)
        }
    }

    const handleEdit = (product: Product) => {
        setEditingProduct(product)
        setIsModalOpen(true)
    }

    const fetchData = useCallback(async () => {
        setLoading(true)
        setError(null)

        try {
            const res = await fetch(`/api/analytics?period=${period}`)
            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: 'Ошибка сервера' }))
                throw new Error(err.error || `HTTP ${res.status}`)
            }

            const data = await res.json()
            setOverview(data.overview)
            setProducts(data.products || [])
            setSeriesData(data.seriesData || [])
            setOsList(data.osList || [])
            setCountryList(data.countryList || [])
        } catch (err: any) {
            console.error('Analytics fetch error:', err)
            setError(err?.message || 'Ошибка загрузки аналитики')
        } finally {
            setLoading(false)
        }
    }, [period])

    useEffect(() => {
        fetchData()
        const interval = setInterval(fetchData, 30_000)
        return () => clearInterval(interval)
    }, [fetchData])

    const periodLabels: Record<Period, string> = {
        today: 'Сегодня',
        week: 'Неделя',
        month: 'Месяц',
        all: 'Всё время',
    }

    const sortedByField = (field: keyof ProductStat) =>
        [...products].sort((a, b) => (b[field] as number) - (a[field] as number)).filter(p => (p[field] as number) > 0)

    return (
        <div className="min-h-screen bg-[#0F172A] text-slate-200 font-sans">
            {/* Header */}
            <header className="bg-slate-900/80 backdrop-blur-md border-b border-slate-800 py-4 px-4 sm:px-6 sticky top-0 z-30 flex flex-col md:flex-row items-center justify-between gap-4 shadow-2xl">
                <div className="flex items-center justify-between w-full md:w-auto gap-4">
                    <div className="flex items-center gap-4 sm:gap-6">
                        <Link href="/admin" className="p-2 text-slate-400 hover:bg-slate-800 hover:text-white rounded-xl transition-all border border-transparent hover:border-slate-700">
                            <ArrowLeft className="w-5 h-5" />
                        </Link>
                        <div>
                            <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight flex items-center gap-2 sm:gap-3">
                                <BarChart3 className="w-6 h-6 sm:w-7 h-7 text-[#5D5FEF]" />
                                Аналитика
                            </h1>
                            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">YEEZY UNIQUE ADMIN</p>
                        </div>
                    </div>
                    {/* Mobile refresh button */}
                    <button
                        onClick={fetchData}
                        disabled={loading || isResetting}
                        className="md:hidden p-2.5 text-slate-400 hover:text-[#5D5FEF] hover:bg-slate-800/80 rounded-xl border border-slate-800 transition-all disabled:opacity-50"
                    >
                        <RefreshCw className={`w-5 h-5 ${loading || isResetting ? 'animate-spin' : ''}`} />
                    </button>
                </div>

                <div className="flex items-center gap-2 sm:gap-6 flex-shrink-0">
                    <div className="flex items-center justify-between w-full md:w-auto gap-2 sm:gap-6 overflow-x-auto no-scrollbar py-1 pr-2">
                        {/* Period Selector */}
                        <div className="flex bg-slate-800/50 p-1.5 rounded-2xl border border-slate-700/50 shadow-inner flex-shrink-0">
                            {(Object.keys(periodLabels) as Period[]).map(p => (
                                <button
                                    key={p}
                                    onClick={() => setPeriod(p)}
                                    className={`px-3 sm:px-5 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all ${period === p
                                        ? 'bg-[#5D5FEF] text-white shadow-lg shadow-[#5D5FEF]/20'
                                        : 'text-slate-400 hover:text-slate-200'
                                        }`}
                                >
                                    {periodLabels[p]}
                                </button>
                            ))}
                        </div>

                        <div className="h-8 w-px bg-slate-800 hidden md:block" />

                        <div className="text-right hidden xl:block flex-shrink-0">
                            <div className="text-sm font-black text-white">{new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</div>
                            <div className="text-[10px] text-slate-500 font-bold uppercase tracking-tighter">Сегодня, {new Date().toLocaleDateString('ru-RU', { weekday: 'long' })}</div>
                        </div>

                        <button
                            onClick={fetchData}
                            disabled={loading || isResetting}
                            className="hidden md:block p-3 text-slate-400 hover:text-[#5D5FEF] hover:bg-slate-800/80 rounded-2xl border border-slate-800 transition-all disabled:opacity-50 group flex-shrink-0"
                        >
                            <RefreshCw className={`w-5 h-5 ${loading || isResetting ? 'animate-spin' : 'group-hover:rotate-180 transition-transform duration-500'}`} />
                        </button>
                    </div>

                    <div className="relative flex-shrink-0">
                        <button
                            onClick={() => setIsResetMenuOpen(!isResetMenuOpen)}
                            disabled={isResetting}
                            className="flex items-center gap-2 px-3 sm:px-5 py-2.5 text-[#FF5B5B] hover:bg-[#FF5B5B]/10 rounded-2xl transition-all border border-[#FF5B5B]/30 hover:border-[#FF5B5B] text-xs sm:text-sm font-black disabled:opacity-50 outline-none select-none active:scale-95 group"
                        >
                            <Trash2 className="w-4 h-4" />
                            <span className="hidden sm:inline">Сбросить</span>
                            <ChevronDown className={`w-4 h-4 transition-transform duration-300 ${isResetMenuOpen ? 'rotate-180' : ''}`} />
                        </button>

                        {isResetMenuOpen && (
                            <>
                                <div className="fixed inset-0 z-40" onClick={() => setIsResetMenuOpen(false)}></div>
                                <div className="absolute right-0 top-full mt-3 w-64 bg-slate-900 border border-slate-800 rounded-[24px] shadow-2xl flex flex-col py-3 z-50 overflow-hidden ring-1 ring-white/5">
                                    <button
                                        onClick={() => { handleReset('period'); setIsResetMenuOpen(false) }}
                                        className="px-6 py-4 text-sm text-left text-slate-300 hover:bg-slate-800 font-bold transition-colors flex items-center justify-between group"
                                    >
                                        <span>Очистить за {periodLabels[period].toLowerCase()}</span>
                                        <div className="w-1.5 h-1.5 rounded-full bg-slate-700 group-hover:bg-[#5D5FEF] transition-colors" />
                                    </button>
                                    <div className="h-px bg-slate-800 mx-4 my-1" />
                                    <button
                                        onClick={() => { handleReset('all'); setIsResetMenuOpen(false) }}
                                        className="px-6 py-4 text-sm text-left text-[#FF5B5B] hover:bg-[#FF5B5B]/5 font-black transition-colors flex items-center justify-between group"
                                    >
                                        <span>Очистить за всё время</span>
                                        <Trash2 className="w-4 h-4 opacity-30 group-hover:opacity-100 transition-opacity" />
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </header>

            <main className="p-4 sm:p-8 max-w-[1600px] mx-auto space-y-6 sm:space-y-10">
                {error && (
                    <div className="bg-red-500/10 border border-red-500/20 rounded-[24px] p-6 text-red-400 font-bold flex items-center gap-4 animate-pulse">
                        <div className="w-3 h-3 rounded-full bg-red-500" />
                        {error}
                    </div>
                )}

                {/* Top Statistics Row */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8">
                    {/* Main Summary Card */}
                    <div className="lg:col-span-8 bg-slate-900/50 rounded-[24px] sm:rounded-[32px] p-6 sm:p-10 shadow-2xl border border-slate-800/50 backdrop-blur-sm">
                        <div className="flex items-center justify-between mb-10">
                            <div>
                                <h3 className="text-2xl font-black text-white">Статистика продаж</h3>
                                <p className="text-slate-500 text-sm font-medium mt-1">Краткий обзор активности • {periodLabels[period]}</p>
                            </div>
                            <div className="bg-[#5D5FEF]/10 text-[#5D5FEF] px-4 py-1.5 rounded-full text-xs font-black uppercase tracking-widest">Live</div>
                        </div>

                        {overview ? (
                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-8">
                                <MetricCard 
                                    icon={<Users className="w-6 h-6" />} 
                                    label="Уникальные гости" 
                                    value={overview.unique_visitors} 
                                    subValue="+8.2% с вчера" 
                                    color="pink" 
                                />
                                <MetricCard 
                                    icon={<Package className="w-6 h-6" />} 
                                    label="Всего заказов" 
                                    value={overview.order_submit} 
                                    subValue="+12% с вчера" 
                                    color="orange" 
                                />
                                <MetricCard 
                                    icon={<Eye className="w-6 h-6" />} 
                                    label="Просм. товаров" 
                                    value={overview.product_views} 
                                    subValue="+2.1% с вчера" 
                                    color="green" 
                                />
                                <MetricCard 
                                    icon={<Clock className="w-6 h-6" />} 
                                    label="Текущий онлайн" 
                                    value={overview.online_now} 
                                    subValue="Живые данные" 
                                    color="purple"
                                    isMain
                                />
                            </div>
                        ) : (
                            <div className="h-48 flex items-center justify-center">
                                <RefreshCw className="w-10 h-10 text-[#5D5FEF] animate-spin opacity-40" />
                            </div>
                        )}
                    </div>

                    {/* Activity Feed / Small Chart */}
                    <div className="lg:col-span-4 bg-slate-900/50 rounded-[24px] sm:rounded-[32px] p-6 sm:p-10 shadow-2xl border border-slate-800/50 relative overflow-hidden group">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-[#5D5FEF]/5 blur-3xl rounded-full translate-x-10 -translate-y-10 group-hover:scale-150 transition-transform duration-1000" />
                        <h3 className="text-xl sm:text-2xl font-black text-white mb-6 sm:mb-8">Активность</h3>
                        {seriesData.length > 0 ? (
                            <div className="h-[220px]">
                                <AnalyticsCharts seriesData={seriesData} overview={overview || {} as any} minimal />
                            </div>
                        ) : (
                            <div className="h-full flex items-center justify-center text-slate-600 font-bold uppercase tracking-widest text-xs">
                                Нет данных для графика
                            </div>
                        )}
                    </div>
                </div>

                {/* Secondary Stats Row */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8">
                    {/* Actions Card */}
                    <div className="bg-slate-900/50 rounded-[24px] sm:rounded-[32px] p-6 sm:p-10 shadow-2xl border border-slate-800/50">
                        <h3 className="text-lg sm:text-xl font-black text-white mb-8 sm:mb-10 flex items-center gap-3">
                            <TrendingUp className="w-5 h-5 text-pink-500" />
                            Действия
                        </h3>
                        <div className="space-y-6 sm:space-y-8">
                            <SmallStat label="В корзину" value={overview?.add_to_cart || 0} color="#5D5FEF" />
                            <SmallStat label="В избранное" value={overview?.add_to_favorites || 0} color="#FFD026" />
                            <SmallStat label="Вопросы менеджеру" value={overview?.ask_manager || 0} color="#10B981" />
                            <SmallStat label="Всего кликов" value={overview?.total_events || 0} color="#FA5A7D" />
                        </div>
                    </div>

                    {/* Conversion Card */}
                    <div className="bg-slate-900/50 rounded-[24px] sm:rounded-[32px] p-6 sm:p-10 shadow-2xl border border-slate-800/50 flex flex-col items-center text-center">
                        <h3 className="text-lg sm:text-xl font-black text-white mb-2">Конверсия</h3>
                        <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest mb-8 sm:mb-10">Эффективность</p>
                        
                        {overview && overview.product_views > 0 ? (
                            <div className="relative flex items-center justify-center w-32 h-32 sm:w-48 sm:h-48">
                                <svg className="w-full h-full transform -rotate-90">
                                    <circle cx="64" cy="64" r="58" stroke="currentColor" strokeWidth="8" fill="transparent" className="text-slate-800 sm:hidden" />
                                    <circle cx="96" cy="96" r="88" stroke="currentColor" strokeWidth="12" fill="transparent" className="text-slate-800 hidden sm:block" />
                                    
                                    {/* Simplified dash calculation for mobile/desktop sizes */}
                                    <circle cx="64" cy="64" r="58" stroke="currentColor" strokeWidth="8" fill="transparent" strokeDasharray={364} strokeDashoffset={364 - (364 * Math.min(100, (overview.order_submit / overview.product_views) * 100)) / 100} className="text-[#5D5FEF] transition-all duration-1000 ease-out sm:hidden" />
                                    <circle cx="96" cy="96" r="88" stroke="currentColor" strokeWidth="12" fill="transparent" strokeDasharray={552} strokeDashoffset={552 - (552 * Math.min(100, (overview.order_submit / overview.product_views) * 100)) / 100} className="text-[#5D5FEF] transition-all duration-1000 ease-out hidden sm:block" />
                                </svg>
                                <div className="absolute inset-0 flex flex-col items-center justify-center">
                                    <div className="text-2xl sm:text-4xl font-black text-white">
                                        {((overview.order_submit / overview.product_views) * 100).toFixed(1)}%
                                    </div>
                                    <div className="text-[8px] sm:text-[10px] text-slate-500 font-bold uppercase tracking-tighter mt-1">в заказ</div>
                                </div>
                            </div>
                        ) : (
                            <div className="flex items-center justify-center h-48 text-slate-700 font-black">АНАЛИЗ...</div>
                        )}
                    </div>

                    {/* Geo Card */}
                    <div className="bg-slate-900/50 rounded-[24px] sm:rounded-[32px] p-6 sm:p-10 shadow-2xl border border-slate-800/50 sm:col-span-2 lg:col-span-1">
                        <h3 className="text-lg sm:text-xl font-black text-white mb-6 sm:mb-8">Топ стран</h3>
                        <div className="grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-1 gap-4 sm:gap-6">
                            {countryList.length > 0 ? countryList.slice(0, 5).map((c, i) => (
                                <div key={i} className="flex items-center justify-between group">
                                    <div className="flex items-center gap-4">
                                        <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center text-lg border border-slate-700/50 group-hover:border-[#5D5FEF]/50 transition-colors">
                                            {getFlag(c.name)}
                                        </div>
                                        <div>
                                            <span className="font-bold text-slate-200 block">{getDisplayName(c.name)}</span>
                                            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Визиты</span>
                                        </div>
                                    </div>
                                    <span className="font-black text-[#5D5FEF] text-lg">{c.visitors}</span>
                                </div>
                            )) : (
                                <div className="text-center py-10">
                                    <p className="text-slate-700 font-black uppercase tracking-tighter text-sm">Данных пока нет</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Detailed Products Table */}
                <div className="bg-slate-900 border border-slate-800 rounded-[28px] sm:rounded-[40px] p-6 sm:p-10 shadow-3xl">
                    <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-6 mb-10">
                        <div>
                            <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">Популярные <span className="text-[#5D5FEF]">товары</span></h2>
                            <p className="text-slate-500 font-medium text-xs sm:text-sm mt-1">Детальный отчет по взаимодействиям</p>
                        </div>
                        <div className="flex gap-1.5 sm:gap-2 bg-slate-800/50 p-1 rounded-2xl border border-slate-700/50 backdrop-blur-sm self-start overflow-x-auto no-scrollbar max-w-full">
                            {[
                                { key: 'overview', label: 'Просмотры' },
                                { key: 'favorites', label: 'Избранное' },
                                { key: 'orders', label: 'Заказы' },
                                { key: 'manager', label: 'Менеджер' },
                            ].map(tab => (
                                <button
                                    key={tab.key}
                                    onClick={() => setActiveTab(tab.key as any)}
                                    className={`px-4 sm:px-6 py-2 sm:py-2.5 rounded-xl text-[10px] sm:text-xs font-black uppercase tracking-widest transition-all whitespace-nowrap ${activeTab === tab.key
                                        ? 'bg-[#5D5FEF] text-white shadow-xl shadow-[#5D5FEF]/20 translate-y-[-1px]'
                                        : 'text-slate-500 hover:text-slate-300'
                                        }`}
                                >
                                    {tab.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-40 gap-4">
                            <RefreshCw className="w-12 h-12 text-[#5D5FEF] animate-spin opacity-50" />
                            <div className="text-xs font-black text-slate-600 uppercase tracking-[0.2em]">Загрузка базы данных...</div>
                        </div>
                    ) : (
                        <div className="transition-all duration-500 ease-in-out">
                             {activeTab === 'overview' && (
                                <ProductTable
                                    title="Топ просмотров"
                                    data={sortedByField('views')}
                                    onEdit={handleEdit}
                                    columns={[
                                        { key: 'views', label: 'Просмотры' },
                                        { key: 'add_to_cart', label: 'В корзину' },
                                        { key: 'add_to_favorites', label: 'Избранное' },
                                    ]}
                                />
                            )}
                            {activeTab === 'favorites' && (
                                <ProductTable
                                    title="В избранном"
                                    data={sortedByField('add_to_favorites')}
                                    onEdit={handleEdit}
                                    columns={[
                                        { key: 'add_to_favorites', label: 'Добавлений' },
                                        { key: 'views', label: 'Просмотры' },
                                    ]}
                                />
                            )}
                            {activeTab === 'orders' && (
                                <ProductTable
                                    title="Заказано"
                                    data={sortedByField('order_submit')}
                                    onEdit={handleEdit}
                                    columns={[
                                        { key: 'order_submit', label: 'Заказов' },
                                        { key: 'add_to_cart', label: 'В корзину' },
                                    ]}
                                />
                            )}
                            {activeTab === 'manager' && (
                                <ProductTable
                                    title="Вопросы менеджеру"
                                    data={sortedByField('ask_manager')}
                                    onEdit={handleEdit}
                                    columns={[
                                        { key: 'ask_manager', label: 'Кликов' },
                                        { key: 'views', label: 'Просмотры' },
                                    ]}
                                />
                            )}
                        </div>
                    )}
                </div>
            </main>

            {editingProduct && isModalOpen && (
                <ProductForm
                    product={editingProduct}
                    brands={brands}
                    categories={categories}
                    subcategories={subcategories}
                    isOpen={isModalOpen}
                    onClose={() => {
                        setIsModalOpen(false)
                        setEditingProduct(null)
                    }}
                />
            )}
        </div>
    )
}

// ── Sub-components for New Design ──────────────────────────────────────

function MetricCard({ icon, label, value, subValue, color, isMain }: {
    icon: React.ReactNode
    label: string
    value: number
    subValue: string
    color: 'pink' | 'orange' | 'green' | 'purple'
    isMain?: boolean
}) {
    const bgs = {
        pink: 'bg-slate-900',
        orange: 'bg-slate-900',
        green: 'bg-slate-900',
        purple: isMain ? 'bg-[#5D5FEF]/15' : 'bg-slate-900'
    }
    const icons = {
        pink: 'bg-[#FA5A7D]',
        orange: 'bg-[#FF947A]',
        green: 'bg-[#3CD856]',
        purple: 'bg-[#5D5FEF]'
    }
    const accentBorder = {
        pink: 'border-pink-500/10',
        orange: 'border-orange-500/10',
        green: 'border-green-500/10',
        purple: isMain ? 'border-[#5D5FEF]/50' : 'border-[#5D5FEF]/20'
    }

    return (
        <div className={`${bgs[color]} border ${accentBorder[color]} rounded-[20px] sm:rounded-[32px] p-4 sm:p-8 transition-all hover:scale-[1.02] sm:hover:scale-[1.05] hover:shadow-2xl hover:shadow-${color}-500/5 duration-500 relative overflow-hidden group`}>
            {isMain && (
                <div className="absolute top-0 right-0 w-24 h-24 sm:w-32 sm:h-32 bg-[#5D5FEF]/10 blur-3xl rounded-full translate-x-12 -translate-y-12" />
            )}
            <div className={`${icons[color]} w-8 h-8 sm:w-14 sm:h-14 rounded-lg sm:rounded-2xl flex items-center justify-center text-white mb-3 sm:mb-6 shadow-lg transform group-hover:rotate-12 transition-transform duration-500`}>
                {React.cloneElement(icon as React.ReactElement, { className: 'w-4 h-4 sm:w-6 h-6' })}
            </div>
            <div className="text-white text-lg sm:text-3xl font-black mb-1 sm:mb-2 tracking-tight">
                {(value || 0).toLocaleString()}
            </div>
            <div className="text-slate-400 text-[8px] sm:text-sm font-bold opacity-80 mb-2 sm:mb-3 truncate uppercase tracking-widest">{label}</div>
            <div className={`text-[8px] sm:text-[10px] font-black uppercase tracking-tighter px-1.5 py-0.5 sm:px-2 sm:py-1 rounded-lg w-fit ${isMain ? 'bg-[#5D5FEF]/20 text-[#5D5FEF]' : 'bg-slate-800 text-slate-500'}`}>
                {subValue}
            </div>
            {isMain && value > 0 && (
                <div className="absolute top-6 right-6 sm:top-8 sm:right-8 flex h-2 w-2 sm:h-3 sm:w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#5D5FEF] opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 sm:h-3 sm:w-3 bg-[#5D5FEF]"></span>
                </div>
            )}
        </div>
    )
}

function SmallStat({ label, value, color }: { label: string, value: number, color: string }) {
    return (
        <div className="flex flex-col gap-3 group">
            <div className="flex justify-between items-center">
                <span className="font-bold text-slate-400 text-sm tracking-wide group-hover:text-slate-200 transition-colors">{label}</span>
                <span className="font-black text-white text-lg tracking-tight">{value.toLocaleString()}</span>
            </div>
            <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden p-[1px]">
                <div 
                    className="h-full rounded-full transition-all duration-[1500ms] shadow-[0_0_10px_rgba(255,255,255,0.1)]" 
                    style={{ backgroundColor: color, width: `${Math.min(100, (value / 500) * 100)}%` }} 
                />
            </div>
        </div>
    )
}

function ProductTable({ title, data, columns, onEdit }: {
    title: string
    data: ProductStat[]
    columns: { key: keyof ProductStat; label: string }[]
    onEdit: (product: Product) => void
}) {
    const getPhotoUrl = (product: Product) => {
        if (!product) return null
        if (product.thumb && typeof product.thumb === 'string') {
            if (product.thumb.startsWith('http')) return product.thumb;
            return `https://yeezy-app-thumbs.hb.ru-msk.vkcloud-storage.ru/products/${product.id}/${product.thumb}`
        }
        if (!product.photos && !product.thumb) return null
        
        const photos = Array.isArray(product.photos) 
            ? product.photos 
            : (typeof product.photos === 'string' ? JSON.parse(product.photos) : [])

        if (photos.length === 0) return null
        let photoUrl = photos[0]
        if (typeof photoUrl === 'string' && !photoUrl.startsWith('http')) {
            photoUrl = `https://cdn.yeezyunique.ru/products/${product.id}/${photoUrl}`;
        }
        return photoUrl
    }

    if (data.length === 0) {
        return (
            <div className="py-24 text-center bg-slate-900/40 rounded-[32px] border border-slate-800 border-dashed">
                <p className="text-slate-600 font-black uppercase tracking-[0.2em] text-xs transition-opacity animate-pulse">Нет данных в этом секторе</p>
            </div>
        )
    }

    return (
        <div className="overflow-x-auto no-scrollbar rounded-[24px] sm:rounded-[32px] border border-slate-800/60 bg-slate-900/40 backdrop-blur-sm">
            <table className="w-full text-left border-collapse min-w-[600px]">
                <thead>
                    <tr className="border-b border-slate-800/80 bg-slate-800/30">
                        <th className="px-8 py-6 text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Rank</th>
                        <th className="px-8 py-6 text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Продукт</th>
                        {columns.map(col => (
                            <th key={col.key} className="px-8 py-6 text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] text-right">{col.label}</th>
                        ))}
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/40">
                    {data.slice(0, 20).map((row, idx) => (
                        <tr 
                            key={row.product_id} 
                            onClick={() => row.fullProduct && onEdit(row.fullProduct)}
                            className="group hover:bg-[#5D5FEF]/5 transition-all cursor-pointer"
                        >
                            <td className="px-8 py-6">
                                <span className={`text-sm font-black ${idx < 3 ? 'text-[#5D5FEF]' : 'text-slate-600'}`}>
                                    {String(idx + 1).padStart(2, '0')}
                                </span>
                            </td>
                            <td className="px-4 sm:px-8 py-4 sm:py-6">
                                <div className="flex items-center gap-3 sm:gap-5">
                                    <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-xl sm:rounded-2xl bg-slate-800 overflow-hidden border border-slate-700 group-hover:border-[#5D5FEF]/50 transition-colors flex-shrink-0 shadow-lg relative">
                                        {row.fullProduct ? (
                                            <img 
                                                src={getPhotoUrl(row.fullProduct) || ''} 
                                                alt="" 
                                                className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                                                onError={(e) => {
                                                    (e.target as HTMLImageElement).src = 'https://placehold.co/100x100/1e293b/white?text=YEEZY'
                                                }}
                                            />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center text-[10px] font-black text-slate-600 uppercase">Empty</div>
                                        )}
                                    </div>
                                    <div className="min-w-0">
                                        <div className="text-white font-black text-base truncate group-hover:text-[#5D5FEF] transition-colors">{row.product_name || 'Неизвестно'}</div>
                                        <div className="text-[10px] text-slate-500 font-bold uppercase tracking-tighter mt-1">ID: {row.product_id}</div>
                                    </div>
                                </div>
                            </td>
                            {columns.map(col => (
                                <td key={col.key} className="px-8 py-6 text-right">
                                    <div className="text-white font-black text-lg">{row[col.key]?.toLocaleString() || 0}</div>
                                    <div className="w-24 h-1 bg-slate-800 rounded-full mt-2 ml-auto overflow-hidden">
                                        <div 
                                            className="h-full bg-[#5D5FEF]/40" 
                                            style={{ width: `${Math.min(100, ((row[col.key] as number) / (data[0][col.key] as number)) * 100)}%` }} 
                                        />
                                    </div>
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}

// ── Generic Helpers ──────────────────────────────────────────────────────

const getFlag = (country: string) => {
    const map: Record<string, string> = {
        'RU': '🇷🇺', 'Russian Federation': '🇷🇺', 'Russia': '🇷🇺',
        'DE': '🇩🇪', 'Germany': '🇩🇪', 'US': '🇺🇸', 'United States': '🇺🇸',
        'BY': '🇧🇾', 'Belarus': '🇧🇾', 'KZ': '🇰🇿', 'Kazakhstan': '🇰🇿',
        'UA': '🇺🇦', 'Ukraine': '🇺🇦',
    };
    return map[country] || '🌍';
};

const getDisplayName = (name: string) => {
    const map: Record<string, string> = {
        'Unknown': 'Неизвестно', 'Russian Federation': 'Россия', 'Russia': 'Россия',
        'United States': 'США', 'Germany': 'Германия', 'Ukraine': 'Украина',
    };
    return map[name] || name;
}
