import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "today";

    // Определяем временной фильтр для SQL
    let timeFilter = "created_at >= NOW() - INTERVAL '1 day'";
    if (period === "week")
      timeFilter = "created_at >= NOW() - INTERVAL '7 days'";
    if (period === "month")
      timeFilter = "created_at >= NOW() - INTERVAL '30 days'";
    if (period === "all") timeFilter = "1=1";

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
        COUNT(*) as total_events,
        (SELECT COUNT(DISTINCT session_id) FROM analytics_events WHERE created_at >= NOW() - INTERVAL '5 minutes') as online_now
      FROM analytics_events 
      WHERE ${timeFilter}
    `).catch((e) => {
      console.error("Overview query failed:", e.message);
      return {
        rows: [
          {
            unique_visitors: "0",
            product_views: "0",
            add_to_cart: "0",
            add_to_favorites: "0",
            order_submit: "0",
            ask_manager: "0",
            page_views: "0",
            total_events: "0",
            online_now: "0",
          },
        ],
      };
    });

    const row = overviewRes.rows[0];
    const overview = {
      unique_visitors: parseInt(row.unique_visitors),
      product_views: parseInt(row.product_views),
      add_to_cart: parseInt(row.add_to_cart),
      add_to_favorites: parseInt(row.add_to_favorites),
      order_submit: parseInt(row.order_submit),
      ask_manager: parseInt(row.ask_manager),
      page_views: parseInt(row.page_views),
      total_events: parseInt(row.total_events),
      online_now: parseInt(row.online_now),
      new_profiles: 0,
    };

    // 2. Статистика по товарам
    const productsRes = await query(`
      WITH stats AS (
        SELECT 
          "productId", 
          MAX(name) FILTER (WHERE name IS NOT NULL AND name NOT IN ('Загрузка...', 'Loading...', 'undefined', 'null', '[object Object]')) as event_name,
          COUNT(*) FILTER (WHERE event = 'product_view') as views,
          COUNT(*) FILTER (WHERE event = 'add_to_cart') as add_to_cart,
          COUNT(*) FILTER (WHERE event = 'add_to_favorites') as add_to_favorites,
          COUNT(*) FILTER (WHERE event = 'order_success' OR event = 'order_submit') as order_submit,
          COUNT(*) FILTER (WHERE event = 'ask_manager') as ask_manager
        FROM analytics_events
        WHERE ${timeFilter} AND "productId" IS NOT NULL AND "productId" != ''
        GROUP BY "productId"
      )
      SELECT 
        s.*,
        p.id as p_id,
        p.name as p_name,
        p.price as p_price,
        p.photos as p_photos,
        p.category as p_category,
        p.subcategory as p_subcategory,
        p.brand as p_brand
      FROM stats s
      LEFT JOIN products p ON p.id = s."productId"
      WHERE s.views > 0 OR s.add_to_cart > 0 OR s.add_to_favorites > 0 OR s.order_submit > 0 OR s.ask_manager > 0
      ORDER BY s.views DESC
      LIMIT 100
    `).catch((e) => {
      console.error("Products query failed:", e.message);
      return { rows: [] };
    });

    // Обработка данных товаров для фронтенда
    const products = productsRes.rows.map(row => ({
        product_id: row.productId,
        product_name: row.p_name || row.event_name || 'Товар #' + row.productId,
        views: parseInt(row.views || 0),
        add_to_cart: parseInt(row.add_to_cart || 0),
        add_to_favorites: parseInt(row.add_to_favorites || 0),
        order_submit: parseInt(row.order_submit || 0),
        ask_manager: parseInt(row.ask_manager || 0),
        fullProduct: row.p_id ? {
            id: row.p_id,
            name: row.p_name,
            price: row.p_price,
            photos: typeof row.p_photos === 'string' ? JSON.parse(row.p_photos) : (row.p_photos || []),
            category: row.p_category,
            subcategory: row.p_subcategory,
            brand: row.p_brand
        } : null
    }));

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
    `).catch(() => ({ rows: [] }));

    // 4. Операционная система и страны
    const osRes = await query(`
      SELECT meta->>'os' as name, COUNT(DISTINCT session_id) as visitors
      FROM analytics_events
      WHERE ${timeFilter} AND meta->>'os' IS NOT NULL
      GROUP BY meta->>'os' ORDER BY visitors DESC LIMIT 5
    `).catch(() => ({ rows: [] }));

    const countryRes = await query(`
      SELECT meta->>'country' as name, COUNT(DISTINCT session_id) as visitors
      FROM analytics_events
      WHERE ${timeFilter} AND meta->>'country' IS NOT NULL
      GROUP BY meta->>'country' ORDER BY visitors DESC LIMIT 5
    `).catch(() => ({ rows: [] }));

    const data = {
      overview,
      products,
      seriesData: seriesRes.rows,
      osList: osRes.rows,
      countryList: countryRes.rows,
      updatedAt: new Date().toISOString(),
    };

    return NextResponse.json(data);
  } catch (error: any) {
    console.error("Analytics error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// Метод для приёма событий аналитики из основного проекта
export async function POST(request: Request) {
  try {
    const body = await request.json();

    const {
      event,
      productId,
      name,
      price,
      session_id,
      user_agent,
      meta = {},
    } = body;

    if (!event || !session_id) {
      return NextResponse.json(
        { error: "Missing required fields: event, session_id" },
        { status: 400, headers: corsHeaders() },
      );
    }

    await query(
      `
            INSERT INTO analytics_events (
                event, "productId", name, price, 
                session_id, user_agent, meta, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
        `,
      [
        event,
        productId || null,
        name || "",
        price || 0,
        session_id,
        user_agent || "",
        JSON.stringify(meta),
      ],
    );

    return NextResponse.json({ success: true }, { headers: corsHeaders() });
  } catch (error: any) {
    console.error("Analytics POST error:", error);
    return NextResponse.json(
      { error: error.message },
      { status: 500, headers: corsHeaders() },
    );
  }
}

// CORS preflight handler
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

// Метод для сброса статистики (если нужно)
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") || "period";
    const period = searchParams.get("period") || "today";

    let result;
    if (type === "all") {
      result = await query('DELETE FROM analytics_events');
    } else {
      let timeFilter = "created_at >= NOW() - INTERVAL '1 day'";
      if (period === "week") timeFilter = "created_at >= NOW() - INTERVAL '7 days'";
      if (period === "month") timeFilter = "created_at >= NOW() - INTERVAL '30 days'";
      
      result = await query(`DELETE FROM analytics_events WHERE ${timeFilter}`);
    }

    return NextResponse.json({
      success: true,
      message: `Статистика очищена (${type === 'all' ? 'всё время' : period})`,
    });
  } catch (error: any) {
    console.error("Analytics DELETE error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
