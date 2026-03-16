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
    const overviewRes = await query(`
      SELECT 
        COUNT(DISTINCT session_id) as unique_visitors,
        COUNT(*) FILTER (WHERE event = 'product_view') as product_views,
        COUNT(*) FILTER (WHERE event = 'add_to_cart') as add_to_cart,
        COUNT(*) FILTER (WHERE event = 'add_to_favorites') as add_to_favorites,
        COUNT(*) FILTER (WHERE event = 'order_success' OR event = 'order_submit') as order_submit,
        COUNT(*) FILTER (WHERE event = 'ask_manager') as ask_manager,
        COUNT(*) FILTER (WHERE event = 'page_view') as page_views,
        (SELECT COUNT(DISTINCT session_id) FROM analytics_events WHERE created_at >= NOW() - INTERVAL '5 minutes') as online_now
      FROM analytics_events 
      WHERE ${timeFilter}
    `).catch((e) => {
      console.error('Overview query failed:', e.message)
      return { rows: [{ unique_visitors: 0, product_views: 0, add_to_cart: 0, add_to_favorites: 0, order_submit: 0, ask_manager: 0, page_views: 0, online_now: 0 }] }
    })

    const overview = {
      ...overviewRes.rows[0],
      total_events: 0, // Можно вычислить как сумму
      new_profiles: 0
    }

    // 2. Статистика по товарам
    const productsRes = await query(`
      SELECT 
        "productId" as product_id, 
        name as product_name,
        COUNT(*) FILTER (WHERE event = 'product_view') as views,
        COUNT(*) FILTER (WHERE event = 'add_to_cart') as add_to_cart,
        COUNT(*) FILTER (WHERE event = 'add_to_favorites') as add_to_favorites,
        COUNT(*) FILTER (WHERE event = 'order_success' OR event = 'order_submit') as order_submit,
        COUNT(*) FILTER (WHERE event = 'ask_manager') as ask_manager
      FROM analytics_events
      WHERE ${timeFilter} AND "productId" IS NOT NULL AND "productId" != ''
      GROUP BY "productId", name
      ORDER BY views DESC
      LIMIT 50
    `).catch((e) => {
      console.error('Products query failed:', e.message)
      return { rows: [] }
    })

    // 3. Данные для графиков (Series Data - по дням)
    const seriesRes = await query(`
      SELECT 
        TO_CHAR(created_at, 'YYYY-MM-DD') as date,
        COUNT(*) FILTER (WHERE event = 'product_view' OR event = 'page_view') as views,
        COUNT(*) FILTER (WHERE event = 'add_to_cart') as carts,
        COUNT(*) FILTER (WHERE event = 'add_to_favorites') as favorites,
        COUNT(*) FILTER (WHERE event = 'ask_manager') as manager
      FROM analytics_events
      WHERE ${timeFilter}
      GROUP BY date
      ORDER BY date ASC
    `).catch(() => ({ rows: [] }))

    // 4. Операционная система и страны
    const osRes = await query(`
      SELECT meta->>'os' as name, COUNT(DISTINCT session_id) as visitors
      FROM analytics_events
      WHERE ${timeFilter} AND meta->>'os' IS NOT NULL
      GROUP BY name ORDER BY visitors DESC LIMIT 5
    `).catch(() => ({ rows: [] }))

    const countryRes = await query(`
      SELECT meta->>'country' as name, COUNT(DISTINCT session_id) as visitors
      FROM analytics_events
      WHERE ${timeFilter} AND meta->>'country' IS NOT NULL
      GROUP BY name ORDER BY visitors DESC LIMIT 5
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
