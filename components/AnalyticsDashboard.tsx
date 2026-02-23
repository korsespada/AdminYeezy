'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { BarChart3, Users, Eye, ShoppingCart, Heart, MessageCircle, Package, RefreshCw, ArrowLeft, TrendingUp, Clock, Image as ImageIcon, UserPlus, Trash2 } from 'lucide-react'
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
            await fetchData()
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
        // Auto-refresh every 30 seconds
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
        <div className="min-h-screen bg-slate-900 text-slate-200">
            {/* Header */}
            <header className="bg-slate-800 border-b border-slate-700 py-3 px-6 sticky top-0 z-30 flex items-center justify-between shadow-sm">
                <div className="flex items-center gap-4">
                    <Link href="/admin" className="p-2 text-slate-400 hover:bg-slate-700 hover:text-white rounded-lg transition-colors">
                        <ArrowLeft className="w-5 h-5" />
                    </Link>
                    <div>
                        <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
                            <BarChart3 className="w-5 h-5 text-indigo-400" />
                            Аналитика
                        </h1>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    {/* Period Selector */}
                    <div className="flex bg-slate-700/50 p-0.5 rounded-lg border border-slate-600">
                        {(Object.keys(periodLabels) as Period[]).map(p => (
                            <button
                                key={p}
                                onClick={() => setPeriod(p)}
                                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${period === p
                                    ? 'bg-indigo-600 text-white shadow-sm'
                                    : 'text-slate-400 hover:text-slate-200'
                                    }`}
                            >
                                {periodLabels[p]}
                            </button>
                        ))}
                    </div>

                    <button
                        onClick={fetchData}
                        disabled={loading || isResetting}
                        className="p-2 text-slate-400 hover:text-white hover:bg-slate-700/50 rounded-lg transition-all disabled:opacity-50"
                        title="Обновить"
                    >
                        <RefreshCw className={`w-4 h-4 ${loading || isResetting ? 'animate-spin' : ''}`} />
                    </button>

                    <div className="relative ml-2">
                        <button
                            onClick={() => setIsResetMenuOpen(!isResetMenuOpen)}
                            disabled={isResetting}
                            className="flex items-center gap-2 px-3 py-1.5 text-red-400 hover:text-red-300 bg-red-400/10 hover:bg-red-400/20 rounded-lg transition-all border border-red-500/20 text-sm font-medium disabled:opacity-50"
                        >
                            <Trash2 className="w-4 h-4" />
                            Сбросить
                        </button>

                        {isResetMenuOpen && (
                            <>
                                <div className="fixed inset-0 z-40" onClick={() => setIsResetMenuOpen(false)}></div>
                                <div className="absolute right-0 top-full mt-2 w-48 bg-slate-800 border border-slate-600 rounded-lg shadow-xl flex flex-col py-1 z-50">
                                    <button
                                        onClick={() => { handleReset('period'); setIsResetMenuOpen(false) }}
                                        className="px-4 py-2 text-sm text-left text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
                                    >
                                        За выбранный период
                                    </button>
                                    <button
                                        onClick={() => { handleReset('all'); setIsResetMenuOpen(false) }}
                                        className="px-4 py-2 text-sm text-left text-red-400 hover:bg-slate-700 hover:text-red-300 transition-colors border-t border-slate-700 mt-1 pt-1"
                                    >
                                        За всё время
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </header>

            <div className="p-6 max-w-7xl mx-auto">
                {error && (
                    <div className="mb-6 bg-red-900/20 border border-red-800 rounded-xl p-4 text-red-400 text-sm">
                        {error}
                    </div>
                )}

                {/* Overview Cards */}
                {overview && (
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-4 mb-8">
                        <StatCard icon={<Users className="w-5 h-5" />} label="Гости (Сессии)" value={overview.unique_visitors} color="indigo" />
                        <StatCard icon={<UserPlus className="w-5 h-5" />} label="Новые лиды" value={overview.new_profiles} color="purple" />
                        <StatCard icon={<Clock className="w-5 h-5" />} label="Онлайн" value={overview.online_now} color="green" pulse />
                        <StatCard icon={<Eye className="w-5 h-5" />} label="Просмотры" value={overview.product_views} color="blue" />
                        <StatCard icon={<Heart className="w-5 h-5" />} label="Избранное" value={overview.add_to_favorites} color="pink" />
                        <StatCard icon={<ShoppingCart className="w-5 h-5" />} label="В корзину" value={overview.add_to_cart} color="amber" />
                        <StatCard icon={<Package className="w-5 h-5" />} label="Заказов" value={overview.order_submit} color="emerald" />
                    </div>
                )}

                {/* Conversion Info */}
                {overview && overview.product_views > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
                        <div className="bg-slate-800/80 border border-slate-700/50 rounded-xl p-5 shadow-lg shadow-black/20">
                            <div className="flex items-center gap-3 text-slate-400 mb-2">
                                <TrendingUp className="w-4 h-4 text-emerald-400" />
                                <span className="text-sm font-medium">Просмотры страниц</span>
                            </div>
                            <div className="text-3xl font-bold text-slate-100">{overview.page_views}</div>
                        </div>
                        <div className="bg-slate-800/80 border border-slate-700/50 rounded-xl p-5 shadow-lg shadow-black/20">
                            <div className="flex items-center gap-3 text-slate-400 mb-2">
                                <MessageCircle className="w-4 h-4 text-blue-400" />
                                <span className="text-sm font-medium">Спросить у менеджера</span>
                            </div>
                            <div className="text-3xl font-bold text-slate-100">{overview.ask_manager}</div>
                        </div>
                        <div className="bg-slate-800/80 border border-slate-700/50 rounded-xl p-5 shadow-lg shadow-black/20">
                            <div className="flex items-center gap-3 text-slate-400 mb-2">
                                <BarChart3 className="w-4 h-4 text-indigo-400" />
                                <span className="text-sm font-medium">Всего событий</span>
                            </div>
                            <div className="text-3xl font-bold text-slate-100">{overview.total_events}</div>
                        </div>
                        <div className="bg-slate-800/80 border border-slate-700/50 rounded-xl p-5 shadow-lg shadow-black/20">
                            <div className="flex items-center gap-3 text-slate-400 mb-2">
                                <Eye className="w-4 h-4 text-amber-400" />
                                <span className="text-sm font-medium">Конверсия в корзину</span>
                            </div>
                            <div className="text-3xl font-bold text-slate-100">
                                {((overview.add_to_cart / overview.product_views) * 100).toFixed(1)}%
                            </div>
                        </div>
                    </div>
                )}

                {/* Charts Area */}
                {overview && seriesData.length > 0 && (
                    <AnalyticsCharts
                        seriesData={seriesData}
                        overview={overview}
                    />
                )}

                {/* Geo and OS Stats */}
                {overview && (osList.length > 0 || countryList.length > 0) && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                        <StatsListCard title="Страны" data={countryList} />
                        <StatsListCard title="Операционные системы" data={osList} />
                    </div>
                )}

                {/* Tabs */}
                <div className="flex gap-1 bg-slate-800/50 p-1 rounded-xl border border-slate-700 mb-6 overflow-x-auto">
                    {[
                        { key: 'overview', label: 'Топ просмотров', icon: <Eye className="w-4 h-4" /> },
                        { key: 'favorites', label: 'Избранное', icon: <Heart className="w-4 h-4" /> },
                        { key: 'orders', label: 'Заказы', icon: <Package className="w-4 h-4" /> },
                        { key: 'manager', label: 'Менеджер', icon: <MessageCircle className="w-4 h-4" /> },
                    ].map(tab => (
                        <button
                            key={tab.key}
                            onClick={() => setActiveTab(tab.key as any)}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${activeTab === tab.key
                                ? 'bg-indigo-600 text-white shadow-sm'
                                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
                                }`}
                        >
                            {tab.icon}
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* Tables */}
                {loading && !overview ? (
                    <div className="flex items-center justify-center py-20">
                        <RefreshCw className="w-8 h-8 text-indigo-400 animate-spin" />
                    </div>
                ) : (
                    <>
                        {activeTab === 'overview' && (
                            <ProductTable
                                title="Самые просматриваемые товары"
                                data={sortedByField('views')}
                                onEdit={handleEdit}
                                columns={[
                                    { key: 'views', label: 'Просмотры' },
                                    { key: 'add_to_cart', label: 'В корзину' },
                                    { key: 'add_to_favorites', label: 'В избранное' },
                                    { key: 'ask_manager', label: 'Менеджер' },
                                ]}
                            />
                        )}

                        {activeTab === 'favorites' && (
                            <ProductTable
                                title="Добавления в избранное"
                                data={sortedByField('add_to_favorites')}
                                onEdit={handleEdit}
                                columns={[
                                    { key: 'add_to_favorites', label: 'Добавили' },
                                    { key: 'views', label: 'Просмотры' },
                                    { key: 'add_to_cart', label: 'В корзину' },
                                ]}
                            />
                        )}

                        {activeTab === 'orders' && (
                            <ProductTable
                                title="Заказы по товарам"
                                data={sortedByField('order_submit')}
                                onEdit={handleEdit}
                                columns={[
                                    { key: 'order_submit', label: 'Заказов' },
                                    { key: 'add_to_cart', label: 'В корзину' },
                                    { key: 'views', label: 'Просмотры' },
                                ]}
                            />
                        )}

                        {activeTab === 'manager' && (
                            <ProductTable
                                title="Клики «Спросить у менеджера»"
                                data={sortedByField('ask_manager')}
                                onEdit={handleEdit}
                                columns={[
                                    { key: 'ask_manager', label: 'Кликов' },
                                    { key: 'views', label: 'Просмотры' },
                                    { key: 'add_to_cart', label: 'В корзину' },
                                ]}
                            />
                        )}
                    </>
                )}
            </div>

            {/* Product Form Modal */}
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
        </div>
    )
}

