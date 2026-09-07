'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
    Activity,
    ArrowLeft,
    BarChart3,
    Calendar,
    CheckCircle2,
    ChevronRight,
    Clock,
    CreditCard,
    DollarSign,
    ExternalLink,
    Eye,
    Globe2,
    Heart,
    Laptop,
    MessageCircle,
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
    UserCheck,
    UserPlus,
    Users,
    Wifi,
    XCircle,
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
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

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
    const [audienceTab, setAudienceTab] = useState<'sources' | 'demand' | 'geo' | 'tech' | 'integrations'>('sources')

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

    const derived = useMemo(() => ({
        returningShare: formatPercent(data.returning_profiles || data.returning_visitors, data.active_profiles || data.unique_visitors),
        productDepth: data.unique_product_viewers ? (data.unique_product_views / data.unique_product_viewers).toFixed(1) : '0',
        askRate: formatPercent(data.ask_manager, data.unique_product_views || data.product_views),
        cartShare: formatPercent(data.cart_profiles, data.total_profiles),
        favoriteShare: formatPercent(data.favorite_profiles, data.total_profiles),
    }), [data])

    const activePeriodDisplay = period === 'custom' && customFrom
        ? `${customFrom}${customTo ? ` — ${customTo}` : ''}`
        : periodLabels[period]

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
                        <h1 className="flex items-center gap-2 text-2xl font-semibold text-foreground">
                            <BarChart3 className="h-6 w-6 text-primary" />
                            Аналитика каталога и продаж
                        </h1>
                        <p className="mt-1 text-sm text-muted-foreground">
                            Сайт (десктоп/мобайл) и TG Mini App: трафик, конверсии, выручка CRM и воронка покупок.
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

            {/* Custom Date Range Modal/Drawer */}
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

            {/* Financial & Commercial KPIs */}
            <section className="space-y-2">
                <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold tracking-wider text-muted-foreground uppercase flex items-center gap-2">
                        <DollarSign className="h-4 w-4 text-emerald-400" />
                        Коммерческие показатели (CRM)
                    </h2>
                    <span className="text-xs text-muted-foreground">
                        {channelLabels[channel]} • {activePeriodDisplay}
                    </span>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
                    <KpiCard
                        icon={<CreditCard />}
                        label="Выручка (оплачено)"
                        valueText={formatCurrency(financial.revenue)}
                        detail={`${formatNumber(financial.paid_orders)} оплаченных заказов`}
                        tone="emerald"
                        loading={loading}
                    />
                    <KpiCard
                        icon={<Receipt />}
                        label="Средний чек (AOV)"
                        valueText={formatCurrency(financial.aov)}
                        detail="По оплаченным заказам CRM"
                        tone="blue"
                        loading={loading}
                    />
                    <KpiCard
                        icon={<ShoppingBag />}
                        label="Оплаченные заказы"
                        value={financial.paid_orders}
                        detail="Успешно завершенные заказы"
                        tone="emerald"
                        loading={loading}
                    />
                    <KpiCard
                        icon={<Clock />}
                        label="Ожидают оплаты"
                        value={financial.pending_orders}
                        detail="Статус payment_pending"
                        tone="amber"
                        loading={loading}
                    />
                    <KpiCard
                        icon={<XCircle />}
                        label="Отмены и возвраты"
                        value={financial.cancelled_orders + financial.refund_orders}
                        detail={`Отмен: ${financial.cancelled_orders}, возвратов: ${financial.refund_orders}`}
                        tone="rose"
                        loading={loading}
                    />
                </div>
            </section>

            {/* Conversion Funnel */}
            {funnel.length > 0 && (
                <Card>
                    <CardHeader className="flex flex-col gap-2 p-5 pb-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <CardTitle className="flex items-center gap-2 text-lg">
                                <TrendingUp className="h-5 w-5 text-primary" />
                                Сквозная воронка конверсии
                            </CardTitle>
                            <CardDescription>
                                Движение пользователей от визита до факта оплаты с отслеживанием отвалов на каждом шаге.
                            </CardDescription>
                        </div>
                        {funnel.length > 1 && funnel[0].count > 0 && (
                            <div className="flex w-fit items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                                <span>Общая конверсия:</span>
                                <span>{funnel[funnel.length - 1].rate}%</span>
                            </div>
                        )}
                    </CardHeader>
                    <CardContent className="p-5 pt-0">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
                            {funnel.map((item, idx) => {
                                const isFirst = idx === 0
                                const isLast = idx === funnel.length - 1
                                const dropOff = Number(item.dropOff || 0)
                                const stepConversion = Number(item.stepConversion ?? (isFirst ? 100 : item.rate))

                                return (
                                    <div key={item.step} className="relative flex flex-col">
                                        <div className="flex h-full flex-col justify-between rounded-xl border border-border bg-background/50 p-4 transition-colors hover:border-primary/40">
                                            <div>
                                                <div className="flex items-center justify-between gap-2 text-xs">
                                                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[11px] font-bold text-primary">
                                                        {idx + 1}
                                                    </span>
                                                    <span className="font-semibold text-primary">{item.rate}%</span>
                                                </div>
                                                <div className="mt-2.5 flex min-h-[32px] items-center text-xs font-medium text-foreground/85">
                                                    {item.step}
                                                </div>
                                                <div className="mt-1 text-2xl font-bold text-foreground">
                                                    {formatNumber(item.count)}
                                                </div>
                                            </div>

                                            <div className="mt-3 space-y-1.5 border-t border-border/50 pt-2.5">
                                                <div className="flex items-center justify-between text-[11px]">
                                                    <span className="text-muted-foreground">
                                                        {isFirst ? '100% вход' : `${stepConversion}% переход`}
                                                    </span>
                                                    {!isFirst && dropOff > 0 ? (
                                                        <span className="font-medium text-rose-400">
                                                            −{dropOff}% отвал
                                                        </span>
                                                    ) : null}
                                                </div>
                                                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                                                    <div
                                                        className="h-full rounded-full bg-primary transition-all duration-500"
                                                        style={{ width: `${Math.min(100, Math.max(isFirst ? 100 : 4, item.rate))}%` }}
                                                    />
                                                </div>
                                            </div>
                                        </div>

                                        {!isLast && (
                                            <div className="absolute -right-2 top-1/2 z-10 hidden -translate-y-1/2 items-center justify-center rounded-full border border-border bg-muted p-1 text-muted-foreground lg:flex">
                                                <ChevronRight className="h-3 w-3" />
                                            </div>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Audience & Activity KPIs */}
            <section className="space-y-2">
                <h2 className="text-sm font-semibold tracking-wider text-muted-foreground uppercase flex items-center gap-2">
                    <Activity className="h-4 w-4 text-cyan-400" />
                    Трафик и вовлеченность
                </h2>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
                    <KpiCard icon={<Wifi />} label="Текущий онлайн" value={data.online_now} detail="Активны за последние 5 минут" tone="emerald" loading={loading} />
                    <KpiCard icon={<Users />} label="Уникальные пользователи" value={data.unique_visitors} detail={`${data.active_profiles ? `${formatNumber(data.active_profiles)} профилей активны` : 'По сессиям аналитики'}`} tone="blue" loading={loading} />
                    <KpiCard icon={<ExternalLink />} label="Переходы на сайт (TG)" value={data.tg_site_clicks || data.site_clicks} detail="Клики по ссылке yeezyunique.ru" tone="cyan" loading={loading} />
                    <KpiCard icon={<UserCheck />} label="Постоянные пользователи" value={data.returning_profiles || data.returning_visitors} detail={`${derived.returningShare} от активной базы`} tone="violet" loading={loading} />
                    <KpiCard icon={<Eye />} label="Уникальные просмотры" value={data.unique_product_views} detail={`${formatNumber(data.viewed_products)} разных товаров`} tone="cyan" loading={loading} />
                    <KpiCard icon={<MessageCircle />} label="Спросить у менеджера" value={data.ask_manager} detail={`${derived.askRate} от просмотров`} tone="amber" loading={loading} />
                </div>
            </section>

            {/* Charts Section */}
            <section className="grid grid-cols-1 gap-4 xl:grid-cols-12">
                <Card className="xl:col-span-8">
                    <CardHeader className="flex flex-col gap-2 space-y-0 p-5 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                            <CardTitle className="text-lg">Сводка профилей за период</CardTitle>
                            <CardDescription>Активность клиентской базы, состав корзин и избранного.</CardDescription>
                        </div>
                        <span className="w-fit rounded-md bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                            {channelLabels[channel]} / {activePeriodDisplay}
                        </span>
                    </CardHeader>

                    <CardContent className="grid grid-cols-1 gap-3 p-5 pt-0 sm:grid-cols-2 xl:grid-cols-4">
                        <InsightItem label="Новые профили" value={formatNumber(data.new_profiles)} caption={`Всего профилей: ${formatNumber(data.total_profiles)}`} icon={<UserPlus className="h-4 w-4" />} />
                        <InsightItem label="Глубина просмотра" value={derived.productDepth} caption="Уникальных товаров на зрителя" icon={<Eye className="h-4 w-4" />} />
                        <InsightItem label="В корзине сейчас" value={formatNumber(data.cart_items)} caption={`${formatNumber(data.cart_profiles)} пользователей, ${derived.cartShare}`} icon={<ShoppingCart className="h-4 w-4" />} />
                        <InsightItem label="В избранном сейчас" value={formatNumber(data.favorite_items)} caption={`${formatNumber(data.favorite_profiles)} пользователей, ${derived.favoriteShare}`} icon={<Heart className="h-4 w-4" />} />
                    </CardContent>
                </Card>

                <Card className="xl:col-span-4">
                    <CardHeader className="flex flex-row items-start justify-between space-y-0 p-5 pb-4">
                        <div>
                            <CardTitle className="text-lg">Пульс визитов</CardTitle>
                            <CardDescription>Динамика за выбранный интервал.</CardDescription>
                        </div>
                        <RefreshCw className={`h-5 w-5 text-muted-foreground ${loading ? 'animate-spin' : ''}`} />
                    </CardHeader>
                    <CardContent className="h-[230px] p-5 pt-0">
                        {seriesData.length ? (
                            <AnalyticsCharts seriesData={seriesData} overview={data} minimal />
                        ) : (
                            <EmptyState text="Нет данных для графика" />
                        )}
                    </CardContent>
                </Card>
            </section>

            {/* Timeline Charts */}
            <AnalyticsCharts seriesData={seriesData} overview={data} />

            {/* Top Products & Top Cart Tables */}
            <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
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
                                                            <Badge variant="outline" className="border-border/80 px-1.5 py-0 text-[10px] text-muted-foreground">
                                                                {prod.brand}
                                                            </Badge>
                                                        )}
                                                    </div>
                                                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                                        {prod.category && <span>{prod.category}</span>}
                                                        {prod.price ? (
                                                            <span className="font-semibold text-foreground/80">{formatCurrency(prod.price)}</span>
                                                        ) : null}
                                                        <Link
                                                            href={`/admin?search=${encodeURIComponent(queryTerm)}`}
                                                            className="ml-auto inline-flex items-center gap-0.5 text-[11px] text-primary opacity-80 transition-opacity hover:underline group-hover:opacity-100"
                                                            title="Найти в каталоге"
                                                        >
                                                            Каталог <ExternalLink className="h-3 w-3" />
                                                        </Link>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="shrink-0 pl-2 text-right">
                                                <div className="font-semibold text-foreground">{formatNumber(Number(prod.views || 0))}</div>
                                                <div className="text-xs text-muted-foreground">{formatNumber(Number(prod.unique_views || 0))} уник.</div>
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

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 p-5 pb-3">
                        <div>
                            <CardTitle className="flex items-center gap-2 text-base">
                                <ShoppingCart className="h-4 w-4 text-amber-400" />
                                Топ добавлений в корзину
                            </CardTitle>
                            <CardDescription>По каналу {channelLabels[channel].toLowerCase()}</CardDescription>
                        </div>
                        <ShoppingBag className="h-5 w-5 text-muted-foreground" />
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
                                                            <Badge variant="outline" className="border-border/80 px-1.5 py-0 text-[10px] text-muted-foreground">
                                                                {prod.brand}
                                                            </Badge>
                                                        )}
                                                    </div>
                                                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                                        {prod.category && <span>{prod.category}</span>}
                                                        {prod.price ? (
                                                            <span className="font-semibold text-foreground/80">{formatCurrency(prod.price)}</span>
                                                        ) : null}
                                                        <Link
                                                            href={`/admin?search=${encodeURIComponent(queryTerm)}`}
                                                            className="ml-auto inline-flex items-center gap-0.5 text-[11px] text-primary opacity-80 transition-opacity hover:underline group-hover:opacity-100"
                                                            title="Найти в каталоге"
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

            {/* Audience, Devices & External Integrations Tabs */}
            <Card>
                <CardHeader className="flex flex-col gap-3 p-5 pb-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <CardTitle className="flex items-center gap-2 text-lg">
                            <Globe2 className="h-5 w-5 text-primary" />
                            Каналы трафика, спрос и окружение
                        </CardTitle>
                        <CardDescription>
                            Эффективность внешних источников, поисковый спрос покупателей и статус 4 внешних платформ.
                        </CardDescription>
                    </div>
                    <Tabs value={audienceTab} onValueChange={(val) => setAudienceTab(val as any)}>
                        <TabsList className="bg-muted flex-wrap h-auto p-1">
                            <TabsTrigger value="sources" className="gap-1.5 text-xs">
                                <TrendingUp className="h-3.5 w-3.5 text-primary" /> Каналы ({trafficSources.length})
                            </TabsTrigger>
                            <TabsTrigger value="demand" className="gap-1.5 text-xs">
                                <Search className="h-3.5 w-3.5 text-cyan-400" /> Поисковый спрос {searchDemands.length ? `(${searchDemands.length})` : ''}
                            </TabsTrigger>
                            <TabsTrigger value="geo" className="gap-1.5 text-xs">
                                <Globe2 className="h-3.5 w-3.5" /> Страны {countryList.length ? `(${countryList.length})` : ''}
                            </TabsTrigger>
                            <TabsTrigger value="tech" className="gap-1.5 text-xs">
                                <Laptop className="h-3.5 w-3.5" /> Устройства
                            </TabsTrigger>
                            <TabsTrigger value="integrations" className="gap-1.5 text-xs">
                                <Activity className="h-3.5 w-3.5" /> 4 платформы
                            </TabsTrigger>
                        </TabsList>
                    </Tabs>
                </CardHeader>
                <CardContent className="p-5 pt-2">
                    <Tabs value={audienceTab}>
                        {/* Traffic Sources Breakdown */}
                        <TabsContent value="sources" className="m-0 space-y-4">
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs text-muted-foreground pb-1">
                                <span>Сравнительная эффективность: конверсия из первого визита в просмотры, корзину и оформленный заказ.</span>
                                {trafficSources.length > 0 && (
                                    <span className="font-semibold text-primary">
                                        Активных каналов: {trafficSources.length}
                                    </span>
                                )}
                            </div>

                            {trafficSources.length > 0 ? (
                                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                                    {trafficSources.map((src) => {
                                        const isYandex = src.name.includes('Яндекс')
                                        const isGoogle = src.name.includes('Google')
                                        const isTg = src.name.includes('Telegram')
                                        return (
                                            <div
                                                key={src.name}
                                                className="flex flex-col justify-between rounded-xl border border-border bg-background/50 p-4 transition-colors hover:border-primary/40"
                                            >
                                                <div>
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span className="font-semibold text-sm text-foreground truncate">{src.name}</span>
                                                        <Badge
                                                            variant="outline"
                                                            className={`text-[10px] px-1.5 py-0 ${
                                                                isYandex
                                                                    ? 'border-amber-500/40 text-amber-400 bg-amber-500/10'
                                                                    : isGoogle
                                                                    ? 'border-blue-500/40 text-blue-400 bg-blue-500/10'
                                                                    : isTg
                                                                    ? 'border-cyan-500/40 text-cyan-400 bg-cyan-500/10'
                                                                    : 'border-border text-muted-foreground'
                                                            }`}
                                                        >
                                                            {isYandex ? 'Yandex' : isGoogle ? 'Google' : isTg ? 'Telegram' : 'Direct'}
                                                        </Badge>
                                                    </div>
                                                    <div className="mt-3 grid grid-cols-2 gap-2">
                                                        <div>
                                                            <div className="text-[11px] text-muted-foreground">Визиты</div>
                                                            <div className="text-xl font-bold text-foreground">{formatNumber(src.visitors)}</div>
                                                        </div>
                                                        <div>
                                                            <div className="text-[11px] text-muted-foreground">Просмотры</div>
                                                            <div className="text-xl font-bold text-foreground">{formatNumber(src.views)}</div>
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="mt-3 pt-3 border-t border-border/50 space-y-2">
                                                    <div className="flex items-center justify-between text-xs">
                                                        <span className="text-muted-foreground">В корзину:</span>
                                                        <span className="font-semibold text-foreground">
                                                            {formatNumber(src.carts)} <span className="text-primary font-normal">({src.cartRate}%)</span>
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center justify-between text-xs">
                                                        <span className="text-muted-foreground">Заказы / Заявки:</span>
                                                        <span className="font-semibold text-foreground">
                                                            {formatNumber(src.checkouts)} <span className="text-emerald-400 font-normal">({src.checkoutRate}%)</span>
                                                        </span>
                                                    </div>
                                                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                                                        <div
                                                            className="h-full rounded-full bg-primary"
                                                            style={{ width: `${Math.min(100, Math.max(5, src.cartRate))}%` }}
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            ) : (
                                <EmptyState text="Нет данных по источникам за выбранный период" />
                            )}
                        </TabsContent>

                        {/* Search Demand */}
                        <TabsContent value="demand" className="m-0 space-y-4">
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs text-muted-foreground pb-1">
                                <span>Поисковый спрос покупателей: ключевые слова и модели, которые пользователи ищут на витрине.</span>
                                <span className="text-muted-foreground">Клик по кнопке каталога открывает товары по этому запросу</span>
                            </div>

                            {searchDemands.length > 0 ? (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    {searchDemands.map((item, idx) => (
                                        <div
                                            key={`${item.query}-${idx}`}
                                            className="flex items-center justify-between rounded-lg border border-border bg-background/50 p-3 text-sm transition-colors hover:border-primary/40 group"
                                        >
                                            <div className="flex items-center gap-3 min-w-0 flex-1">
                                                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                                                    {idx + 1}
                                                </span>
                                                <div className="min-w-0 flex-1">
                                                    <div className="font-medium text-foreground truncate">{item.query}</div>
                                                    <div className="text-xs text-muted-foreground">
                                                        {formatNumber(item.unique_users)} уник. зрителей
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-4 shrink-0 pl-2">
                                                <div className="text-right">
                                                    <div className="font-semibold text-foreground">{formatNumber(item.searches)}</div>
                                                    <div className="text-[11px] text-muted-foreground">поисков</div>
                                                </div>
                                                <Button asChild size="sm" variant="ghost" className="h-8 px-2 text-primary opacity-80 group-hover:opacity-100">
                                                    <Link href={`/admin?search=${encodeURIComponent(item.query)}`} title="Посмотреть в каталоге">
                                                        Каталог <ExternalLink className="h-3 w-3 ml-1" />
                                                    </Link>
                                                </Button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <EmptyState text="Нет поисковых запросов за выбранный период" />
                            )}
                        </TabsContent>

                        {/* Geography */}
                        <TabsContent value="geo" className="m-0">
                            {countryList.length ? (
                                <div className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
                                    {countryList.slice(0, 10).map((item, index) => (
                                        <ProgressRow
                                            key={`${item.name}-${index}`}
                                            label={getDisplayName(item.name)}
                                            value={Number(item.visitors || 0)}
                                            total={Math.max(1, countryList.reduce((sum, c) => sum + Number(c.visitors || 0), 0))}
                                        />
                                    ))}
                                </div>
                            ) : (
                                <EmptyState text="Нет данных по странам" />
                            )}
                        </TabsContent>

                        {/* Devices & OS */}
                        <TabsContent value="tech" className="m-0">
                            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                                <div className="space-y-3 rounded-lg border border-border/60 bg-background/40 p-4">
                                    <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                                        <Smartphone className="h-4 w-4 text-cyan-400" />
                                        Типы устройств
                                    </div>
                                    {deviceList.length ? (
                                        <div className="space-y-3">
                                            {deviceList.map((item, index) => (
                                                <ProgressRow
                                                    key={`${item.name}-${index}`}
                                                    label={item.name || 'Неизвестно'}
                                                    value={Number(item.visitors || 0)}
                                                    total={Math.max(1, deviceList.reduce((sum, d) => sum + Number(d.visitors || 0), 0))}
                                                />
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="text-xs text-muted-foreground">Нет данных по типам устройств</div>
                                    )}
                                </div>

                                <div className="space-y-3 rounded-lg border border-border/60 bg-background/40 p-4">
                                    <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                                        <Laptop className="h-4 w-4 text-violet-400" />
                                        Операционные системы
                                    </div>
                                    {osList.length ? (
                                        <div className="space-y-3">
                                            {osList.slice(0, 5).map((item, index) => (
                                                <ProgressRow
                                                    key={`${item.name}-${index}`}
                                                    label={item.name || 'Неизвестно'}
                                                    value={Number(item.visitors || 0)}
                                                    total={Math.max(1, osList.reduce((sum, o) => sum + Number(o.visitors || 0), 0))}
                                                />
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="text-xs text-muted-foreground">Нет данных по ОС</div>
                                    )}
                                </div>
                            </div>
                        </TabsContent>

                        {/* 4 External Platforms */}
                        <TabsContent value="integrations" className="m-0 space-y-4">
                            {externalIntegrations?.yandexMetrika?.apiActive && externalIntegrations?.yandexMetrika?.stats && (
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 text-xs">
                                    <div>
                                        <div className="text-muted-foreground">Посетители (Метрика)</div>
                                        <div className="text-lg font-bold text-foreground">{formatNumber(externalIntegrations.yandexMetrika.stats.users)}</div>
                                    </div>
                                    <div>
                                        <div className="text-muted-foreground">Просмотры страниц</div>
                                        <div className="text-lg font-bold text-foreground">{formatNumber(externalIntegrations.yandexMetrika.stats.pageviews)}</div>
                                    </div>
                                    <div>
                                        <div className="text-muted-foreground">Отказы (Bounce rate)</div>
                                        <div className="text-lg font-bold text-foreground">{externalIntegrations.yandexMetrika.stats.bounceRate}%</div>
                                    </div>
                                    <div>
                                        <div className="text-muted-foreground">Среднее время</div>
                                        <div className="text-lg font-bold text-foreground">{externalIntegrations.yandexMetrika.stats.avgDurationSeconds} сек</div>
                                    </div>
                                </div>
                            )}

                            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                                {/* Yandex Metrika */}
                                <div className="flex flex-col justify-between space-y-3 rounded-lg border border-border bg-background/50 p-4">
                                    <div className="space-y-1.5">
                                        <div className="flex items-center justify-between text-sm font-medium">
                                            <span className="font-semibold text-foreground">Яндекс.Метрика</span>
                                            <span className="flex items-center gap-1 text-xs font-normal text-emerald-400">
                                                <CheckCircle2 className="h-3.5 w-3.5" /> Активна
                                            </span>
                                        </div>
                                        <div className="text-xs text-muted-foreground">
                                            Счётчик: <span className="font-mono text-foreground/90">{externalIntegrations?.yandexMetrika?.counterId || '100417016'}</span>
                                        </div>
                                        <p className="text-xs text-muted-foreground">
                                            Сбор визитов, вебвизор, карты кликов и 9 настроенных ecommerce-целей витрины.
                                        </p>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border/40 text-xs">
                                        <a
                                            href={`https://metrika.yandex.ru/dashboard?id=${externalIntegrations?.yandexMetrika?.counterId || '100417016'}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-1 text-primary hover:underline"
                                        >
                                            Дашборд <ExternalLink className="h-3 w-3" />
                                        </a>
                                        <span className="text-muted-foreground/40">•</span>
                                        <a
                                            href={`https://metrika.yandex.ru/stat/visor?id=${externalIntegrations?.yandexMetrika?.counterId || '100417016'}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-1 text-primary hover:underline"
                                        >
                                            Вебвизор <ExternalLink className="h-3 w-3" />
                                        </a>
                                        <span className="text-muted-foreground/40">•</span>
                                        <a
                                            href={`https://metrika.yandex.ru/stat/goals?id=${externalIntegrations?.yandexMetrika?.counterId || '100417016'}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-1 text-primary hover:underline"
                                        >
                                            Цели <ExternalLink className="h-3 w-3" />
                                        </a>
                                    </div>
                                </div>

                                {/* Google Search Console */}
                                <div className="flex flex-col justify-between space-y-3 rounded-lg border border-border bg-background/50 p-4">
                                    <div className="space-y-1.5">
                                        <div className="flex items-center justify-between text-sm font-medium">
                                            <span className="font-semibold text-foreground">Google Search Console</span>
                                            <span className="flex items-center gap-1 text-xs font-normal text-emerald-400">
                                                <CheckCircle2 className="h-3.5 w-3.5" /> Подтверждён
                                            </span>
                                        </div>
                                        <div className="text-xs text-muted-foreground">
                                            Ресурс: <span className="font-mono text-foreground/90">sc-domain:yeezyunique.ru</span>
                                        </div>
                                        <p className="text-xs text-muted-foreground">
                                            Органический поиск Google, позиции каталога, CTR, показы и статус sitemap.xml.
                                        </p>
                                    </div>
                                    <div className="pt-1 border-t border-border/40 text-xs">
                                        <a
                                            href="https://search.google.com/search-console?resource_id=sc-domain:yeezyunique.ru"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-1 text-primary hover:underline"
                                        >
                                            Панель эффективности Google <ExternalLink className="h-3 w-3" />
                                        </a>
                                    </div>
                                </div>

                                {/* Google Merchant Center */}
                                <div className="flex flex-col justify-between space-y-3 rounded-lg border border-border bg-background/50 p-4">
                                    <div className="space-y-1.5">
                                        <div className="flex items-center justify-between text-sm font-medium">
                                            <span className="font-semibold text-foreground">Google Merchant Center</span>
                                            <span className="flex items-center gap-1 text-xs font-normal text-emerald-400">
                                                <CheckCircle2 className="h-3.5 w-3.5" /> Активен
                                            </span>
                                        </div>
                                        <div className="text-xs text-muted-foreground">
                                            Аккаунт: <span className="font-mono text-foreground/90">5830671674</span>
                                        </div>
                                        <p className="text-xs text-muted-foreground">
                                            Товарный фид каталога, проект yeezyunique-seo-ops, синхронизация цен и наличия.
                                        </p>
                                    </div>
                                    <div className="pt-1 border-t border-border/40 text-xs">
                                        <a
                                            href="https://merchants.google.com/mc/overview?a=5830671674"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-1 text-primary hover:underline"
                                        >
                                            Обзор Merchant Center <ExternalLink className="h-3 w-3" />
                                        </a>
                                    </div>
                                </div>

                                {/* Yandex Webmaster */}
                                <div className="flex flex-col justify-between space-y-3 rounded-lg border border-border bg-background/50 p-4">
                                    <div className="space-y-1.5">
                                        <div className="flex items-center justify-between text-sm font-medium">
                                            <span className="font-semibold text-foreground">Яндекс.Вебмастер</span>
                                            <span className="flex items-center gap-1 text-xs font-normal text-emerald-400">
                                                <CheckCircle2 className="h-3.5 w-3.5" /> Подтверждён
                                            </span>
                                        </div>
                                        <div className="text-xs text-muted-foreground">
                                            Сайт: <span className="font-mono text-foreground/90">https://yeezyunique.ru</span>
                                        </div>
                                        <p className="text-xs text-muted-foreground">
                                            Индексация страниц роботом Яндекса, региональность Москва, клики и сниппеты.
                                        </p>
                                    </div>
                                    <div className="pt-1 border-t border-border/40 text-xs">
                                        <a
                                            href="https://webmaster.yandex.ru/site/https:yeezyunique.ru:443/"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-1 text-primary hover:underline"
                                        >
                                            Кабинет Вебмастера <ExternalLink className="h-3 w-3" />
                                        </a>
                                    </div>
                                </div>

                                {/* Google Analytics 4 */}
                                <div className="flex flex-col justify-between space-y-3 rounded-lg border border-border bg-background/50 p-4">
                                    <div className="space-y-1.5">
                                        <div className="flex items-center justify-between text-sm font-medium">
                                            <span className="font-semibold text-foreground">Google Analytics (GA4)</span>
                                            {externalIntegrations?.googleAnalytics?.configured ? (
                                                <span className="flex items-center gap-1 text-xs font-normal text-emerald-400">
                                                    <CheckCircle2 className="h-3.5 w-3.5" /> Подключена
                                                </span>
                                            ) : (
                                                <span className="text-xs font-normal text-muted-foreground">Готова к подключению</span>
                                            )}
                                        </div>
                                        <div className="text-xs text-muted-foreground">
                                            Тег: <span className="font-mono text-foreground/90">{externalIntegrations?.googleAnalytics?.tagId || 'Не указан'}</span>
                                        </div>
                                        <p className="text-xs text-muted-foreground">
                                            Для дополнительной веб-аналитики в Google укажите NEXT_PUBLIC_GA_ID в Coolify.
                                        </p>
                                    </div>
                                    <div className="pt-1 border-t border-border/40 text-[11px] text-muted-foreground">
                                        Формат: G-XXXXXXXXXX
                                    </div>
                                </div>
                            </div>
                        </TabsContent>
                    </Tabs>
                </CardContent>
            </Card>
        </div>
    )
}

function KpiCard({ icon, label, value, valueText, detail, tone, loading }: {
    icon: React.ReactNode
    label: string
    value?: number
    valueText?: string
    detail: string
    tone: 'emerald' | 'blue' | 'violet' | 'cyan' | 'amber' | 'rose'
    loading?: boolean
}) {
    const tones = {
        emerald: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
        blue: 'bg-blue-500/10 text-blue-300 border-blue-500/20',
        violet: 'bg-violet-500/10 text-violet-300 border-violet-500/20',
        cyan: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/20',
        amber: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
        rose: 'bg-rose-500/10 text-rose-300 border-rose-500/20',
    }

    const displayValue = valueText !== undefined ? valueText : formatNumber(value ?? 0)

    return (
        <Card>
            <CardContent className="p-5">
                <div className="mb-4 flex items-center justify-between">
                    <div className={`rounded-lg border p-2 [&_svg]:h-5 [&_svg]:w-5 ${tones[tone]}`}>
                        {icon}
                    </div>
                    {loading && <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />}
                </div>
                {loading ? <Skeleton className="h-9 w-24" /> : <div className="text-2xl sm:text-3xl font-semibold text-foreground truncate">{displayValue}</div>}
                <div className="mt-1 text-sm font-medium text-foreground/80">{label}</div>
                <div className="mt-3 text-xs text-muted-foreground">{detail}</div>
            </CardContent>
        </Card>
    )
}

function InsightItem({ label, value, caption, icon }: { label: string; value: string; caption: string; icon: React.ReactNode }) {
    return (
        <Card className="bg-background/40">
            <CardContent className="p-4">
                <div className="mb-3 flex items-center justify-between text-muted-foreground">
                    <span className="text-sm">{label}</span>
                    {icon}
                </div>
                <div className="text-2xl font-semibold text-foreground">{value}</div>
                <div className="mt-1 text-xs text-muted-foreground">{caption}</div>
            </CardContent>
        </Card>
    )
}


function ProgressRow({ label, value, total }: { label: string; value: number; total: number }) {
    return (
        <div>
            <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                <span className="truncate text-muted-foreground">{label}</span>
                <span className="font-semibold text-foreground">{formatNumber(value)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (value / total) * 100)}%` }} />
            </div>
        </div>
    )
}

function EmptyState({ text }: { text: string }) {
    return (
        <Card className="flex h-full min-h-32 items-center justify-center border-dashed bg-background/40 p-6 text-center text-sm font-medium text-muted-foreground">
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
