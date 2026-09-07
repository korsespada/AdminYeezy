'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
    Activity,
    ArrowLeft,
    BarChart3,
    Calendar,
    CheckCircle2,
    ChevronDown,
    ChevronUp,
    Clock,
    DollarSign,
    ExternalLink,
    Eye,
    Globe2,
    Laptop,
    Monitor,
    MoreVertical,
    Package,
    Receipt,
    RefreshCw,
    Search,
    ShoppingBag,
    ShoppingCart,
    Smartphone,
    Trash2,
    TrendingUp,
    Users,
} from 'lucide-react'
import Link from 'next/link'
import AnalyticsCharts, { type SeriesData } from './AnalyticsCharts'
import { type Brand, type Category, type Subcategory } from '@/lib/types'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

type Period = 'today' | 'yesterday' | 'week' | 'month' | 'all' | 'custom'
type Channel = 'all' | 'site' | 'site_desktop' | 'site_mobile' | 'telegram'

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
    new_visitors?: number
    cart_profiles: number
    cart_items: number
    favorite_profiles: number
    favorite_items: number
    site_clicks: number
    tg_site_clicks: number
}

interface FinancialStats {
    revenue: number
    paid_orders: number
    pending_orders: number
    cancelled_orders: number
    refund_orders: number
    new_buyers?: number
    repeat_buyers?: number
    aov: number
    status_counts: Record<string, number>
}

interface FunnelStep {
    step: string
    count: number
    rate: number
    stepConversion?: number
    dropOff?: number
}

interface TopProductItem {
    id: string
    name: string
    brand?: string
    category?: string
    price?: number
    views?: number
    unique_views?: number
    carts?: number
}

interface TrafficSourceItem {
    name: string
    visitors: number
    views: number
    carts: number
    checkouts: number
    purchases: number
    cartRate: number
    checkoutRate: number
}

interface SearchDemandItem {
    query: string
    searches: number
    unique_users: number
}

interface ExternalIntegrations {
    yandexMetrika: {
        configured: boolean
        counterId: string | null
        apiActive?: boolean
        stats?: {
            users: number
            pageviews: number
            bounceRate: number
            avgDurationSeconds: number
        } | null
    }
    yandexWebmaster?: {
        configured: boolean
        siteUrl: string
    }
    googleSearchConsole?: {
        configured: boolean
        property: string
    }
    googleMerchantCenter?: {
        configured: boolean
        accountId: string
    }
    googleAnalytics: {
        configured: boolean
        tagId: string | null
    }
}

interface AnalyticsDashboardProps {
    brands?: Brand[]
    categories?: Category[]
    subcategories?: Subcategory[]
}

const periodLabels: Record<Period, string> = {
    today: 'Сегодня',
    yesterday: 'Вчера',
    week: '7 дней',
    month: '30 дней',
    all: 'Все время',
    custom: 'Период',
}

const channelLabels: Record<Channel, string> = {
    all: 'Все каналы',
    site: 'Сайт (все)',
    site_desktop: 'Сайт: Десктоп',
    site_mobile: 'Сайт: Мобайл',
    telegram: 'TG Mini App',
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
    new_visitors: 0,
    cart_profiles: 0,
    cart_items: 0,
    favorite_profiles: 0,
    favorite_items: 0,
    site_clicks: 0,
    tg_site_clicks: 0,
}

const emptyFinancial: FinancialStats = {
    revenue: 0,
    paid_orders: 0,
    pending_orders: 0,
    cancelled_orders: 0,
    refund_orders: 0,
    new_buyers: 0,
    repeat_buyers: 0,
    aov: 0,
    status_counts: {},
}

const formatNumber = (value: number) => (Number(value) || 0).toLocaleString('ru-RU')

const formatCurrency = (value: number) => `${formatNumber(value)} ₽`

const formatPercent = (value: number, base: number) => {
    if (!base) return '0%'
    return `${((value / base) * 100).toFixed(1)}%`
}

const analyticsFetchTimeoutMs = 12_000

