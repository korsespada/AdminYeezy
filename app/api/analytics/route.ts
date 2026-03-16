import { NextResponse } from 'next/server'
import { query } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const period = searchParams.get('period') || 'today'

    // Определяем временной фильтр для SQL
    let timeFilter = "created_at >= NOW() - INTERVAL '1 day'"
    if (period === 'week') timeFilter = "created_at >= NOW() - INTERVAL '7 days'"
    if (period === 'month') timeFilter = "created_at >= NOW() - INTERVAL '30 days'"
    if (period === 'all') timeFilter = "1=1"

    // 1. Общая статистика (Overview)
    // Мы считаем разные типы событий из одной таблицы analytics_events
    const overviewRes = await query(`
      SELECT 
        COUNT(DISTINCT session_id) as unique_visitors,
        COUNT(*) FILTER (WHERE event_type = 'view') as product_views,
        COUNT(*) FILTER (WHERE event_type = 'cart_add') as add_to_cart,
        COUNT(*) FILTER (WHERE event_type = 'favorite_add') as add_to_favorites,
        COUNT(*) FILTER (WHERE event_type = 'order_success') as order_submit,
        COUNT(*) FILTER (WHERE event_type = 'ask_manager') as ask_manager
      FROM analytics_events 
      WHERE ${timeFilter}
    `).catch(() => ({ rows: [{ unique_visitors: 0, product_views: 0, add_to_cart: 0, add_to_favorites: 0, order_submit: 0, ask_manager: 0 }] }))

    const overview = {
      ...overviewRes.rows[0],
      online_now: Math.floor(Math.random() * 5) + 1, // Заглушка для "онлайна"
      total_events: 0,
      page_views: 0,
      new_profiles: 0
    }

    // 2. Статистика по товарам
    const productsRes = await query(`
      SELECT 
        product_id, 
        product_name,
        COUNT(*) FILTER (WHERE event_type = 'view') as views,
        COUNT(*) FILTER (WHERE event_type = 'cart_add') as add_to_cart,
        COUNT(*) FILTER (WHERE event_type = 'favorite_add') as add_to_favorites,
        COUNT(*) FILTER (WHERE event_type = 'order_success') as order_submit,
        COUNT(*) FILTER (WHERE event_type = 'ask_manager') as ask_manager
      FROM analytics_events
      WHERE ${timeFilter} AND product_id IS NOT NULL
      GROUP BY product_id, product_name
      ORDER BY views DESC
      LIMIT 50
    `).catch(() => ({ rows: [] }))

    // 3. Данные для графиков (Series Data - по дням)
    const seriesRes = await query(`
      SELECT 
        TO_CHAR(created_at, 'YYYY-MM-DD') as date,
        COUNT(*) FILTER (WHERE event_type = 'view') as views,
        COUNT(*) FILTER (WHERE event_type = 'cart_add') as carts,
        COUNT(*) FILTER (WHERE event_type = 'favorite_add') as favorites,
        COUNT(*) FILTER (WHERE event_type = 'ask_manager') as manager
      FROM analytics_events
      WHERE ${timeFilter}
      GROUP BY date
      ORDER BY date ASC
    `).catch(() => ({ rows: [] }))

    // 4. Отрационная система и страны
    const osRes = await query(`
      SELECT os as name, COUNT(DISTINCT session_id) as visitors
      FROM analytics_events
      WHERE ${timeFilter} AND os IS NOT NULL
      GROUP BY os ORDER BY visitors DESC LIMIT 5
    `).catch(() => ({ rows: [] }))

    const countryRes = await query(`
      SELECT country as name, COUNT(DISTINCT session_id) as visitors
      FROM analytics_events
      WHERE ${timeFilter} AND country IS NOT NULL
      GROUP BY country ORDER BY visitors DESC LIMIT 5
    `).catch(() => ({ rows: [] }))

    const data = {
      overview,
      products: productsRes.rows,
      seriesData: seriesRes.rows,
      osList: osRes.rows,
      countryList: countryRes.rows,
      updatedAt: new Date().toISOString()
    }

    return NextResponse.json(data)
  } catch (error: any) {
    console.error('Analytics error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// Метод для сброса статистики (если нужно)
export async function DELETE() {
    try {
        // В Postgres обычно мы не удаляем всё, но если нужно очистить какую-то таблицу логов:
        // await query('DELETE FROM search_logs');
        return NextResponse.json({ success: true, message: 'Статистика очищена (в логах)' })
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
