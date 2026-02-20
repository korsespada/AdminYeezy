'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { BarChart3, Users, Eye, ShoppingCart, Heart, MessageCircle, Package, RefreshCw, ArrowLeft, TrendingUp, Clock } from 'lucide-react'
import Link from 'next/link'

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
}

interface ProductStat {
    product_id: string
    product_name: string
    views: number
    add_to_cart: number
    add_to_favorites: number
    order_submit: number
    ask_manager: number
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

export default function AnalyticsDashboard() {
    const [period, setPeriod] = useState<Period>('today')
    const [overview, setOverview] = useState<OverviewStats | null>(null)
    const [products, setProducts] = useState<ProductStat[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [activeTab, setActiveTab] = useState<'overview' | 'products' | 'favorites' | 'orders' | 'manager'>('overview')

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
                        disabled={loading}
                        className="p-2 text-slate-400 hover:text-white hover:bg-slate-700/50 rounded-lg transition-all disabled:opacity-50"
                        title="Обновить"
                    >
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    </button>
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
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
                        <StatCard icon={<Users className="w-5 h-5" />} label="Посетители" value={overview.unique_visitors} color="indigo" />
                        <StatCard icon={<Clock className="w-5 h-5" />} label="Онлайн" value={overview.online_now} color="green" pulse />
                        <StatCard icon={<Eye className="w-5 h-5" />} label="Просмотры" value={overview.product_views} color="blue" />
                        <StatCard icon={<Heart className="w-5 h-5" />} label="Избранное" value={overview.add_to_favorites} color="pink" />
                        <StatCard icon={<ShoppingCart className="w-5 h-5" />} label="В корзину" value={overview.add_to_cart} color="amber" />
                        <StatCard icon={<Package className="w-5 h-5" />} label="Заказов" value={overview.order_submit} color="emerald" />
                    </div>
                )}

                {/* Quick Stats Row */}
                {overview && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
                            <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
                                <TrendingUp className="w-3.5 h-3.5" />
                                Просмотры страниц
                            </div>
                            <p className="text-2xl font-bold text-slate-100">{overview.page_views.toLocaleString()}</p>
                        </div>
                        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
                            <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
                                <MessageCircle className="w-3.5 h-3.5" />
                                Спросить у менеджера
                            </div>
                            <p className="text-2xl font-bold text-slate-100">{overview.ask_manager}</p>
                        </div>
                        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
                            <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
                                <BarChart3 className="w-3.5 h-3.5" />
                                Всего событий
                            </div>
                            <p className="text-2xl font-bold text-slate-100">{overview.total_events.toLocaleString()}</p>
                        </div>
                        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
                            <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
                                <Eye className="w-3.5 h-3.5" />
                                Конверсия в корзину
                            </div>
                            <p className="text-2xl font-bold text-slate-100">
                                {overview.product_views > 0 ? ((overview.add_to_cart / overview.product_views) * 100).toFixed(1) : 0}%
                            </p>
                        </div>
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
        indigo: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
        green: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
        blue: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
        pink: 'bg-pink-500/10 text-pink-400 border-pink-500/20',
        amber: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
        emerald: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    }

    return (
        <div className={`rounded-xl border p-4 ${colorMap[color] || colorMap.indigo}`}>
            <div className="flex items-center gap-2 mb-2">
                {icon}
                <span className="text-xs font-medium opacity-80">{label}</span>
                {pulse && value > 0 && (
                    <span className="relative flex h-2 w-2 ml-auto">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
                    </span>
                )}
            </div>
            <p className="text-3xl font-bold">{value.toLocaleString()}</p>
        </div>
    )
}

function ProductTable({ title, data, columns }: {
    title: string
    data: ProductStat[]
    columns: { key: keyof ProductStat; label: string }[]
}) {
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
                            <tr key={item.product_id} className="hover:bg-slate-700/20 transition-colors">
                                <td className="px-6 py-3 text-sm text-slate-500 font-mono">{i + 1}</td>
                                <td className="px-6 py-3">
                                    <div className="text-sm font-medium text-slate-200 truncate max-w-xs">{item.product_name}</div>
                                    <div className="text-xs text-slate-500 font-mono">{item.product_id}</div>
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
