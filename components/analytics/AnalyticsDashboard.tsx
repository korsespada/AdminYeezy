'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
    ArrowLeft,
    BarChart3,
    ChevronDown,
    Clock,
    Eye,
    Globe2,
    Heart,
    MessageCircle,
    RefreshCw,
    ShoppingCart,
    Trash2,
    UserCheck,
    UserPlus,
    Users,
    Wifi,
} from 'lucide-react'
import Link from 'next/link'
import AnalyticsCharts from './AnalyticsCharts'
import { type Brand, type Category, type Subcategory } from '@/lib/types'

type Period = 'today' | 'week' | 'month' | 'all'

interface OverviewStats {
    unique_visitors: number
    online_now: number
    total_events: number
    page_views: number
    product_views: number
    unique_product_views: number
    viewed_products: number
    unique_product_viewers: number
    ask_manager: number
    new_profiles: number
    total_profiles: number
    active_profiles: number
    returning_profiles: number
    returning_visitors: number
    cart_profiles: number
    cart_items: number
    favorite_profiles: number
    favorite_items: number
}

interface SeriesData {
    date: string
    visitors?: number
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

const periodLabels: Record<Period, string> = {
    today: 'Сегодня',
    week: '7 дней',
    month: '30 дней',
    all: 'Все время',
}

const emptyOverview: OverviewStats = {
    unique_visitors: 0,
    online_now: 0,
    total_events: 0,
    page_views: 0,
    product_views: 0,
    unique_product_views: 0,
    viewed_products: 0,
    unique_product_viewers: 0,
    ask_manager: 0,
    new_profiles: 0,
    total_profiles: 0,
    active_profiles: 0,
    returning_profiles: 0,
    returning_visitors: 0,
    cart_profiles: 0,
    cart_items: 0,
    favorite_profiles: 0,
    favorite_items: 0,
}

const formatNumber = (value: number) => value.toLocaleString('ru-RU')

const formatPercent = (value: number, base: number) => {
    if (!base) return '0%'
    return `${((value / base) * 100).toFixed(1)}%`
}

export default function AnalyticsDashboard(_props: AnalyticsDashboardProps) {
    const [period, setPeriod] = useState<Period>('today')
    const [overview, setOverview] = useState<OverviewStats | null>(null)
    const [seriesData, setSeriesData] = useState<SeriesData[]>([])
    const [countryList, setCountryList] = useState<{ name: string; visitors: number }[]>([])
    const [osList, setOsList] = useState<{ name: string; visitors: number }[]>([])
    const [updatedAt, setUpdatedAt] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [isResetMenuOpen, setIsResetMenuOpen] = useState(false)
    const [isResetting, setIsResetting] = useState(false)

    const data = overview || emptyOverview

    const fetchData = useCallback(async () => {
        setLoading(true)
        setError(null)

        try {
            const res = await fetch(`/api/analytics?period=${period}`)
            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: 'Ошибка сервера' }))
                throw new Error(err.error || `HTTP ${res.status}`)
            }

            const payload = await res.json()
            setOverview({ ...emptyOverview, ...(payload.overview || {}) })
            setSeriesData(payload.seriesData || [])
            setCountryList(payload.countryList || [])
            setOsList(payload.osList || [])
            setUpdatedAt(payload.updatedAt || new Date().toISOString())
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

