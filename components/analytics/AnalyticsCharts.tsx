import React from 'react'
import {
    Area,
    AreaChart,
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    Legend,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

interface SeriesData {
    date: string
    visitors?: number
    views: number
    carts: number
    manager: number
    favorites: number
}

interface AnalyticsChartsProps {
    seriesData: SeriesData[]
    overview: {
        unique_visitors: number
        unique_product_views: number
        viewed_products: number
        ask_manager: number
        online_now: number
        returning_profiles: number
        cart_items: number
        favorite_items: number
    }
    minimal?: boolean
}

const colors = {
    visitors: '#60A5FA',
    views: '#22D3EE',
    manager: '#F59E0B',
    online: '#34D399',
    returning: '#A78BFA',
    cart: '#FBBF24',
    favorites: '#F472B6',
}

const formatDate = (value: string) => {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value
    return date.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })
}

const formatAxisNumber = (value: number) => value.toLocaleString('ru-RU')

export default function AnalyticsCharts({ seriesData, overview, minimal }: AnalyticsChartsProps) {
    const safeSeries = seriesData.map(item => ({
        ...item,
        visitors: Number(item.visitors || 0),
        views: Number(item.views || 0),
        manager: Number(item.manager || 0),
        dateLabel: formatDate(item.date),
    }))

    if (minimal) {
        return (
            <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={safeSeries} margin={{ top: 12, right: 12, left: 0, bottom: 18 }}>
                    <defs>
                        <linearGradient id="analyticsPulseViews" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={colors.views} stopOpacity={0.32} />
                            <stop offset="95%" stopColor={colors.views} stopOpacity={0} />
                        </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#1E293B" strokeDasharray="3 3" vertical={false} />
                    <XAxis
                        dataKey="dateLabel"
                        stroke="#94A3B8"
                        fontSize={11}
                        tickLine={false}
                        axisLine={{ stroke: '#334155' }}
                        interval="preserveStartEnd"
                        minTickGap={18}
                        dy={8}
                    />
                    <YAxis
                        stroke="#94A3B8"
                        fontSize={11}
                        tickLine={false}
                        axisLine={{ stroke: '#334155' }}
                        width={44}
                        allowDecimals={false}
                        tickFormatter={formatAxisNumber}
                    />
                    <Tooltip
                        contentStyle={{
                            backgroundColor: '#0F172A',
                            border: '1px solid #1E293B',
                            borderRadius: 8,
                            color: '#F8FAFC',
                        }}
                        labelFormatter={(label) => formatDate(String(label || ''))}
                    />
                    <Area
                        type="monotone"
                        dataKey="views"
                        name="Уникальные просмотры"
                        stroke={colors.views}
                        strokeWidth={3}
                        fill="url(#analyticsPulseViews)"
                        dot={{ r: 2, strokeWidth: 1 }}
                        activeDot={{ r: 5, strokeWidth: 2, stroke: '#F8FAFC' }}
                    />
                </AreaChart>
            </ResponsiveContainer>
        )
    }

    const summaryBars = [
        { name: 'Онлайн', value: overview.online_now, fill: colors.online },
        { name: 'Пользователи', value: overview.unique_visitors, fill: colors.visitors },
        { name: 'Постоянные', value: overview.returning_profiles, fill: colors.returning },
        { name: 'Уник. просмотры', value: overview.unique_product_views, fill: colors.views },
        { name: 'Менеджер', value: overview.ask_manager, fill: colors.manager },
    ]

    const CustomTooltip = ({ active, payload, label }: any) => {
        if (!active || !payload?.length) return null

        return (
            <div className="rounded-lg border border-slate-700 bg-slate-950/95 p-4 shadow-xl">
                <div className="mb-3 border-b border-slate-800 pb-2 text-sm font-semibold text-white">
                    {formatDate(label)}
                </div>
                <div className="space-y-2">
                    {payload.map((entry: any) => (
                        <div key={entry.dataKey} className="flex min-w-52 items-center justify-between gap-4 text-xs">
                            <span className="flex items-center gap-2 text-slate-400">
                                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
                                {entry.name}
                            </span>
                            <span className="font-semibold text-white">{Number(entry.value || 0).toLocaleString('ru-RU')}</span>
                        </div>
                    ))}
                </div>
            </div>
        )
    }

    return (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
            <Card className="border-slate-800 bg-slate-900/70 shadow-xl xl:col-span-8">
                <CardHeader className="flex flex-col gap-1 space-y-0 p-5 sm:flex-row sm:items-end sm:justify-between sm:p-6 sm:pb-5">
                    <div>
                        <CardTitle className="text-lg text-white">Динамика аудитории</CardTitle>
                        <CardDescription>Уникальные посетители, просмотры товаров и обращения к менеджеру.</CardDescription>
                    </div>
                    <div className="text-xs font-medium text-slate-500">Автообновление каждые 30 секунд</div>
                </CardHeader>
                <CardContent className="h-[340px] w-full p-5 pt-0 sm:p-6 sm:pt-0">
                    {safeSeries.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={safeSeries} margin={{ top: 8, right: 12, left: -18, bottom: 8 }}>
                                <defs>
                                    <linearGradient id="visitorsGradient" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor={colors.visitors} stopOpacity={0.2} />
                                        <stop offset="95%" stopColor={colors.visitors} stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="viewsGradient" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor={colors.views} stopOpacity={0.18} />
                                        <stop offset="95%" stopColor={colors.views} stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid stroke="#1E293B" strokeDasharray="3 3" vertical={false} />
                                <XAxis dataKey="dateLabel" stroke="#94A3B8" fontSize={12} tickLine={false} axisLine={{ stroke: '#334155' }} interval="preserveStartEnd" minTickGap={20} />
                                <YAxis stroke="#94A3B8" fontSize={12} tickLine={false} axisLine={{ stroke: '#334155' }} width={46} allowDecimals={false} tickFormatter={formatAxisNumber} />
                                <Tooltip content={<CustomTooltip />} />
                                <Legend formatter={(value) => <span className="text-xs font-medium text-slate-400">{value}</span>} />
                                <Area type="monotone" dataKey="visitors" name="Посетители" stroke={colors.visitors} strokeWidth={3} fill="url(#visitorsGradient)" />
                                <Area type="monotone" dataKey="views" name="Уникальные просмотры" stroke={colors.views} strokeWidth={3} fill="url(#viewsGradient)" />
                                <Area type="monotone" dataKey="manager" name="Спросить у менеджера" stroke={colors.manager} strokeWidth={2} fill="none" />
                            </AreaChart>
                        </ResponsiveContainer>
                    ) : (
                        <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-slate-800 text-sm font-medium text-slate-500">
                            Недостаточно данных для графика
                        </div>
                    )}
                </CardContent>
            </Card>

            <Card className="border-slate-800 bg-slate-900/70 shadow-xl xl:col-span-4">
                <CardHeader className="p-5 sm:p-6 sm:pb-5">
                    <CardTitle className="text-lg text-white">Ключевые показатели</CardTitle>
                    <CardDescription>Сравнение самых важных счетчиков на одном графике.</CardDescription>
                </CardHeader>
                <CardContent className="h-[340px] w-full p-5 pt-0 sm:p-6 sm:pt-0">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={summaryBars} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 8 }}>
                            <CartesianGrid stroke="#1E293B" strokeDasharray="3 3" horizontal={false} />
                            <XAxis type="number" stroke="#64748B" fontSize={12} tickLine={false} axisLine={false} />
                            <YAxis dataKey="name" type="category" width={112} stroke="#CBD5E1" fontSize={12} tickLine={false} axisLine={false} />
                            <Tooltip
                                cursor={{ fill: 'rgba(148, 163, 184, 0.05)' }}
                                contentStyle={{
                                    backgroundColor: '#0F172A',
                                    border: '1px solid #1E293B',
                                    borderRadius: 8,
                                    color: '#F8FAFC',
                                }}
                            />
                            <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={28}>
                                {summaryBars.map(item => (
                                    <Cell key={item.name} fill={item.fill} />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </CardContent>
            </Card>
        </div>
    )
}
