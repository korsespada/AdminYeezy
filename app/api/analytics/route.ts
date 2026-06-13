import { NextResponse } from "next/server";
import { analyticsQuery } from "@/lib/db";
import { isAdminAuthError, requireAdmin } from "@/lib/admin-session";

export const dynamic = "force-dynamic";

type AnalyticsChannel = "all" | "site" | "telegram";

const MAX_ANALYTICS_BODY_BYTES = 16 * 1024;
const MAX_TEXT_FIELD_LENGTH = 500;
const ALLOWED_ANALYTICS_EVENTS = new Set([
  "page_view",
  "product_view",
  "add_to_cart",
  "add_to_favorites",
  "order_success",
  "order_submit",
  "ask_manager",
]);

const emptyOverviewRow = {
  unique_visitors: "0",
  unique_product_viewers: "0",
  viewed_products: "0",
  unique_product_views: "0",
  product_views: "0",
  add_to_cart: "0",
  add_to_favorites: "0",
  order_submit: "0",
  ask_manager: "0",
  page_views: "0",
  total_events: "0",
  returning_visitors: "0",
  new_visitors: "0",
  online_now: "0",
};

const emptyProfileRow = {
  total_profiles: "0",
  new_profiles: "0",
  returning_profiles: "0",
  active_profiles: "0",
  cart_profiles: "0",
  cart_items: "0",
  favorite_profiles: "0",
  favorite_items: "0",
};

function isDatabaseConnectionError(error: any) {
  const message = String(error?.message || "").toLowerCase();

  return (
    message.includes("connection terminated due to connection timeout") ||
    message.includes("connection timeout") ||
    message.includes("timeout expired") ||
    message.includes("econnrefused") ||
    message.includes("enotfound") ||
    message.includes("etimedout")
  );
}

function getAnalyticsDatabaseConfigError() {
  if (!process.env.ANALYTICS_DATABASE_URL && !process.env.DATABASE_URL) {
    return "Не задан DATABASE_URL или ANALYTICS_DATABASE_URL для базы аналитики.";
  }

  return null;
}

async function safeAnalyticsQuery<T extends { rows: any[] }>(
  label: string,
  sql: string,
  fallbackRows: T["rows"],
  required = false,
) {
  try {
    return await analyticsQuery(sql);
  } catch (error: any) {
    console.error(`${label} query failed:`, error.message);

    if (required || isDatabaseConnectionError(error)) {
      throw error;
    }

    return { rows: fallbackRows };
  }
}

function getAnalyticsChannel(channel: string | null): AnalyticsChannel {
  if (channel === "telegram") return "telegram";
  if (channel === "site") return "site";
  return "all";
}

function getChannelSql(channel: AnalyticsChannel, alias?: string) {
  if (channel === "all") return "1=1";

  const prefix = alias ? `${alias}.` : "";
  return `COALESCE(NULLIF(${prefix}meta->>'channel', ''), NULLIF(${prefix}meta->>'source', ''), 'site') = '${channel}'`;
}

function getPeriodSql(period: string) {
  if (period === "week") {
    return {
      timeFilter: "created_at >= NOW() - INTERVAL '7 days'",
      periodStart: "NOW() - INTERVAL '7 days'",
    };
  }

  if (period === "month") {
    return {
      timeFilter: "created_at >= NOW() - INTERVAL '30 days'",
      periodStart: "NOW() - INTERVAL '30 days'",
    };
  }

  if (period === "all") {
    return {
      timeFilter: "1=1",
      periodStart: null,
    };
  }

  return {
    timeFilter: "created_at >= NOW() - INTERVAL '1 day'",
    periodStart: "NOW() - INTERVAL '1 day'",
  };
}

