import React from 'react'
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    BarChart,
    Bar,
    PieChart,
    Pie,
    Cell,
    Legend
} from 'recharts'

interface SeriesData {
    date: string
    views: number
    carts: number
    manager: number
    favorites: number
}

interface AnalyticsChartsProps {
    seriesData: SeriesData[]
    overview: {
        page_views: number
        product_views: number
        add_to_cart: number
        add_to_favorites: number
        order_submit: number
        ask_manager: number
    }
}

const COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6']

export default function AnalyticsCharts({ seriesData, overview }: AnalyticsChartsProps) {
    // Format data for the pie chart
    const eventDistribution = [
        { name: 'Просмотры товаров', value: overview.product_views },
        { name: 'В корзину', value: overview.add_to_cart },
        { name: 'В избранное', value: overview.add_to_favorites },
        { name: 'Вопросы', value: overview.ask_manager },
        { name: 'Заказы', value: overview.order_submit }
    ].filter(i => i.value > 0).sort((a, b) => b.value - a.value)

    // Format data for the conversion funnel
    const funnelData = [
        { name: 'Просмотры', value: overview.product_views },
        { name: 'Корзина', value: overview.add_to_cart },
        { name: 'Заказы', value: overview.order_submit }
    ]

    const CustomTooltip = ({ active, payload, label }: any) => {
        if (active && payload && payload.length) {
            return (
                <div className="bg-slate-800 border border-slate-700 p-3 rounded-lg shadow-xl">
                    <p className="text-slate-300 font-medium mb-2 pb-2 border-b border-slate-700">{label}</p>
                    {payload.map((entry: any, index: number) => (
                        <div key={index} className="flex items-center gap-2 text-sm my-1">
                            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
                            <span className="text-slate-400 capitalize">{entry.name}:</span>
                            <span className="font-bold text-slate-100">{entry.value}</span>
                        </div>
                    ))}
                </div>
            )
        }
        return null
    }

    return (
        <div className="space-y-6 mb-8">
            {/* Main Area Chart for Activity Trends */}
            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
                <div className="mb-6">
                    <h3 className="text-lg font-bold text-slate-100">Динамика активности</h3>
                    <p className="text-sm text-slate-400">Просмотры, добавления в корзину и обращения к менеджеру со временем</p>
                </div>
                <div className="h-[300px] w-full">
                    {seriesData && seriesData.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={seriesData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="colorViews" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="colorCarts" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="colorManager" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="colorFavorites" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#ec4899" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#ec4899" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                                <XAxis dataKey="date" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} dy={10} />
                                <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} dx={-10} />
                                <Tooltip content={<CustomTooltip />} />
                                <Legend wrapperStyle={{ paddingTop: '20px' }} />
                                <Area type="monotone" dataKey="views" name="Просмотры" stroke="#6366f1" strokeWidth={2} fillOpacity={1} fill="url(#colorViews)" />
                                <Area type="monotone" dataKey="carts" name="В корзину" stroke="#f59e0b" strokeWidth={2} fillOpacity={1} fill="url(#colorCarts)" />
                                <Area type="monotone" dataKey="manager" name="Менеджер" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#colorManager)" />
                                <Area type="monotone" dataKey="favorites" name="Избранное" stroke="#ec4899" strokeWidth={2} fillOpacity={1} fill="url(#colorFavorites)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-slate-500 text-sm">
                            Недостаточно данных для построения графика
                        </div>
                    )}
                </div>
            </div>

            {/* Bottom Row: Funnel and Pie Chart */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                {/* Event Distribution Pie */}
                <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
                    <div className="mb-4">
                        <h3 className="text-lg font-bold text-slate-100">Используемые функции</h3>
                        <p className="text-sm text-slate-400">Как распределены действия пользователей</p>
                    </div>
                    <div className="h-[250px] w-full">
                        {eventDistribution.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={eventDistribution}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={60}
                                        outerRadius={80}
                                        paddingAngle={5}
                                        dataKey="value"
                                    >
                                        {eventDistribution.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                        ))}
                                    </Pie>
                                    <Tooltip
                                        contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', borderRadius: '0.5rem' }}
                                        itemStyle={{ color: '#f1f5f9' }}
                                    />
                                    <Legend />
                                </PieChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="w-full h-full flex items-center justify-center text-slate-500 text-sm">Нет данных</div>
                        )}
                    </div>
                </div>

                {/* Conversion Funnel (Bar Chart showing drop-off) */}
                <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
                    <div className="mb-4">
                        <h3 className="text-lg font-bold text-slate-100">Воронка продаж</h3>
                        <p className="text-sm text-slate-400">Конверсия из просмотра в заказ</p>
                    </div>
                    <div className="h-[250px] w-full">
                        {funnelData[0].value > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart
                                    data={funnelData}
                                    layout="vertical"
                                    margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                                >
                                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
                                    <XAxis type="number" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                                    <YAxis dataKey="name" type="category" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                                    <Tooltip
                                        cursor={{ fill: '#334155', opacity: 0.4 }}
                                        contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', borderRadius: '0.5rem' }}
                                    />
                                    <Bar dataKey="value" name="Событий" fill="#6366f1" radius={[0, 4, 4, 0]}>
                                        {funnelData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={
                                                index === 0 ? '#3b82f6' :
                                                    index === 1 ? '#f59e0b' :
                                                        '#10b981'
                                            } />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="w-full h-full flex items-center justify-center text-slate-500 text-sm">Нет данных</div>
                        )}
                    </div>
                </div>

            </div>
        </div>
    )
}