    const handleReset = async (type: 'period' | 'all') => {
        const scope = type === 'all' ? 'за все время' : `за период "${periodLabels[period]}"`
        if (!confirm(`Сбросить аналитику ${scope}? Это действие нельзя отменить.`)) return

        setIsResetting(true)
        try {
            const res = await fetch(`/api/analytics?type=${type}&period=${period}`, { method: 'DELETE' })
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

    const updatedLabel = updatedAt
        ? new Date(updatedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
        : 'нет данных'

    const derived = useMemo(() => ({
        returningShare: formatPercent(data.returning_profiles || data.returning_visitors, data.active_profiles || data.unique_visitors),
        productDepth: data.unique_product_viewers ? (data.unique_product_views / data.unique_product_viewers).toFixed(1) : '0',
        askRate: formatPercent(data.ask_manager, data.unique_product_views || data.product_views),
        cartShare: formatPercent(data.cart_profiles, data.total_profiles),
        favoriteShare: formatPercent(data.favorite_profiles, data.total_profiles),
    }), [data])

    return (
        <div className="min-h-screen bg-slate-950 text-slate-200">
            <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-950/95 px-4 py-3 backdrop-blur sm:px-6">
                <div className="mx-auto flex max-w-[1600px] flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                    <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                            <Link href="/admin" className="rounded-lg border border-slate-800 p-2 text-slate-400 transition hover:border-slate-700 hover:bg-slate-900 hover:text-white" title="Назад">
                                <ArrowLeft className="h-5 w-5" />
                            </Link>
                            <div>
                                <h1 className="flex items-center gap-2 text-xl font-semibold text-white sm:text-2xl">
                                    <BarChart3 className="h-6 w-6 text-blue-400" />
                                    Аналитика аудитории
                                </h1>
                                <p className="text-xs text-slate-500">Онлайн, пользователи, просмотры товаров, обращения и география</p>
                            </div>
                        </div>
                        <button
                            onClick={fetchData}
                            disabled={loading || isResetting}
                            className="rounded-lg border border-slate-800 p-2 text-slate-400 transition hover:border-blue-500/40 hover:bg-blue-500/10 hover:text-blue-300 disabled:opacity-50 xl:hidden"
                            title="Обновить"
                        >
                            <RefreshCw className={`h-5 w-5 ${loading || isResetting ? 'animate-spin' : ''}`} />
                        </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <div className="flex rounded-lg border border-slate-800 bg-slate-900 p-1">
                            {(Object.keys(periodLabels) as Period[]).map(item => (
                                <button
                                    key={item}
                                    onClick={() => setPeriod(item)}
                                    className={`rounded-md px-3 py-2 text-sm font-medium transition ${period === item ? 'bg-blue-500 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'}`}
                                >
                                    {periodLabels[item]}
                                </button>
                            ))}
                        </div>
                        <div className="hidden items-center gap-2 rounded-lg border border-slate-800 px-3 py-2 text-sm text-slate-400 md:flex">
                            <Clock className="h-4 w-4" />
                            {updatedLabel}
                        </div>
                        <button
                            onClick={fetchData}
                            disabled={loading || isResetting}
                            className="hidden rounded-lg border border-slate-800 p-2 text-slate-400 transition hover:border-blue-500/40 hover:bg-blue-500/10 hover:text-blue-300 disabled:opacity-50 xl:block"
                            title="Обновить"
                        >
                            <RefreshCw className={`h-5 w-5 ${loading || isResetting ? 'animate-spin' : ''}`} />
                        </button>
                        <div className="relative">
                            <button
                                onClick={() => setIsResetMenuOpen(!isResetMenuOpen)}
                                disabled={isResetting}
                                className="flex items-center gap-2 rounded-lg border border-red-500/30 px-3 py-2 text-sm font-medium text-red-300 transition hover:bg-red-500/10 disabled:opacity-50"
                            >
                                <Trash2 className="h-4 w-4" />
                                Сброс
                                <ChevronDown className={`h-4 w-4 transition ${isResetMenuOpen ? 'rotate-180' : ''}`} />
                            </button>
                            {isResetMenuOpen && (
                                <>
                                    <div className="fixed inset-0 z-40" onClick={() => setIsResetMenuOpen(false)} />
                                    <div className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-lg border border-slate-800 bg-slate-900 shadow-2xl">
                                        <button
                                            onClick={() => {
                                                handleReset('period')
                                                setIsResetMenuOpen(false)
                                            }}
                                            className="block w-full px-4 py-3 text-left text-sm text-slate-200 hover:bg-slate-800"
                                        >
                                            Очистить {periodLabels[period].toLowerCase()}
                                        </button>
                                        <button
                                            onClick={() => {
                                                handleReset('all')
                                                setIsResetMenuOpen(false)
                                            }}
                                            className="block w-full border-t border-slate-800 px-4 py-3 text-left text-sm font-semibold text-red-300 hover:bg-red-500/10"
                                        >
                                            Очистить все время
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </header>

            <main className="mx-auto max-w-[1600px] space-y-6 p-4 sm:p-6">
                {error && (
                    <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-sm font-medium text-red-300">
                        {error}
                    </div>
                )}

                <section className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-5">
                    <KpiCard icon={<Wifi />} label="Текущий онлайн" value={data.online_now} detail="Активны за последние 5 минут" tone="emerald" loading={loading} />
                    <KpiCard icon={<Users />} label="Уникальные пользователи" value={data.unique_visitors} detail={`${data.active_profiles ? `${formatNumber(data.active_profiles)} профилей активны` : 'По сессиям аналитики'}`} tone="blue" loading={loading} />
                    <KpiCard icon={<UserCheck />} label="Постоянные пользователи" value={data.returning_profiles || data.returning_visitors} detail={`${derived.returningShare} от активной базы`} tone="violet" loading={loading} />
                    <KpiCard icon={<Eye />} label="Уникальные просмотры товаров" value={data.unique_product_views} detail={`${formatNumber(data.viewed_products)} разных товаров`} tone="cyan" loading={loading} />
                    <KpiCard icon={<MessageCircle />} label="Спросить у менеджера" value={data.ask_manager} detail={`${derived.askRate} от просмотров`} tone="amber" loading={loading} />
                </section>

                <section className="grid grid-cols-1 gap-4 xl:grid-cols-12">
                    <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-5 shadow-xl xl:col-span-8">
                        <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                                <h2 className="text-lg font-semibold text-white">Сводка за период</h2>
                                <p className="text-sm text-slate-400">Фокус на людях и действиях, без товарного рейтинга.</p>
                            </div>
                            <span className="w-fit rounded-md bg-blue-500/10 px-2.5 py-1 text-xs font-semibold text-blue-300">
                                {periodLabels[period]}
                            </span>
                        </div>

                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                            <InsightItem label="Новые профили" value={formatNumber(data.new_profiles)} caption={`Всего профилей: ${formatNumber(data.total_profiles)}`} icon={<UserPlus className="h-4 w-4" />} />
                            <InsightItem label="Глубина просмотра" value={derived.productDepth} caption="Уникальных товаров на зрителя" icon={<Eye className="h-4 w-4" />} />
                            <InsightItem label="В корзине сейчас" value={formatNumber(data.cart_items)} caption={`${formatNumber(data.cart_profiles)} пользователей, ${derived.cartShare}`} icon={<ShoppingCart className="h-4 w-4" />} />
                            <InsightItem label="В избранном сейчас" value={formatNumber(data.favorite_items)} caption={`${formatNumber(data.favorite_profiles)} пользователей, ${derived.favoriteShare}`} icon={<Heart className="h-4 w-4" />} />
                        </div>
                    </div>

                    <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-5 shadow-xl xl:col-span-4">
                        <div className="mb-4 flex items-center justify-between">
                            <div>
                                <h2 className="text-lg font-semibold text-white">Пульс</h2>
                                <p className="text-sm text-slate-400">Посетители, просмотры и обращения.</p>
                            </div>
                            <RefreshCw className={`h-5 w-5 text-slate-500 ${loading ? 'animate-spin' : ''}`} />
                        </div>
                        <div className="h-[230px]">
                            {seriesData.length ? (
                                <AnalyticsCharts seriesData={seriesData} overview={data} minimal />
                            ) : (
                                <EmptyState text="Нет данных для графика" />
                            )}
                        </div>
                    </div>
                </section>

                <AnalyticsCharts seriesData={seriesData} overview={data} />

                <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                    <CountryList items={countryList.map(item => ({ ...item, name: getDisplayName(item.name) }))} />
                    <SimpleList title="Устройства" items={osList} empty="Нет данных по устройствам" />
                    <ProfileState overview={data} />
                </section>
            </main>
        </div>
    )
}

function KpiCard({ icon, label, value, detail, tone, loading }: {
    icon: React.ReactNode
    label: string
    value: number
    detail: string
    tone: 'emerald' | 'blue' | 'violet' | 'cyan' | 'amber'
    loading?: boolean
}) {
    const tones = {
        emerald: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
        blue: 'bg-blue-500/10 text-blue-300 border-blue-500/20',
        violet: 'bg-violet-500/10 text-violet-300 border-violet-500/20',
        cyan: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/20',
        amber: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
    }

    return (
        <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
                <div className={`rounded-lg border p-2 ${tones[tone]}`}>
                    {React.cloneElement(icon as React.ReactElement, { className: 'h-5 w-5' })}
                </div>
                {loading && <RefreshCw className="h-4 w-4 animate-spin text-slate-600" />}
            </div>
            <div className="text-3xl font-semibold text-white">{formatNumber(value)}</div>
            <div className="mt-1 text-sm font-medium text-slate-300">{label}</div>
            <div className="mt-3 text-xs text-slate-500">{detail}</div>
        </div>
    )
}

function InsightItem({ label, value, caption, icon }: { label: string; value: string; caption: string; icon: React.ReactNode }) {
    return (
        <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-4">
            <div className="mb-3 flex items-center justify-between text-slate-500">
                <span className="text-sm">{label}</span>
                {icon}
            </div>
            <div className="text-2xl font-semibold text-white">{value}</div>
            <div className="mt-1 text-xs text-slate-500">{caption}</div>
        </div>
    )
}

function CountryList({ items }: { items: { name: string; visitors: number }[] }) {
    const total = Math.max(1, items.reduce((sum, item) => sum + Number(item.visitors || 0), 0))

    return (
        <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white">Посещения по странам</h3>
                <Globe2 className="h-5 w-5 text-blue-300" />
            </div>
            {items.length ? (
                <div className="space-y-4">
                    {items.slice(0, 10).map((item, index) => (
                        <ProgressRow key={`${item.name}-${index}`} label={item.name || 'Неизвестно'} value={Number(item.visitors || 0)} total={total} />
                    ))}
                </div>
            ) : (
                <EmptyState text="Нет данных по странам" />
            )}
        </div>
    )
}

function SimpleList({ title, items, empty }: {
    title: string
    empty: string
    items: { name: string; visitors: number }[]
}) {
    const total = Math.max(1, items.reduce((sum, item) => sum + Number(item.visitors || 0), 0))

    return (
        <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-5 shadow-xl">
            <h3 className="mb-4 text-lg font-semibold text-white">{title}</h3>
            {items.length ? (
                <div className="space-y-4">
                    {items.slice(0, 5).map((item, index) => (
                        <ProgressRow key={`${item.name}-${index}`} label={item.name || 'Неизвестно'} value={Number(item.visitors || 0)} total={total} />
                    ))}
                </div>
            ) : (
                <EmptyState text={empty} />
            )}
        </div>
    )
}

function ProfileState({ overview }: { overview: OverviewStats }) {
    const total = Math.max(1, overview.total_profiles)

    return (
        <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-5 shadow-xl">
            <h3 className="mb-4 text-lg font-semibold text-white">Состояние клиентской базы</h3>
            <div className="space-y-4">
                <ProgressRow label="Активные профили" value={overview.active_profiles} total={total} />
                <ProgressRow label="Постоянные профили" value={overview.returning_profiles} total={total} />
                <ProgressRow label="Есть корзина" value={overview.cart_profiles} total={total} />
                <ProgressRow label="Есть избранное" value={overview.favorite_profiles} total={total} />
            </div>
        </div>
    )
}

function ProgressRow({ label, value, total }: { label: string; value: number; total: number }) {
    return (
        <div>
            <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                <span className="truncate text-slate-300">{label}</span>
                <span className="font-semibold text-white">{formatNumber(value)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                <div className="h-full rounded-full bg-blue-400" style={{ width: `${Math.min(100, (value / total) * 100)}%` }} />
            </div>
        </div>
    )
}

function EmptyState({ text }: { text: string }) {
    return (
        <div className="flex h-full min-h-32 items-center justify-center rounded-lg border border-dashed border-slate-800 bg-slate-950/40 p-6 text-center text-sm font-medium text-slate-500">
            {text}
        </div>
    )
}

function getDisplayName(name: string) {
    const map: Record<string, string> = {
        Unknown: 'Неизвестно',
        'Russian Federation': 'Россия',
        Russia: 'Россия',
        RU: 'Россия',
        'United States': 'США',
        US: 'США',
        Germany: 'Германия',
        DE: 'Германия',
        Belarus: 'Беларусь',
        BY: 'Беларусь',
        Kazakhstan: 'Казахстан',
        KZ: 'Казахстан',
        Ukraine: 'Украина',
        UA: 'Украина',
    }

    return map[name] || name || 'Неизвестно'
}
