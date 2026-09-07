'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
    Activity,
    ArrowLeft,
    BarChart3,
    Calendar,
    CheckCircle2,
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
    Package,
    Receipt,
    RefreshCw,
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
}

interface TopProductItem {
    id: string
    name: string
    views?: number
    unique_views?: number
    carts?: number
}

interface ExternalIntegrations {
    yandexMetrika: {
        configured: boolean
        counterId: string | null
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
    const [updatedAt, setUpdatedAt] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [isResetMenuOpen, setIsResetMenuOpen] = useState(false)
    const [isResetting, setIsResetting] = useState(false)
    const [isCustomOpen, setIsCustomOpen] = useState(false)

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
                                disabled={isResetting}
                                className="border-destructive/30 text-destructive hover:bg-destructive/10"
                            >
                                <Trash2 className="h-4 w-4" />
                                Сброс
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-64">
                            <DropdownMenuItem onClick={() => handleReset('period')}>
                                Очистить {periodLabels[period].toLowerCase()}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                                onClick={() => handleReset('all')}
                                className="font-semibold text-destructive focus:text-destructive"
                            >
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
                    <CardHeader className="p-5 pb-3">
                        <CardTitle className="text-lg flex items-center gap-2">
                            <TrendingUp className="h-5 w-5 text-primary" />
                            Сквозная воронка конверсии
                        </CardTitle>
                        <CardDescription>
                            Этапы движения пользователей от первого визита до факта оплаты в CRM.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="p-5 pt-0">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
                            {funnel.map((item, idx) => (
                                <div
                                    key={item.step}
                                    className="relative flex flex-col justify-between rounded-lg border border-border bg-background/50 p-4 transition-colors hover:border-primary/40"
                                >
                                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                                        <span>Шаг {idx + 1}</span>
                                        <span className="font-semibold text-primary">{item.rate}%</span>
                                    </div>
                                    <div className="my-2">
                                        <div className="text-xs font-medium text-foreground/80">{item.step}</div>
                                        <div className="mt-1 text-2xl font-bold text-foreground">
                                            {formatNumber(item.count)}
                                        </div>
                                    </div>
                                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                                        <div
                                            className="h-full bg-primary transition-all duration-500"
                                            style={{ width: `${Math.min(100, Math.max(4, item.rate))}%` }}
                                        />
                                    </div>
                                </div>
                            ))}
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
                    <CardHeader className="p-5 pb-3 flex flex-row items-center justify-between space-y-0">
                        <div>
                            <CardTitle className="text-base flex items-center gap-2">
                                <Eye className="h-4 w-4 text-cyan-400" />
                                Топ просматриваемых товаров
                            </CardTitle>
                            <CardDescription>По каналу {channelLabels[channel].toLowerCase()}</CardDescription>
                        </div>
                        <Package className="h-5 w-5 text-muted-foreground" />
                    </CardHeader>
                    <CardContent className="p-5 pt-0">
                        {topProducts.length > 0 ? (
                            <div className="divide-y divide-border">
                                {topProducts.slice(0, 8).map((prod, idx) => (
                                    <div key={`${prod.id}-${idx}`} className="flex items-center justify-between py-2.5 text-sm">
                                        <div className="flex items-center gap-3 min-w-0 pr-2">
                                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                                                {idx + 1}
                                            </span>
                                            <div className="truncate">
                                                <div className="font-medium text-foreground truncate">{prod.name}</div>
                                                <div className="text-xs text-muted-foreground">ID: {prod.id}</div>
                                            </div>
                                        </div>
                                        <div className="text-right shrink-0">
                                            <div className="font-semibold text-foreground">{formatNumber(Number(prod.views || 0))}</div>
                                            <div className="text-xs text-muted-foreground">{formatNumber(Number(prod.unique_views || 0))} уник.</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <EmptyState text="Нет данных о просмотрах товаров" />
                        )}
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="p-5 pb-3 flex flex-row items-center justify-between space-y-0">
                        <div>
                            <CardTitle className="text-base flex items-center gap-2">
                                <ShoppingCart className="h-4 w-4 text-amber-400" />
                                Топ добавлений в корзину
                            </CardTitle>
                            <CardDescription>По каналу {channelLabels[channel].toLowerCase()}</CardDescription>
                        </div>
                        <ShoppingBag className="h-5 w-5 text-muted-foreground" />
                    </CardHeader>
                    <CardContent className="p-5 pt-0">
                        {topCart.length > 0 ? (
                            <div className="divide-y divide-border">
                                {topCart.slice(0, 8).map((prod, idx) => (
                                    <div key={`${prod.id}-${idx}`} className="flex items-center justify-between py-2.5 text-sm">
                                        <div className="flex items-center gap-3 min-w-0 pr-2">
                                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                                                {idx + 1}
                                            </span>
                                            <div className="truncate">
                                                <div className="font-medium text-foreground truncate">{prod.name}</div>
                                                <div className="text-xs text-muted-foreground">ID: {prod.id}</div>
                                            </div>
                                        </div>
                                        <div className="text-right shrink-0">
                                            <div className="font-semibold text-foreground">{formatNumber(Number(prod.carts || 0))}</div>
                                            <div className="text-xs text-muted-foreground">в корзину</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <EmptyState text="Нет данных о добавлениях в корзину" />
                        )}
                    </CardContent>
                </Card>
            </section>

            {/* Geography, Devices & External Integrations */}
            <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <CountryList items={countryList.map(item => ({ ...item, name: getDisplayName(item.name) }))} />
                <SimpleList title="Типы устройств и ОС" items={[...deviceList, ...osList.slice(0, 3)]} empty="Нет данных по устройствам" />
                <IntegrationCard integrations={externalIntegrations} />
            </section>
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

function CountryList({ items }: { items: { name: string; visitors: number }[] }) {
    const total = Math.max(1, items.reduce((sum, item) => sum + Number(item.visitors || 0), 0))

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 p-5 pb-4">
                <CardTitle className="text-lg">Посещения по странам</CardTitle>
                <Globe2 className="h-5 w-5 text-primary" />
            </CardHeader>
            <CardContent className="p-5 pt-0">
                {items.length ? (
                    <div className="space-y-4">
                        {items.slice(0, 10).map((item, index) => (
                            <ProgressRow key={`${item.name}-${index}`} label={item.name || 'Неизвестно'} value={Number(item.visitors || 0)} total={total} />
                        ))}
                    </div>
                ) : (
                    <EmptyState text="Нет данных по странам" />
                )}
            </CardContent>
        </Card>
    )
}

function SimpleList({ title, items, empty }: {
    title: string
    empty: string
    items: { name: string; visitors: number }[]
}) {
    const total = Math.max(1, items.reduce((sum, item) => sum + Number(item.visitors || 0), 0))

    return (
        <Card>
            <CardHeader className="p-5 pb-4">
                <CardTitle className="text-lg">{title}</CardTitle>
            </CardHeader>
            <CardContent className="p-5 pt-0">
                {items.length ? (
                    <div className="space-y-4">
                        {items.slice(0, 6).map((item, index) => (
                            <ProgressRow key={`${item.name}-${index}`} label={item.name || 'Неизвестно'} value={Number(item.visitors || 0)} total={total} />
                        ))}
                    </div>
                ) : (
                    <EmptyState text={empty} />
                )}
            </CardContent>
        </Card>
    )
}

function IntegrationCard({ integrations }: { integrations: ExternalIntegrations | null }) {
    const ym = integrations?.yandexMetrika
    const ga = integrations?.googleAnalytics

    return (
        <Card>
            <CardHeader className="p-5 pb-4">
                <CardTitle className="text-lg flex items-center gap-2">
                    <Activity className="h-5 w-5 text-primary" />
                    Внешняя аналитика
                </CardTitle>
                <CardDescription>Статус интеграции со сторонними трекерами</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 p-5 pt-0">
                <div className="rounded-lg border border-border bg-background/50 p-3 space-y-1">
                    <div className="flex items-center justify-between text-sm font-medium">
                        <span>Яндекс.Метрика</span>
                        {ym?.configured ? (
                            <span className="flex items-center gap-1 text-xs text-emerald-400 font-normal">
                                <CheckCircle2 className="h-3.5 w-3.5" /> Подключена
                            </span>
                        ) : (
                            <span className="text-xs text-muted-foreground font-normal">Готова к подключению</span>
                        )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                        {ym?.counterId ? `Счетчик: ${ym.counterId}` : 'Ecommerce и цели витрины передаются по client-side событиям'}
                    </div>
                </div>

                <div className="rounded-lg border border-border bg-background/50 p-3 space-y-1">
                    <div className="flex items-center justify-between text-sm font-medium">
                        <span>Google Analytics / GTM</span>
                        {ga?.configured ? (
                            <span className="flex items-center gap-1 text-xs text-emerald-400 font-normal">
                                <CheckCircle2 className="h-3.5 w-3.5" /> Подключена
                            </span>
                        ) : (
                            <span className="text-xs text-muted-foreground font-normal">Готова к подключению</span>
                        )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                        {ga?.tagId ? `Тег: ${ga.tagId}` : 'Поддерживает Measurement Protocol и GTM-контейнер витрины'}
                    </div>
                </div>

                <div className="text-[11px] text-muted-foreground">
                    Для активации передачи в Метрику и GA задайте переменные <code>NEXT_PUBLIC_YM_COUNTER_ID</code> и <code>NEXT_PUBLIC_GA_ID</code> в Coolify.
                </div>
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