export async function GET(request: Request) {
  try {
    await requireAdmin();

    const configError = getAnalyticsDatabaseConfigError();
    if (configError) {
      return NextResponse.json({ error: configError }, { status: 500 });
    }

    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "today";
    const channel = getAnalyticsChannel(searchParams.get("channel"));
    const { timeFilter, periodStart } = getPeriodSql(period);
    const channelFilter = getChannelSql(channel);
    const onlineChannelFilter = getChannelSql(channel);

    const returningSessionsSql =
      period === "all"
        ? `SELECT session_id
           FROM analytics_events
           WHERE session_id IS NOT NULL AND session_id != ''
             AND ${channelFilter}
           GROUP BY session_id
           HAVING COUNT(DISTINCT DATE(created_at)) > 1`
        : `SELECT ps.session_id
           FROM period_sessions ps
           WHERE EXISTS (
             SELECT 1
             FROM analytics_events previous
             WHERE previous.session_id = ps.session_id
               AND previous.created_at < ${periodStart}
           )`;

    const overviewSql = `
      WITH period_events AS (
        SELECT *
        FROM analytics_events
        WHERE ${timeFilter}
          AND ${channelFilter}
      ),
      period_sessions AS (
        SELECT DISTINCT session_id
        FROM period_events
        WHERE session_id IS NOT NULL AND session_id != ''
      ),
      returning_sessions AS (
        ${returningSessionsSql}
      )
      SELECT
        COUNT(DISTINCT pe.session_id) as unique_visitors,
        COUNT(DISTINCT pe.session_id) FILTER (WHERE pe.event = 'product_view') as unique_product_viewers,
        COUNT(DISTINCT pe."productId") FILTER (WHERE pe.event = 'product_view' AND pe."productId" IS NOT NULL AND pe."productId" != '') as viewed_products,
        COUNT(DISTINCT CONCAT(pe.session_id, ':', pe."productId")) FILTER (
          WHERE pe.event = 'product_view'
            AND pe.session_id IS NOT NULL
            AND pe.session_id != ''
            AND pe."productId" IS NOT NULL
            AND pe."productId" != ''
        ) as unique_product_views,
        COUNT(*) FILTER (WHERE pe.event = 'product_view') as product_views,
        COUNT(*) FILTER (WHERE pe.event = 'add_to_cart') as add_to_cart,
        COUNT(*) FILTER (WHERE pe.event = 'add_to_favorites') as add_to_favorites,
        COUNT(*) FILTER (WHERE pe.event = 'order_success' OR pe.event = 'order_submit') as order_submit,
        COUNT(*) FILTER (WHERE pe.event = 'ask_manager') as ask_manager,
        COUNT(*) FILTER (WHERE pe.event = 'page_view') as page_views,
        COUNT(*) as total_events,
        (SELECT COUNT(*) FROM returning_sessions) as returning_visitors,
        GREATEST(COUNT(DISTINCT pe.session_id) - (SELECT COUNT(*) FROM returning_sessions), 0) as new_visitors,
        (SELECT COUNT(DISTINCT session_id) FROM analytics_events WHERE created_at >= NOW() - INTERVAL '5 minutes' AND ${onlineChannelFilter}) as online_now
      FROM period_events pe
    `;

    const profilesSql = `
      SELECT
        COUNT(*) as total_profiles,
        COUNT(*) FILTER (${period === "all" ? "WHERE TRUE" : `WHERE created_at >= ${periodStart}`}) as new_profiles,
        COUNT(*) FILTER (${period === "all" ? "WHERE updated_at > created_at" : `WHERE created_at < ${periodStart} AND updated_at >= ${periodStart}`}) as returning_profiles,
        COUNT(*) FILTER (${period === "all" ? "WHERE TRUE" : `WHERE updated_at >= ${periodStart}`}) as active_profiles,
        COUNT(*) FILTER (WHERE jsonb_typeof(cart) = 'array' AND jsonb_array_length(cart) > 0) as cart_profiles,
        COALESCE(SUM(CASE WHEN jsonb_typeof(cart) = 'array' THEN jsonb_array_length(cart) ELSE 0 END), 0) as cart_items,
        COUNT(*) FILTER (WHERE jsonb_typeof(favorites) = 'array' AND jsonb_array_length(favorites) > 0) as favorite_profiles,
        COALESCE(SUM(CASE WHEN jsonb_typeof(favorites) = 'array' THEN jsonb_array_length(favorites) ELSE 0 END), 0) as favorite_items
      FROM profiles
    `;

    const seriesSql = `
      SELECT 
        TO_CHAR(created_at, 'YYYY-MM-DD') as date,
        COUNT(DISTINCT session_id) as visitors,
        COUNT(DISTINCT CONCAT(session_id, ':', "productId")) FILTER (
          WHERE event = 'product_view'
            AND session_id IS NOT NULL
            AND session_id != ''
            AND "productId" IS NOT NULL
            AND "productId" != ''
        ) as views,
        COUNT(*) FILTER (WHERE event = 'add_to_cart') as carts,
        COUNT(*) FILTER (WHERE event = 'add_to_favorites') as favorites,
        COUNT(*) FILTER (WHERE event = 'ask_manager') as manager
      FROM analytics_events
      WHERE ${timeFilter}
        AND ${channelFilter}
      GROUP BY date
      ORDER BY date ASC
    `;

    const countrySql = `
      SELECT COALESCE(NULLIF(meta->>'country', ''), 'Unknown') as name, COUNT(DISTINCT session_id) as visitors
      FROM analytics_events
      WHERE ${timeFilter}
        AND ${channelFilter}
      GROUP BY COALESCE(NULLIF(meta->>'country', ''), 'Unknown')
      ORDER BY visitors DESC
      LIMIT 10
    `;

    const osSql = `
      SELECT COALESCE(NULLIF(meta->>'os', ''), 'Unknown') as name, COUNT(DISTINCT session_id) as visitors
      FROM analytics_events
      WHERE ${timeFilter}
        AND ${channelFilter}
      GROUP BY COALESCE(NULLIF(meta->>'os', ''), 'Unknown')
      ORDER BY visitors DESC
      LIMIT 5
    `;

    const [overviewRes, profilesRes, seriesRes, countryRes, osRes] = await Promise.all([
      safeAnalyticsQuery("Overview", overviewSql, [emptyOverviewRow], true),
      safeAnalyticsQuery("Profiles", profilesSql, [emptyProfileRow]),
      safeAnalyticsQuery("Series", seriesSql, []),
      safeAnalyticsQuery("Country", countrySql, []),
      safeAnalyticsQuery("OS", osSql, []),
    ]);

    const row = overviewRes.rows[0] || emptyOverviewRow;
    const profileRow = profilesRes.rows[0] || emptyProfileRow;
    const overview = {
      unique_visitors: parseInt(row.unique_visitors || 0),
      unique_product_viewers: parseInt(row.unique_product_viewers || 0),
      viewed_products: parseInt(row.viewed_products || 0),
      unique_product_views: parseInt(row.unique_product_views || 0),
      product_views: parseInt(row.product_views || 0),
      add_to_cart: parseInt(row.add_to_cart || 0),
      add_to_favorites: parseInt(row.add_to_favorites || 0),
      order_submit: parseInt(row.order_submit || 0),
      ask_manager: parseInt(row.ask_manager || 0),
      page_views: parseInt(row.page_views || 0),
      total_events: parseInt(row.total_events || 0),
      returning_visitors: parseInt(profileRow.returning_profiles || row.returning_visitors || 0),
      new_visitors: parseInt(row.new_visitors || 0),
      total_profiles: parseInt(profileRow.total_profiles || 0),
      active_profiles: parseInt(profileRow.active_profiles || 0),
      returning_profiles: parseInt(profileRow.returning_profiles || 0),
      cart_profiles: parseInt(profileRow.cart_profiles || 0),
      cart_items: parseInt(profileRow.cart_items || 0),
      favorite_profiles: parseInt(profileRow.favorite_profiles || 0),
      favorite_items: parseInt(profileRow.favorite_items || 0),
      online_now: parseInt(row.online_now || 0),
      new_profiles: parseInt(profileRow.new_profiles || 0),
    };

    return NextResponse.json({
      overview,
      seriesData: seriesRes.rows,
      countryList: countryRes.rows,
      osList: osRes.rows,
      updatedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    if (isAdminAuthError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.error("Analytics error:", error);
    const message = isDatabaseConnectionError(error)
      ? "Не удалось подключиться к базе аналитики. Проверь DATABASE_URL/ANALYTICS_DATABASE_URL и доступность Postgres из окружения админки."
      : error.message;

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const configError = getAnalyticsDatabaseConfigError();
    if (configError) {
      return NextResponse.json(
        { error: configError },
        { status: 500, headers: corsHeaders() },
      );
    }

    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > MAX_ANALYTICS_BODY_BYTES) {
      return NextResponse.json(
        { error: "Request body too large" },
        { status: 413, headers: corsHeaders() },
      );
    }

    let body: any;
    try {
      body = JSON.parse(rawBody || "{}");
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON" },
        { status: 400, headers: corsHeaders() },
      );
    }
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

    const normalizedEvent = String(event).trim();
    const normalizedSessionId = String(session_id).trim();
    if (!ALLOWED_ANALYTICS_EVENTS.has(normalizedEvent)) {
      return NextResponse.json(
        { error: "Unsupported event" },
        { status: 400, headers: corsHeaders() },
      );
    }

    if (!normalizedSessionId || normalizedSessionId.length > 128) {
      return NextResponse.json(
        { error: "Invalid session_id" },
        { status: 400, headers: corsHeaders() },
      );
    }

    const safeProductId = productId ? String(productId).slice(0, 128) : null;
    const safeName = name ? String(name).slice(0, MAX_TEXT_FIELD_LENGTH) : "";
    const safeUserAgent = user_agent ? String(user_agent).slice(0, MAX_TEXT_FIELD_LENGTH) : "";
    const safeMeta = meta && typeof meta === "object" && !Array.isArray(meta) ? meta : {};

    await analyticsQuery(
      `
        INSERT INTO analytics_events (
          event, "productId", name, price, session_id, user_agent, meta, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      `,
      [
        normalizedEvent,
        safeProductId,
        safeName,
        Number.isFinite(Number(price)) ? Number(price) : 0,
        normalizedSessionId,
        safeUserAgent,
        JSON.stringify(safeMeta),
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

export async function DELETE(request: Request) {
  try {
    await requireAdmin();

    const configError = getAnalyticsDatabaseConfigError();
    if (configError) {
      return NextResponse.json({ error: configError }, { status: 500 });
    }

    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") || "period";
    const period = searchParams.get("period") || "today";
    const channel = getAnalyticsChannel(searchParams.get("channel"));
    const channelFilter = getChannelSql(channel);

    if (type === "all") {
      await analyticsQuery(channel === "all" ? "DELETE FROM analytics_events" : `DELETE FROM analytics_events WHERE ${channelFilter}`);
    } else {
      const { timeFilter } = getPeriodSql(period);
      await analyticsQuery(`DELETE FROM analytics_events WHERE ${timeFilter} AND ${channelFilter}`);
    }

    return NextResponse.json({
      success: true,
      message: `Статистика очищена (${type === "all" ? "все время" : period})`,
    });
  } catch (error: any) {
    if (isAdminAuthError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.error("Analytics DELETE error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