export default function AnalyticsDashboard(_props: AnalyticsDashboardProps) {
    void _props

    const [period, setPeriod] = useState<Period>('today')
    const [customFrom, setCustomFrom] = useState('')
    const [customTo, setCustomTo] = useState('')
    const [channel, setChannel] = useState<Channel>('all')
    const [overview, setOverview] = useState<OverviewStats | null>(null)
    const [financial, setFinancial] = useState<FinancialStats>(emptyFinancial)
    const [funnel, setFunnel] = useState<FunnelStep[]>([])
    const [seriesData, setSeriesData] = useState<SeriesData[]>([])
    const [countryList, setCountryList] = useState<{ name: string; visitors: number }[]>([])
    const [osList, setOsList] = useState<{ name: string; visitors: number }[]>([])
    const [deviceList, setDeviceList] = useState<{ name: string; visitors: number }[]>([])
    const [topProducts, setTopProducts] = useState<TopProductItem[]>([])
    const [topCart, setTopCart] = useState<TopProductItem[]>([])
    const [externalIntegrations, setExternalIntegrations] = useState<ExternalIntegrations | null>(null)
    const [trafficSources, setTrafficSources] = useState<TrafficSourceItem[]>([])
    const [searchDemands, setSearchDemands] = useState<SearchDemandItem[]>([])
    const [updatedAt, setUpdatedAt] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [isResetMenuOpen, setIsResetMenuOpen] = useState(false)
    const [isResetting, setIsResetting] = useState(false)
    const [isCustomOpen, setIsCustomOpen] = useState(false)
    const [isDetailsOpen, setIsDetailsOpen] = useState(false)

    const data = overview || emptyOverview

    const fetchData = useCallback(async () => {
        setLoading(true)
        setError(null)

        try {
            const params = new URLSearchParams({ period, channel })
            if (period === 'custom' && customFrom) {
                params.set('from', customFrom)
                if (customTo) params.set('to', customTo)
            }

            const controller = new AbortController()
            const timeout = window.setTimeout(() => controller.abort(), analyticsFetchTimeoutMs)
            const res = await fetch(`/api/analytics?${params.toString()}`, { signal: controller.signal })
                .finally(() => window.clearTimeout(timeout))

            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: 'Ошибка сервера' }))
                setError(err.error || `HTTP ${res.status}`)
                return
            }

            const payload = await res.json()
            setOverview({ ...emptyOverview, ...(payload.overview || {}) })
            setFinancial({ ...emptyFinancial, ...(payload.financial || {}) })
            setFunnel(payload.funnel || [])
            setSeriesData(payload.seriesData || [])
            setCountryList(payload.countryList || [])
            setOsList(payload.osList || [])
            setDeviceList(payload.deviceList || [])
            setTopProducts(payload.topProducts || [])
            setTopCart(payload.topCart || [])
            setTrafficSources(payload.trafficSources || [])
            setSearchDemands(payload.searchDemands || [])
            setExternalIntegrations(payload.externalIntegrations || null)
            setUpdatedAt(payload.updatedAt || new Date().toISOString())
        } catch (err: any) {
            setError(err?.name === 'AbortError' ? 'Таймаут загрузки аналитики' : err?.message || 'Ошибка загрузки аналитики')
        } finally {
            setLoading(false)
        }
    }, [channel, period, customFrom, customTo])

    useEffect(() => {
        fetchData()
        const interval = setInterval(fetchData, 30_000)
        return () => clearInterval(interval)
    }, [fetchData])

    const handleApplyCustomDates = (e: React.FormEvent) => {
        e.preventDefault()
        if (!customFrom) return
        setPeriod('custom')
        setIsCustomOpen(false)
    }

    const handleReset = async (type: 'period' | 'all') => {
        const scope = type === 'all' ? 'за все время' : `за период "${periodLabels[period]}"`
        const channelScope = channel === 'all' ? 'по всем каналам' : `для канала "${channelLabels[channel]}"`
        if (!confirm(`Сбросить аналитику ${scope} ${channelScope}? Это действие нельзя отменить.`)) return

        setIsResetting(true)
        try {
            const params = new URLSearchParams({ type, period, channel })
            if (period === 'custom' && customFrom) {
                params.set('from', customFrom)
                if (customTo) params.set('to', customTo)
            }
            const res = await fetch(`/api/analytics?${params.toString()}`, { method: 'DELETE' })
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

    const activePeriodDisplay = period === 'custom' && customFrom
        ? `${customFrom}${customTo ? ` — ${customTo}` : ''}`
        : periodLabels[period]

    // New vs Returning visitor percentages
    const totalVisitorsCount = (data.new_visitors || 0) + (data.returning_visitors || 0)
    const newVisitorsPercent = totalVisitorsCount > 0
        ? Math.round(((data.new_visitors || 0) / totalVisitorsCount) * 100)
        : (data.unique_visitors > 0 ? 100 : 50)
    const returningVisitorsPercent = 100 - newVisitorsPercent

    // CRM New vs Repeat buyers percentages
    const totalBuyersCount = (financial.new_buyers || 0) + (financial.repeat_buyers || 0)
    const newBuyersPercent = totalBuyersCount > 0
        ? Math.round(((financial.new_buyers || 0) / totalBuyersCount) * 100)
        : 100
    const repeatBuyersPercent = 100 - newBuyersPercent

    // Devices percentage
    const totalDeviceVis = deviceList.reduce((acc, d) => acc + Number(d.visitors || 0), 0) || 1
    const mobileVis = deviceList.find(d => {
        const n = (d.name || '').toLowerCase()
        return n.includes('моб') || n.includes('тел') || n.includes('phone') || n.includes('mobile')
    })?.visitors || 0
    const mobilePercent = Math.min(100, Math.round((Number(mobileVis) / totalDeviceVis) * 100))
    const desktopPercent = 100 - mobilePercent

    return (
        <div className="mx-auto max-w-[1600px] space-y-6 p-4 sm:p-6">
            {/* Header */}
            <section className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex items-start gap-3">
                    <Button asChild variant="outline" size="icon" title="Назад">
                        <Link href="/admin">
                            <ArrowLeft className="h-5 w-5" />
                        </Link>
                    </Button>
                    <div>
                        <div className="flex items-center gap-3">
                            <h1 className="flex items-center gap-2 text-2xl font-semibold text-foreground">
                                <BarChart3 className="h-6 w-6 text-primary" />
                                Аналитика каталога и продаж
                            </h1>
                            <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold">
                                <span className="relative flex h-2 w-2">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                                </span>
                                Онлайн: {data.online_now}
                            </div>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                            Сайт (десктоп/мобайл) и TG Mini App: трафик, источники, поисковый спрос и конверсии.
                        </p>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    {/* Channel Selector */}
                    <Tabs value={channel} onValueChange={(value) => setChannel(value as Channel)}>
                        <TabsList className="border border-border bg-muted">
                            {(Object.keys(channelLabels) as Channel[]).map(item => (
                                <TabsTrigger key={item} value={item} className="gap-1.5 data-[state=active]:bg-background text-xs sm:text-sm">
                                    {item === 'site' && <Monitor className="h-3.5 w-3.5" />}
                                    {item === 'site_desktop' && <Laptop className="h-3.5 w-3.5" />}
                                    {item === 'site_mobile' && <Smartphone className="h-3.5 w-3.5" />}
                                    {item === 'telegram' && <Smartphone className="h-3.5 w-3.5" />}
                                    {channelLabels[item]}
                                </TabsTrigger>
                            ))}
                        </TabsList>
                    </Tabs>

                    {/* Period Selector */}
                    <Tabs value={period} onValueChange={(value) => {
                        if (value === 'custom') {
                            setIsCustomOpen(true)
                        } else {
                            setPeriod(value as Period)
                        }
                    }}>
                        <TabsList className="border border-border bg-muted">
                            {(['today', 'yesterday', 'week', 'month', 'all'] as Period[]).map(item => (
                                <TabsTrigger key={item} value={item} className="data-[state=active]:bg-background text-xs sm:text-sm">
                                    {periodLabels[item]}
                                </TabsTrigger>
                            ))}
                            <TabsTrigger value="custom" className="gap-1 data-[state=active]:bg-background text-xs sm:text-sm">
                                <Calendar className="h-3.5 w-3.5" />
                                {period === 'custom' && customFrom ? activePeriodDisplay : 'Период'}
                            </TabsTrigger>
                        </TabsList>
                    </Tabs>

                    <div className="hidden items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground md:flex">
                        <Clock className="h-4 w-4" />
                        {updatedLabel}
                    </div>

                    <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={fetchData}
                        disabled={loading || isResetting}
                        title="Обновить"
                    >
                        <RefreshCw className={`h-5 w-5 ${loading || isResetting ? 'animate-spin' : ''}`} />
                    </Button>

                    <DropdownMenu open={isResetMenuOpen} onOpenChange={setIsResetMenuOpen}>
                        <DropdownMenuTrigger asChild>
                            <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                disabled={isResetting}
                                title="Опции и сброс аналитики"
                                className="text-muted-foreground hover:text-foreground"
                            >
                                <MoreVertical className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-64">
                            <DropdownMenuItem onClick={() => handleReset('period')}>
                                <Trash2 className="mr-2 h-4 w-4 text-muted-foreground" />
                                Очистить {periodLabels[period].toLowerCase()}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                                onClick={() => handleReset('all')}
                                className="font-semibold text-destructive focus:text-destructive"
                            >
                                <Trash2 className="mr-2 h-4 w-4 text-destructive" />
                                Очистить все время
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </section>

            {/* Custom Date Range Modal */}
            {isCustomOpen && (
                <Card className="border-primary/40 bg-card/95 shadow-xl">
                    <CardHeader className="p-4 pb-2">
                        <CardTitle className="text-base flex items-center gap-2">
                            <Calendar className="h-4 w-4 text-primary" />
                            Выбор произвольного диапазона дат
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                        <form onSubmit={handleApplyCustomDates} className="flex flex-wrap items-center gap-3">
                            <div className="flex items-center gap-2 text-sm">
                                <span className="text-muted-foreground">С:</span>
                                <Input
                                    type="date"
                                    value={customFrom}
                                    onChange={(e) => setCustomFrom(e.target.value)}
                                    required
                                    className="w-40 bg-background"
                                />
                            </div>
                            <div className="flex items-center gap-2 text-sm">
                                <span className="text-muted-foreground">По:</span>
                                <Input
                                    type="date"
                                    value={customTo}
                                    onChange={(e) => setCustomTo(e.target.value)}
                                    className="w-40 bg-background"
                                />
                            </div>
                            <Button type="submit" size="sm">Применить</Button>
                            <Button type="button" variant="ghost" size="sm" onClick={() => setIsCustomOpen(false)}>
                                Отмена
                            </Button>
                        </form>
                    </CardContent>
                </Card>
            )}

            {error && (
                <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            )}

            {/* ============================================================
                1. TOP SECTION: 3-COLUMN HERO GRID (PULSE, SOURCES, TECH/GEO)
               ============================================================ */}
            <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                {/* Column 1: Живой пульс и Аудитория */}
                <Card className="flex flex-col justify-between border-border/80 bg-gradient-to-br from-card to-card/60 shadow-sm">
                    <CardHeader className="p-5 pb-3">
                        <div className="flex items-center justify-between">
                            <CardTitle className="text-base font-semibold flex items-center gap-2 text-foreground">
                                <Activity className="h-4 w-4 text-emerald-400" />
                                Пульс и Аудитория
                            </CardTitle>
                            <span className="text-xs text-muted-foreground">{activePeriodDisplay}</span>
                        </div>
                        <CardDescription>Посещаемость, новые и вернувшиеся пользователи</CardDescription>
                    </CardHeader>
                    <CardContent className="p-5 pt-0 space-y-4">
                        <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-muted/40 border border-border/50">
                            <div>
                                <div className="text-[11px] text-muted-foreground">Всего визитов</div>
                                <div className="text-2xl font-bold text-foreground">{formatNumber(data.unique_visitors)}</div>
                            </div>
                            <div>
                                <div className="text-[11px] text-muted-foreground">Просмотров страниц</div>
                                <div className="text-2xl font-bold text-foreground">{formatNumber(data.page_views || data.total_events)}</div>
                            </div>
                        </div>

                        {/* Новые vs Вернувшиеся (трафик) */}
                        <div className="space-y-1.5">
                            <div className="flex items-center justify-between text-xs">
                                <span className="text-muted-foreground flex items-center gap-1.5">
                                    <Users className="h-3.5 w-3.5 text-blue-400" /> Посетители витрины:
                                </span>
                                <span className="text-foreground font-medium text-[11px]">
                                    Новые <strong className="text-foreground">{formatNumber(data.new_visitors || 0)}</strong> / Постоянные <strong className="text-foreground">{formatNumber(data.returning_visitors || 0)}</strong>
                                </span>
                            </div>
                            <div className="h-2 w-full overflow-hidden rounded-full bg-muted flex">
                                <div
                                    className="bg-blue-500 transition-all"
                                    style={{ width: `${newVisitorsPercent}%` }}
                                    title={`Новые: ${newVisitorsPercent}%`}
                                />
                                <div
                                    className="bg-violet-500 transition-all"
                                    style={{ width: `${returningVisitorsPercent}%` }}
                                    title={`Вернувшиеся: ${returningVisitorsPercent}%`}
                                />
                            </div>
                            <div className="flex justify-between text-[10px] text-muted-foreground">
                                <span>Впервые: {newVisitorsPercent}%</span>
                                <span>Вернулись: {returningVisitorsPercent}%</span>
                            </div>
                        </div>

                        {/* Новые vs Постоянные (CRM покупатели) */}
                        <div className="space-y-1.5 pt-3 border-t border-border/40">
                            <div className="flex items-center justify-between text-xs">
                                <span className="text-muted-foreground flex items-center gap-1.5">
                                    <ShoppingBag className="h-3.5 w-3.5 text-emerald-400" /> Покупатели в заказах (CRM):
                                </span>
                                <span className="text-foreground font-medium text-[11px]">
                                    1-й заказ <strong className="text-emerald-400">{financial.new_buyers ?? 0}</strong> / Повторные <strong className="text-amber-400">{financial.repeat_buyers ?? 0}</strong>
                                </span>
                            </div>
                            <div className="h-2 w-full overflow-hidden rounded-full bg-muted flex">
                                <div
                                    className="bg-emerald-500 transition-all"
                                    style={{ width: `${newBuyersPercent}%` }}
                                    title={`Первый заказ: ${newBuyersPercent}%`}
                                />
                                <div
                                    className="bg-amber-500 transition-all"
                                    style={{ width: `${repeatBuyersPercent}%` }}
                                    title={`Повторные заказы: ${repeatBuyersPercent}%`}
                                />
                            </div>
                            <div className="flex justify-between text-[10px] text-muted-foreground">
                                <span>Новые клиенты: {newBuyersPercent}%</span>
                                <span>Постоянные клиенты: {repeatBuyersPercent}%</span>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Column 2: Источники трафика (Яндекс, Google, TG, Direct) */}
                <Card className="flex flex-col justify-between border-border/80 bg-gradient-to-br from-card to-card/60 shadow-sm">
                    <CardHeader className="p-5 pb-3">
                        <div className="flex items-center justify-between">
                            <CardTitle className="text-base font-semibold flex items-center gap-2 text-foreground">
                                <TrendingUp className="h-4 w-4 text-blue-400" />
                                Источники трафика
                            </CardTitle>
                            <Badge variant="outline" className="text-xs font-normal">
                                {channelLabels[channel]}
                            </Badge>
                        </div>
                        <CardDescription>Доли переходов, корзины и заказы по каналам</CardDescription>
                    </CardHeader>
                    <CardContent className="p-5 pt-0 space-y-2.5">
                        {trafficSources.length > 0 ? (
                            trafficSources.slice(0, 4).map((src) => {
                                const isYandex = src.name.includes('Яндекс')
                                const isGoogle = src.name.includes('Google')
                                const isTg = src.name.includes('Telegram')
                                const totalVis = trafficSources.reduce((acc, s) => acc + s.visitors, 0) || 1
                                const share = Math.round((src.visitors / totalVis) * 100)

                                return (
                                    <div key={src.name} className="p-2.5 rounded-lg border border-border/60 bg-background/50 space-y-1.5">
                                        <div className="flex items-center justify-between text-xs">
                                            <div className="flex items-center gap-2 font-medium text-foreground">
                                                <span className={`h-2 w-2 rounded-full ${isYandex ? 'bg-amber-400' : isGoogle ? 'bg-blue-400' : isTg ? 'bg-cyan-400' : 'bg-muted-foreground'}`} />
                                                <span className="truncate max-w-[150px]">{src.name}</span>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <span className="font-bold text-foreground">{formatNumber(src.visitors)}</span>
                                                <span className="text-muted-foreground text-[11px] w-8 text-right">{share}%</span>
                                            </div>
                                        </div>
                                        <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-0.5">
                                            <span>В корзину: <strong className="text-foreground">{src.carts}</strong> ({src.cartRate}%)</span>
                                            <span>Заказы: <strong className="text-emerald-400">{src.checkouts}</strong> ({src.checkoutRate}%)</span>
                                        </div>
                                        <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                                            <div
                                                className={`h-full rounded-full ${isYandex ? 'bg-amber-400' : isGoogle ? 'bg-blue-400' : isTg ? 'bg-cyan-400' : 'bg-primary'}`}
                                                style={{ width: `${Math.min(100, Math.max(3, share))}%` }}
                                            />
                                        </div>
                                    </div>
                                )
                            })
                        ) : (
                            <EmptyState text="Нет данных по источникам за выбранный период" />
                        )}
                    </CardContent>
                </Card>

                {/* Column 3: Мобильность и География */}
                <Card className="flex flex-col justify-between border-border/80 bg-gradient-to-br from-card to-card/60 shadow-sm">
                    <CardHeader className="p-5 pb-3">
                        <div className="flex items-center justify-between">
                            <CardTitle className="text-base font-semibold flex items-center gap-2 text-foreground">
                                <Smartphone className="h-4 w-4 text-violet-400" />
                                Мобильность и География
                            </CardTitle>
                            <Globe2 className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <CardDescription>Устройства аудитории и ведущие локации</CardDescription>
                    </CardHeader>
                    <CardContent className="p-5 pt-0 space-y-4">
                        {/* Device breakdown */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between text-xs">
                                <span className="text-muted-foreground flex items-center gap-1.5">
                                    <Smartphone className="h-3.5 w-3.5 text-primary" /> Мобильные: <strong className="text-foreground">{mobilePercent}%</strong>
                                </span>
                                <span className="text-muted-foreground flex items-center gap-1.5">
                                    <Monitor className="h-3.5 w-3.5 text-muted-foreground" /> Десктоп: <strong className="text-foreground">{desktopPercent}%</strong>
                                </span>
                            </div>
                            <div className="h-2 w-full overflow-hidden rounded-full bg-muted flex">
                                <div className="bg-primary transition-all" style={{ width: `${mobilePercent}%` }} />
                                <div className="bg-muted-foreground/40 transition-all" style={{ width: `${desktopPercent}%` }} />
                            </div>
                        </div>

                        {/* Top Geography */}
                        <div className="space-y-2 pt-3 border-t border-border/40">
                            <div className="text-xs font-medium text-muted-foreground flex items-center justify-between">
                                <span>Топ регионов</span>
                                <span>Визиты</span>
                            </div>
                            {countryList.length > 0 ? (
                                <div className="space-y-1.5">
                                    {countryList.slice(0, 3).map((c, idx) => {
                                        const totalGeo = countryList.reduce((acc, curr) => acc + Number(curr.visitors || 0), 0) || 1
                                        const cShare = Math.round((Number(c.visitors || 0) / totalGeo) * 100)
                                        return (
                                            <div key={c.name} className="flex items-center justify-between text-xs p-2 rounded-lg bg-muted/40 border border-border/30">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-xs font-semibold text-muted-foreground">{idx + 1}.</span>
                                                    <span className="font-medium text-foreground">{getDisplayName(c.name)}</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <span className="font-semibold text-foreground">{formatNumber(c.visitors)}</span>
                                                    <span className="text-[11px] text-muted-foreground">({cShare}%)</span>
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            ) : (
                                <div className="text-xs text-muted-foreground py-2 text-center">Регионы определяются по IP посетителей</div>
                            )}
                        </div>
                    </CardContent>
                </Card>
            </section>

            {/* ============================================================
                2. MIDDLE SECTION: 2-COLUMN ACTION WORKHORSE (SEARCH & FUNNEL)
               ============================================================ */}
            <section className="grid grid-cols-1 gap-4 lg:grid-cols-12">
                {/* Left (col-span-5): Поисковый спрос покупателей на витрине */}
                <Card className="lg:col-span-5 flex flex-col justify-between shadow-sm">
                    <CardHeader className="p-5 pb-3">
                        <div className="flex items-center justify-between">
                            <div>
                                <CardTitle className="text-base font-semibold flex items-center gap-2 text-foreground">
                                    <Search className="h-4 w-4 text-cyan-400" />
                                    Поисковый спрос на витрине
                                </CardTitle>
                                <CardDescription>Что покупатели ищут через строку поиска</CardDescription>
                            </div>
                            {searchDemands.length > 0 && (
                                <Badge variant="secondary" className="text-xs font-normal">
                                    {searchDemands.length} запросов
                                </Badge>
                            )}
                        </div>
                    </CardHeader>
                    <CardContent className="p-5 pt-0 flex-1 flex flex-col justify-between">
                        {searchDemands.length > 0 ? (
                            <div className="space-y-2 divide-y divide-border/40">
                                {searchDemands.slice(0, 6).map((item, idx) => (
                                    <div key={`${item.query}-${idx}`} className="flex items-center justify-between pt-2 first:pt-0 group">
                                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">
                                                {idx + 1}
                                            </span>
                                            <span className="font-medium text-sm text-foreground truncate" title={item.query}>
                                                {item.query}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0 pl-2">
                                            <div className="text-right">
                                                <div className="font-semibold text-xs text-foreground">{formatNumber(item.searches)}</div>
                                                <div className="text-[10px] text-muted-foreground">{item.unique_users} чел</div>
                                            </div>
                                            <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-primary opacity-80 group-hover:opacity-100 text-xs">
                                                <Link href={`/admin?search=${encodeURIComponent(item.query)}`} title="Посмотреть в каталоге">
                                                    Каталог <ExternalLink className="h-3 w-3 ml-1" />
                                                </Link>
                                            </Button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <EmptyState text="Поисковых запросов в этом периоде пока не зафиксировано" />
                        )}
                    </CardContent>
                </Card>

                {/* Right (col-span-7): Сквозная конверсионная воронка */}
                <Card className="lg:col-span-7 flex flex-col justify-between shadow-sm">
                    <CardHeader className="p-5 pb-3">
                        <div className="flex items-center justify-between">
                            <div>
                                <CardTitle className="text-base font-semibold flex items-center gap-2 text-foreground">
                                    <TrendingUp className="h-4 w-4 text-primary" />
                                    Сквозная воронка конверсии
                                </CardTitle>
                                <CardDescription>Визиты → Просмотры → Корзина → Заказ → Оплата</CardDescription>
                            </div>
                            {funnel.length > 1 && funnel[0].count > 0 && (
                                <Badge className="bg-primary/15 text-primary border-primary/20 text-xs font-semibold">
                                    Общая: {funnel[funnel.length - 1].rate}%
                                </Badge>
                            )}
                        </div>
                    </CardHeader>
                    <CardContent className="p-5 pt-0 space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
                            {funnel.map((item, idx) => {
                                const isFirst = idx === 0
                                const dropOff = Number(item.dropOff || 0)
                                const stepConversion = Number(item.stepConversion ?? (isFirst ? 100 : item.rate))
                                return (
                                    <div key={item.step} className="p-2.5 rounded-lg border border-border/70 bg-background/50 flex flex-col justify-between space-y-2">
                                        <div>
                                            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                                                <span className="font-semibold text-primary">{idx + 1}</span>
                                                <span className="font-semibold text-foreground">{item.rate}%</span>
                                            </div>
                                            <div className="text-[11px] font-medium text-foreground truncate mt-1" title={item.step}>
                                                {item.step}
                                            </div>
                                            <div className="text-lg font-bold text-foreground mt-0.5">
                                                {formatNumber(item.count)}
                                            </div>
                                        </div>
                                        <div className="border-t border-border/50 pt-1 text-[10px]">
                                            <span className="text-muted-foreground">{isFirst ? '100% вход' : `${stepConversion}%`}</span>
                                            {!isFirst && dropOff > 0 && (
                                                <span className="text-rose-400 block font-medium">−{dropOff}%</span>
                                            )}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>

                        {/* Financial Summary Footer */}
                        <div className="grid grid-cols-3 gap-3 p-3 rounded-lg bg-muted/40 border border-border/60 text-xs">
                            <div>
                                <div className="text-muted-foreground">Выручка (CRM)</div>
                                <div className="text-base sm:text-lg font-bold text-emerald-400">{formatCurrency(financial.revenue)}</div>
                            </div>
                            <div>
                                <div className="text-muted-foreground">Оплачено заказов</div>
                                <div className="text-base sm:text-lg font-bold text-foreground">{formatNumber(financial.paid_orders)}</div>
                            </div>
                            <div>
                                <div className="text-muted-foreground">Средний чек (AOV)</div>
                                <div className="text-base sm:text-lg font-bold text-blue-400">{formatCurrency(financial.aov)}</div>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </section>

            {/* ============================================================
                3. 4-PLATFORM QUICK HUB BAR (METRIKA, GSC, MERCHANT, WEBMASTER)
               ============================================================ */}
            <Card className="border-border/80 bg-background/50 shadow-sm">
                <CardHeader className="p-4 pb-2">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                        <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
                            <Activity className="h-4 w-4 text-primary" />
                            Центр 4 платформ: Яндекс & Google
                        </CardTitle>
                        <span className="text-xs text-muted-foreground">Прямой доступ к поисковым системам и кабинетам</span>
                    </div>
                </CardHeader>
                <CardContent className="p-4 pt-1">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                        {/* Yandex Metrika */}
                        <div className="p-3 rounded-lg border border-border bg-card/60 flex flex-col justify-between space-y-2">
                            <div>
                                <div className="flex items-center justify-between text-xs font-semibold text-foreground">
                                    <span>Яндекс.Метрика</span>
                                    <span className="text-emerald-400 flex items-center gap-1 font-normal text-[11px]">
                                        <CheckCircle2 className="h-3 w-3" /> 100417016
                                    </span>
                                </div>
                                <p className="text-[11px] text-muted-foreground mt-1">Вебвизор, цели и онлайн поведение</p>
                            </div>
                            <div className="pt-2 border-t border-border/40 flex items-center gap-3 text-xs">
                                <a href="https://metrika.yandex.ru/dashboard?id=100417016" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
                                    Дашборд <ExternalLink className="h-3 w-3" />
                                </a>
                                <span className="text-muted-foreground/40">•</span>
                                <a href="https://metrika.yandex.ru/stat/visor?id=100417016" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
                                    Вебвизор <ExternalLink className="h-3 w-3" />
                                </a>
                            </div>
                        </div>

                        {/* Google Search Console */}
                        <div className="p-3 rounded-lg border border-border bg-card/60 flex flex-col justify-between space-y-2">
                            <div>
                                <div className="flex items-center justify-between text-xs font-semibold text-foreground">
                                    <span>Search Console</span>
                                    <span className="text-emerald-400 flex items-center gap-1 font-normal text-[11px]">
                                        <CheckCircle2 className="h-3 w-3" /> sc-domain
                                    </span>
                                </div>
                                <p className="text-[11px] text-muted-foreground mt-1">Позиции в Google, показы и CTR</p>
                            </div>
                            <div className="pt-2 border-t border-border/40 text-xs">
                                <a href="https://search.google.com/search-console?resource_id=sc-domain:yeezyunique.ru" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
                                    Панель Google <ExternalLink className="h-3 w-3" />
                                </a>
                            </div>
                        </div>

                        {/* Google Merchant Center */}
                        <div className="p-3 rounded-lg border border-border bg-card/60 flex flex-col justify-between space-y-2">
                            <div>
                                <div className="flex items-center justify-between text-xs font-semibold text-foreground">
                                    <span>Merchant Center</span>
                                    <span className="text-emerald-400 flex items-center gap-1 font-normal text-[11px]">
                                        <CheckCircle2 className="h-3 w-3" /> 5830671674
                                    </span>
                                </div>
                                <p className="text-[11px] text-muted-foreground mt-1">Товарные фиды и Google Покупки</p>
                            </div>
                            <div className="pt-2 border-t border-border/40 text-xs">
                                <a href="https://merchants.google.com/mc/overview?a=5830671674" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
                                    Товарный фид <ExternalLink className="h-3 w-3" />
                                </a>
                            </div>
                        </div>

                        {/* Yandex Webmaster */}
                        <div className="p-3 rounded-lg border border-border bg-card/60 flex flex-col justify-between space-y-2">
                            <div>
                                <div className="flex items-center justify-between text-xs font-semibold text-foreground">
                                    <span>Яндекс.Вебмастер</span>
                                    <span className="text-emerald-400 flex items-center gap-1 font-normal text-[11px]">
                                        <CheckCircle2 className="h-3 w-3" /> Подтверждён
                                    </span>
                                </div>
                                <p className="text-[11px] text-muted-foreground mt-1">Индексация страниц и сниппеты Яндекса</p>
                            </div>
                            <div className="pt-2 border-t border-border/40 text-xs">
                                <a href="https://webmaster.yandex.ru/site/https:yeezyunique.ru:443/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
                                    Кабинет Яндекса <ExternalLink className="h-3 w-3" />
                                </a>
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* ============================================================
                4. COLLAPSIBLE DEEP DIVE (TIMELINE, TOP PRODUCTS, TECH DETAILS)
               ============================================================ */}
            <div className="space-y-4">
                <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsDetailsOpen(!isDetailsOpen)}
                    className="w-full justify-between py-6 px-4 border-dashed hover:border-primary/50 text-sm font-medium bg-card/50"
                >
                    <span className="flex items-center gap-2">
                        <BarChart3 className="h-4 w-4 text-primary" />
                        {isDetailsOpen ? 'Скрыть расширенные графики и товары' : 'Показать расширенные графики динамики, топ товаров и технические данные'}
                    </span>
                    {isDetailsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </Button>

                {isDetailsOpen && (
                    <div className="space-y-6 pt-2">
                        {/* Timeline Chart */}
                        <AnalyticsCharts seriesData={seriesData} overview={data} />

                        {/* Top Products & Top Cart Tables */}
                        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                            {/* Top Viewed Products */}
                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 p-5 pb-3">
                                    <div>
                                        <CardTitle className="flex items-center gap-2 text-base">
                                            <Eye className="h-4 w-4 text-cyan-400" />
                                            Топ просматриваемых товаров
                                        </CardTitle>
                                        <CardDescription>По каналу {channelLabels[channel].toLowerCase()}</CardDescription>
                                    </div>
                                    <Package className="h-5 w-5 text-muted-foreground" />
                                </CardHeader>
                                <CardContent className="p-5 pt-0">
                                    {topProducts.length > 0 ? (
                                        <div className="divide-y divide-border/60">
                                            {topProducts.slice(0, 8).map((prod, idx) => {
                                                const queryTerm = prod.name && prod.name !== 'Без названия' && prod.name !== prod.id ? prod.name : prod.id
                                                return (
                                                    <div key={`${prod.id}-${idx}`} className="group flex items-center justify-between gap-3 py-2.5 text-sm">
                                                        <div className="flex min-w-0 flex-1 items-center gap-2.5">
                                                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                                                                {idx + 1}
                                                            </span>
                                                            <div className="min-w-0 flex-1">
                                                                <div className="flex flex-wrap items-center gap-1.5">
                                                                    <span className="max-w-[280px] truncate font-medium text-foreground" title={prod.name}>
                                                                        {prod.name}
                                                                    </span>
                                                                    {prod.brand && (
                                                                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                                                            {prod.brand}
                                                                        </Badge>
                                                                    )}
                                                                </div>
                                                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                                                    {prod.price ? <span>{formatCurrency(prod.price)}</span> : null}
                                                                    <Link
                                                                        href={`/admin?search=${encodeURIComponent(queryTerm)}`}
                                                                        className="inline-flex items-center gap-1 text-primary hover:underline opacity-80 group-hover:opacity-100"
                                                                    >
                                                                        Каталог <ExternalLink className="h-3 w-3" />
                                                                    </Link>
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <div className="shrink-0 pl-2 text-right">
                                                            <div className="font-semibold text-foreground">{formatNumber(Number(prod.views || 0))}</div>
                                                            <div className="text-xs text-muted-foreground">просмотров</div>
                                                        </div>
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    ) : (
                                        <EmptyState text="Нет данных о просмотрах товаров" />
                                    )}
                                </CardContent>
                            </Card>

                            {/* Top Cart Products */}
                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 p-5 pb-3">
                                    <div>
                                        <CardTitle className="flex items-center gap-2 text-base">
                                            <ShoppingCart className="h-4 w-4 text-emerald-400" />
                                            Топ товаров в корзине
                                        </CardTitle>
                                        <CardDescription>Чаще всего добавляют в заказ</CardDescription>
                                    </div>
                                    <ShoppingCart className="h-5 w-5 text-muted-foreground" />
                                </CardHeader>
                                <CardContent className="p-5 pt-0">
                                    {topCart.length > 0 ? (
                                        <div className="divide-y divide-border/60">
                                            {topCart.slice(0, 8).map((prod, idx) => {
                                                const queryTerm = prod.name && prod.name !== 'Без названия' && prod.name !== prod.id ? prod.name : prod.id
                                                return (
                                                    <div key={`${prod.id}-${idx}`} className="group flex items-center justify-between gap-3 py-2.5 text-sm">
                                                        <div className="flex min-w-0 flex-1 items-center gap-2.5">
                                                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                                                                {idx + 1}
                                                            </span>
                                                            <div className="min-w-0 flex-1">
                                                                <div className="flex flex-wrap items-center gap-1.5">
                                                                    <span className="max-w-[280px] truncate font-medium text-foreground" title={prod.name}>
                                                                        {prod.name}
                                                                    </span>
                                                                    {prod.brand && (
                                                                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                                                            {prod.brand}
                                                                        </Badge>
                                                                    )}
                                                                </div>
                                                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                                                    {prod.price ? <span>{formatCurrency(prod.price)}</span> : null}
                                                                    <Link
                                                                        href={`/admin?search=${encodeURIComponent(queryTerm)}`}
                                                                        className="inline-flex items-center gap-1 text-primary hover:underline opacity-80 group-hover:opacity-100"
                                                                    >
                                                                        Каталог <ExternalLink className="h-3 w-3" />
                                                                    </Link>
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <div className="shrink-0 pl-2 text-right">
                                                            <div className="font-semibold text-foreground">{formatNumber(Number(prod.carts || 0))}</div>
                                                            <div className="text-xs text-muted-foreground">в корзину</div>
                                                        </div>
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    ) : (
                                        <EmptyState text="Нет данных о добавлениях в корзину" />
                                    )}
                                </CardContent>
                            </Card>
                        </section>

                        {/* OS & Tech Details */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <Card>
                                <CardHeader className="p-4 pb-2">
                                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                                        <Laptop className="h-4 w-4 text-primary" />
                                        Операционные системы
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="p-4 pt-1">
                                    {osList.length ? (
                                        <div className="space-y-2">
                                            {osList.map((item) => (
                                                <ProgressRow key={item.name} label={item.name} value={Number(item.visitors || 0)} total={data.unique_visitors || 1} />
                                            ))}
                                        </div>
                                    ) : (
                                        <EmptyState text="Нет данных по ОС" />
                                    )}
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader className="p-4 pb-2">
                                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                                        <Monitor className="h-4 w-4 text-primary" />
                                        Типы устройств
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="p-4 pt-1">
                                    {deviceList.length ? (
                                        <div className="space-y-2">
                                            {deviceList.map((item) => (
                                                <ProgressRow key={item.name} label={item.name} value={Number(item.visitors || 0)} total={data.unique_visitors || 1} />
                                            ))}
                                        </div>
                                    ) : (
                                        <EmptyState text="Нет данных по устройствам" />
                                    )}
                                </CardContent>
                            </Card>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}

function ProgressRow({ label, value, total }: { label: string; value: number; total: number }) {
    return (
        <div>
            <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                <span className="truncate text-muted-foreground">{label}</span>
                <span className="font-semibold text-foreground">{formatNumber(value)}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (value / total) * 100)}%` }} />
            </div>
        </div>
    )
}

function EmptyState({ text }: { text: string }) {
    return (
        <Card className="flex h-full min-h-24 items-center justify-center border-dashed bg-background/40 p-4 text-center text-xs font-medium text-muted-foreground">
            {text}
        </Card>
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