// ── Sub-components ──────────────────────────────────────────────────────

function StatCard({ icon, label, value, color, pulse }: {
    icon: React.ReactNode
    label: string
    value: number
    color: string
    pulse?: boolean
}) {
    const colorMap: Record<string, string> = {
        indigo: 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 shadow-[0_0_15px_rgba(99,102,241,0.1)]',
        purple: 'bg-purple-500/10 text-purple-400 border border-purple-500/20 shadow-[0_0_15px_rgba(168,85,247,0.1)]',
        green: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.1)]',
        blue: 'bg-blue-500/10 text-blue-400 border border-blue-500/20 shadow-[0_0_15px_rgba(59,130,246,0.1)]',
        pink: 'bg-pink-500/10 text-pink-400 border border-pink-500/20 shadow-[0_0_15px_rgba(236,72,153,0.1)]',
        amber: 'bg-amber-500/10 text-amber-400 border border-amber-500/20 shadow-[0_0_15px_rgba(245,158,11,0.1)]',
        emerald: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.1)]',
    }

    return (
        <div className={`${colorMap[color] || 'bg-slate-800/50 text-slate-400'} rounded-xl p-4 flex flex-col justify-between backdrop-blur-sm transition-all hover:scale-[1.02] duration-200`}>
            <div className="flex items-center gap-2 mb-2 opacity-80">
                {icon}
                <span className="text-xs font-medium uppercase tracking-wider">{label}</span>
            </div>
            <div className="flex items-end gap-2">
                <span className="text-3xl font-bold">{value}</span>
                {pulse && value > 0 && (
                    <span className="flex h-3 w-3 relative mb-2 ml-1">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                    </span>
                )}
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
            if (product.thumb.startsWith('http')) {
                return product.thumb;
            }
            return `https://yeezy-app-thumbs.hb.ru-msk.vkcloud-storage.ru/products/${product.id}/${product.thumb}`
        }

        if (!product.photos || product.photos.length === 0) return null
        let photoUrl = product.photos[0]
        if (typeof photoUrl === 'string' && photoUrl.startsWith('[')) {
            try {
                const photosArray = JSON.parse(photoUrl)
                photoUrl = photosArray[0]
            } catch (e) {
                // ignore
            }
        }
        if (typeof photoUrl === 'string') {
            if (photoUrl.includes('szwego.com')) {
                const IMG_SUFFIX = '?imageMogr2/auto-orient/thumbnail/!320x320r/quality/100/format/jpg'
                if (!photoUrl.includes('?imageMogr2')) {
                    photoUrl += IMG_SUFFIX
                }
            } else if (!photoUrl.startsWith('http') && !photoUrl.includes('/')) {
                photoUrl = `https://cdn.yeezyunique.ru/products/${product.id}/${photoUrl}`;
            }
        }
        return photoUrl
    }

    if (data.length === 0) {
        return (
            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-8 text-center">
                <p className="text-slate-500">Нет данных за выбранный период</p>
            </div>
        )
    }

    return (
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-700">
                <h3 className="text-lg font-semibold text-slate-100">{title}</h3>
                <p className="text-xs text-slate-500 mt-0.5">{data.length} товаров</p>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full">
                    <thead>
                        <tr className="border-b border-slate-700/50">
                            <th className="text-left px-6 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">#</th>
                            <th className="text-left px-6 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Товар</th>
                            {columns.map(col => (
                                <th key={col.key} className="text-right px-6 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">{col.label}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700/30">
                        {data.slice(0, 50).map((item, i) => (
                            <tr
                                key={item.product_id}
                                className="hover:bg-slate-700/20 transition-colors cursor-pointer"
                                onClick={() => item.fullProduct && onEdit(item.fullProduct)}
                            >
                                <td className="px-6 py-3 text-sm text-slate-500 font-mono">{i + 1}</td>
                                <td className="px-6 py-3">
                                    <div className="flex items-center gap-3">
                                        {item.fullProduct ? (
                                            <div
                                                onClick={() => onEdit(item.fullProduct!)}
                                                className="w-10 h-10 rounded bg-slate-900 border border-slate-700 overflow-hidden relative shrink-0 cursor-pointer hover:opacity-80 transition-opacity"
                                            >
                                                {getPhotoUrl(item.fullProduct) ? (
                                                    <Image src={getPhotoUrl(item.fullProduct)!} alt={item.product_name} fill sizes="40px" className="object-cover" unoptimized />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center text-[8px] text-slate-600 uppercase">No</div>
                                                )}
                                            </div>
                                        ) : (
                                            <div className="w-10 h-10 rounded bg-slate-900 border border-slate-700 overflow-hidden relative shrink-0 flex items-center justify-center text-[8px] text-slate-600 uppercase">No</div>
                                        )}
                                        <div>
                                            {item.fullProduct ? (
                                                <div
                                                    className="text-sm font-medium text-indigo-400 hover:underline text-left truncate max-w-xs block"
                                                >
                                                    {item.product_name}
                                                </div>
                                            ) : (
                                                <div className="text-sm font-medium text-slate-200 truncate max-w-xs">{item.product_name}</div>
                                            )}
                                            <div className="text-xs text-slate-500 font-mono">{item.product_id}</div>
                                        </div>
                                    </div>
                                </td>
                                {columns.map(col => (
                                    <td key={col.key} className="px-6 py-3 text-right">
                                        <span className={`text-sm font-semibold ${(item[col.key] as number) > 0 ? 'text-slate-200' : 'text-slate-600'}`}>
                                            {(item[col.key] as number).toLocaleString()}
                                        </span>
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    )
}

function StatsListCard({ title, data }: { title: string, data: { name: string, visitors: number }[] }) {
    if (data.length === 0) return null;
    const maxVal = Math.max(...data.map(d => d.visitors));
    const totalVis = data.reduce((acc, curr) => acc + curr.visitors, 0);

    const getFlag = (country: string) => {
        if (!country || country === 'Unknown' || country === 'Неизвестно') return '🌍';
        const map: Record<string, string> = {
            'RU': '🇷🇺', 'Russian Federation': '🇷🇺', 'Russia': '🇷🇺',
            'DE': '🇩🇪', 'Germany': '🇩🇪',
            'NL': '🇳🇱', 'Netherlands': '🇳🇱',
            'LV': '🇱🇻', 'Latvia': '🇱🇻',
            'US': '🇺🇸', 'United States': '🇺🇸',
            'GB': '🇬🇧', 'United Kingdom': '🇬🇧',
            'FR': '🇫🇷', 'France': '🇫🇷',
            'IT': '🇮🇹', 'Italy': '🇮🇹',
            'ES': '🇪🇸', 'Spain': '🇪🇸',
            'BY': '🇧🇾', 'Belarus': '🇧🇾',
            'KZ': '🇰🇿', 'Kazakhstan': '🇰🇿',
            'UA': '🇺🇦', 'Ukraine': '🇺🇦',
            'CN': '🇨🇳', 'China': '🇨🇳'
        };
        return map[country] || '🌍';
    };

    const getDisplayName = (name: string) => {
        if (name === 'Unknown') return 'Неизвестно';
        if (name === 'Russian Federation') return 'Россия';
        if (name === 'Russia') return 'Россия';
        return name;
    };

    return (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-5 shadow-lg shadow-black/20">
            <div className="flex justify-between text-xs font-semibold text-slate-400 mb-4 uppercase tracking-wider border-b border-slate-700/50 pb-2">
                <span>{title}</span>
                <span>ПОСЕТИТЕЛИ</span>
            </div>
            <div className="space-y-3">
                {data.slice(0, 10).map((item, idx) => (
                    <div key={idx} className="relative group">
                        <div
                            className="absolute top-0 left-0 h-full bg-slate-700/30 rounded-md transition-all duration-500 ease-out"
                            style={{ width: `${(item.visitors / maxVal) * 100}%` }}
                        ></div>
                        <div className="relative flex justify-between items-center px-3 py-2 z-10 text-sm">
                            <span className="text-slate-200 font-medium truncate flex items-center gap-2">
                                {title === 'Страны' && <span className="text-lg">{getFlag(item.name)}</span>}
                                {getDisplayName(item.name)}
                            </span>
                            <span className="text-slate-100 font-bold">{((item.visitors / totalVis) * 100).toFixed(0)}%</span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
