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
    minimal?: boolean
}

const COLORS = ['#5D5FEF', '#FFB800', '#FA5A7D', '#10B981', '#FF947A']

export default function AnalyticsCharts({ seriesData, overview, minimal }: AnalyticsChartsProps) {
    if (minimal) {
        return (
            <div className="h-full w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={seriesData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                        <defs>
                            <linearGradient id="colorViewsMain" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#5D5FEF" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="#5D5FEF" stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <Tooltip 
                            contentStyle={{ 
                                backgroundColor: '#0F172A', 
                                borderRadius: '16px', 
                                border: '1px solid #1E293B', 
                                boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
                                color: '#F8F9FA'
                            }}
                            itemStyle={{ color: '#F8F9FA' }}
                        />
                        <Area type="monotone" dataKey="views" name="Активность" stroke="#5D5FEF" strokeWidth={3} fillOpacity={1} fill="url(#colorViewsMain)" />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        )
    }

    // Format data for the pie chart
    const eventDistribution = [
        { name: 'Просмотры', value: overview.product_views },
        { name: 'В корзину', value: overview.add_to_cart },
        { name: 'В избранное', value: overview.add_to_favorites },
        { name: 'Вопросы', value: overview.ask_manager },
        { name: 'Заказы', value: overview.order_submit }
    ].filter(i => i.value > 0).sort((a, b) => b.value - a.value)

    const funnelData = [
        { name: 'Просмотры', value: overview.product_views },
        { name: 'Корзина', value: overview.add_to_cart },
        { name: 'Заказы', value: overview.order_submit }
    ]

    const CustomTooltip = ({ active, payload, label }: any) => {
        if (active && payload && payload.length) {
            return (
                <div className="bg-slate-900 border border-slate-800 p-5 rounded-[24px] shadow-3xl backdrop-blur-xl">
                    <p className="text-white font-black mb-4 pb-2 border-b border-slate-800 text-sm tracking-tight">{label}</p>
                    <div className="space-y-3">
                        {payload.map((entry: any, index: number) => (
                            <div key={index} className="flex items-center gap-4 text-xs font-bold">
                                <span className="w-3 h-3 rounded-full shadow-[0_0_8px_rgba(255,255,255,0.2)]" style={{ backgroundColor: entry.color }} />
                                <span className="text-slate-400 uppercase tracking-tighter">{entry.name}:</span>
                                <span className="font-black text-white ml-auto">{entry.value.toLocaleString()}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )
        }
        return null
    }

    return (
        <div className="space-y-10">
            {/* Main Area Chart */}
            <div className="bg-slate-900/50 rounded-[40px] p-10 border border-slate-800 shadow-2xl backdrop-blur-sm">
                <div className="mb-10 flex items-center justify-between">
                    <div>
                        <h3 className="text-2xl font-black text-white tracking-tight">Динамика <span className="text-[#5D5FEF]">активности</span></h3>
                        <p className="text-slate-500 text-sm font-medium mt-1">Взаимодействия пользователей по дням</p>
                    </div>
                </div>
                <div className="h-[400px] w-full">
                    {seriesData && seriesData.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={seriesData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="colorViews" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#5D5FEF" stopOpacity={0.2} />
                                        <stop offset="95%" stopColor="#5D5FEF" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" vertical={false} />
                                <XAxis dataKey="date" stroke="#475569" fontSize={11} fontWeight="bold" tickLine={false} axisLine={false} dy={15} />
                                <YAxis stroke="#475569" fontSize={11} fontWeight="bold" tickLine={false} axisLine={false} dx={-15} />
                                <Tooltip content={<CustomTooltip />} />
                                <Legend 
                                    wrapperStyle={{ paddingTop: '40px' }} 
                                    formatter={(value) => <span className="text-slate-400 text-xs font-black uppercase tracking-widest">{value}</span>}
                                />
                                <Area type="monotone" dataKey="views" name="Просмотры" stroke="#5D5FEF" strokeWidth={4} fillOpacity={1} fill="url(#colorViews)" />
                                <Area type="monotone" dataKey="carts" name="Корзина" stroke="#FF947A" strokeWidth={3} fill="none" />
                                <Area type="monotone" dataKey="manager" name="Менеджер" stroke="#10B981" strokeWidth={3} fill="none" />
                                <Area type="monotone" dataKey="favorites" name="Избранное" stroke="#FFD026" strokeWidth={3} fill="none" />
                            </AreaChart>
                        </ResponsiveContainer>
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-slate-700 font-black uppercase tracking-widest text-sm">
                            Недостаточно данных для визуализации
                        </div>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                <div className="bg-slate-900/50 rounded-[40px] p-10 border border-slate-800 shadow-2xl">
                    <h3 className="text-xl font-black text-white mb-10 tracking-tight">Распределение действий</h3>
                    <div className="h-[320px] w-full">
                        {eventDistribution.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={eventDistribution}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={80}
                                        outerRadius={110}
                                        paddingAngle={10}
                                        dataKey="value"
                                        stroke="none"
                                    >
                                        {eventDistribution.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                        ))}
                                    </Pie>
                                    <Tooltip 
                                        contentStyle={{ backgroundColor: '#0F172A', borderRadius: '20px', border: '1px solid #1E293B', color: '#F8F9FA' }}
                                    />
                                    <Legend 
                                        verticalAlign="bottom" 
                                        height={36} 
                                        formatter={(value) => <span className="text-slate-400 text-[10px] font-black uppercase tracking-tighter">{value}</span>}
                                    />
                                </PieChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="w-full h-full flex items-center justify-center text-slate-700 font-black">НЕТ ДАННЫХ</div>
                        )}
                    </div>
                </div>

                <div className="bg-slate-900/50 rounded-[40px] p-10 border border-slate-800 shadow-2xl">
                    <h3 className="text-xl font-black text-white mb-10 tracking-tight">Воронка конверсии</h3>
                    <div className="h-[320px] w-full">
                        {funnelData[0].value > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={funnelData} layout="vertical" margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" horizontal={false} />
                                    <XAxis type="number" stroke="#475569" fontSize={10} fontWeight="bold" tickLine={false} axisLine={false} />
                                    <YAxis dataKey="name" type="category" stroke="#F8F9FA" fontSize={11} fontWeight="black" tickLine={false} axisLine={false} />
                                    <Tooltip cursor={{ fill: 'rgba(255,255,255,0.03)' }} content={<CustomTooltip />} />
                                    <Bar dataKey="value" name="Кол-во" radius={[0, 12, 12, 0]} barSize={45}>
                                        {funnelData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={index === 0 ? '#5D5FEF' : index === 1 ? '#FFD026' : '#10B981'} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="w-full h-full flex items-center justify-center text-slate-700 font-black">НЕТ ДАННЫХ</div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
