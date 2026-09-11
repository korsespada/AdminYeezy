import { NextResponse } from "next/server";
import { analyticsQuery } from "@/lib/db";
import { isAdminAuthError, requireAdmin } from "@/lib/admin-session";
import { listRailsCrmOrders } from "@/lib/rails-admin";

export const dynamic = "force-dynamic";

export type AnalyticsChannel = "all" | "site" | "site_desktop" | "site_mobile" | "telegram";

const MAX_ANALYTICS_BODY_BYTES = 16 * 1024;
const MAX_TEXT_FIELD_LENGTH = 500;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const ALLOWED_ANALYTICS_EVENTS = new Set([
  "page_view",
  "product_view",
  "add_to_cart",
  "remove_from_cart",
  "add_to_favorites",
  "remove_from_favorites",
  "view_favorites",
  "order_success",
  "order_submit",
  "checkout_payment_started",
  "purchase",
  "site_click",
  "ask_manager",
  "search",
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
  site_clicks: "0",
  tg_site_clicks: "0",
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

export function getAnalyticsChannel(channel: string | null): AnalyticsChannel {
  if (channel === "telegram") return "telegram";
  if (channel === "site_desktop") return "site_desktop";
  if (channel === "site_mobile") return "site_mobile";
  if (channel === "site") return "site";
  return "all";
}

export function getChannelSql(channel: AnalyticsChannel, alias?: string) {
  const prefix = alias ? `${alias}.` : "";
  const channelExpr = `COALESCE(NULLIF(${prefix}meta->>'channel', ''), NULLIF(${prefix}meta->>'source', ''), 'site')`;

  if (channel === "all") return "1=1";
  if (channel === "telegram") return `${channelExpr} = 'telegram'`;
  if (channel === "site") return `${channelExpr} != 'telegram'`;
  if (channel === "site_desktop") {
    return `(${channelExpr} != 'telegram' AND (${prefix}meta->>'device' = 'desktop' OR (${prefix}meta->>'device' IS NULL AND NOT (${prefix}user_agent ILIKE '%mobile%' OR ${prefix}user_agent ILIKE '%android%' OR ${prefix}user_agent ILIKE '%iphone%'))))`;
  }
  if (channel === "site_mobile") {
    return `(${channelExpr} != 'telegram' AND (${prefix}meta->>'device' = 'mobile' OR ${prefix}user_agent ILIKE '%mobile%' OR ${prefix}user_agent ILIKE '%android%' OR ${prefix}user_agent ILIKE '%iphone%'))`;
  }

  return "1=1";
}

export function getPeriodSql(period: string, from?: string | null, to?: string | null) {
  if (from && DATE_REGEX.test(from)) {
    const safeTo = to && DATE_REGEX.test(to) ? to : from;
    return {
      timeFilter: `created_at >= '${from} 00:00:00'::timestamp AND created_at <= '${safeTo} 23:59:59'::timestamp`,
      periodStart: `'${from} 00:00:00'::timestamp`,
      periodEnd: `'${safeTo} 23:59:59'::timestamp`,
      fromDate: new Date(`${from}T00:00:00Z`),
      toDate: new Date(`${safeTo}T23:59:59Z`),
    };
  }

  const now = new Date();
  if (period === "yesterday") {
    const yesterdayStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    yesterdayStart.setUTCHours(0, 0, 0, 0);
    const yesterdayEnd = new Date(yesterdayStart.getTime() + 24 * 60 * 60 * 1000);
    return {
      timeFilter: "created_at >= (CURRENT_DATE - INTERVAL '1 day') AND created_at < CURRENT_DATE",
      periodStart: "(CURRENT_DATE - INTERVAL '1 day')",
      periodEnd: "CURRENT_DATE",
      fromDate: yesterdayStart,
      toDate: yesterdayEnd,
    };
  }

  if (period === "week") {
    return {
      timeFilter: "created_at >= NOW() - INTERVAL '7 days'",
      periodStart: "NOW() - INTERVAL '7 days'",
      periodEnd: null,
      fromDate: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
      toDate: now,
    };
  }

  if (period === "month") {
    return {
      timeFilter: "created_at >= NOW() - INTERVAL '30 days'",
      periodStart: "NOW() - INTERVAL '30 days'",
      periodEnd: null,
      fromDate: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
      toDate: now,
    };
  }

  if (period === "all") {
    return {
      timeFilter: "1=1",
      periodStart: null,
      periodEnd: null,
      fromDate: null,
      toDate: null,
    };
  }

  // today default
  const todayStart = new Date(now);
  todayStart.setUTCHours(0, 0, 0, 0);
  return {
    timeFilter: "created_at >= CURRENT_DATE",
    periodStart: "CURRENT_DATE",
    periodEnd: null,
    fromDate: todayStart,
    toDate: now,
  };
}

function buildAnalyticsSummary(params: {
  period: string;
  channel: string;
  overview: any;
  financial: any;
  funnel: any[];
  trafficSources: any[];
  searchDemands: any[];
  deviceList: any[];
  countryList: any[];
}): string {
  const pLabels: Record<string, string> = {
    today: "сегодня",
    yesterday: "вчера",
    week: "последние 7 дней",
    month: "последние 30 дней",
    all: "всё время",
  };
  const periodName = pLabels[params.period] || params.period;
  const channelName = params.channel === "all" ? "все каналы" : params.channel;

  const totalVis = params.overview.unique_visitors || 0;
  const newVis = params.overview.new_visitors || 0;
  const retVis = params.overview.returning_visitors || 0;
  const rev = params.financial.revenue || 0;
  const paidOrders = params.financial.paid_orders || 0;
  const aov = params.financial.aov || 0;
  const newBuyers = params.financial.new_buyers || 0;
  const repeatBuyers = params.financial.repeat_buyers || 0;
  const overallConv = params.funnel.length > 0 ? params.funnel[params.funnel.length - 1].rate : 0;

  const lines: string[] = [];
  lines.push(`📊 Сводка YeezyUnique за ${periodName} (${channelName})`);
  lines.push("");
  lines.push(`• Онлайн сейчас: ${params.overview.online_now || 0} чел.`);
  lines.push(`• Трафик: ${totalVis.toLocaleString("ru-RU")} уник. посетителей (новых: ${newVis.toLocaleString("ru-RU")}, вернувшихся: ${retVis.toLocaleString("ru-RU")}), просмотров: ${params.overview.page_views || params.overview.total_events || 0}.`);
  lines.push(`• Выручка CRM: ${rev.toLocaleString("ru-RU")} ₽ | Оплачено заказов: ${paidOrders} (средний чек: ${aov.toLocaleString("ru-RU")} ₽).`);
  lines.push(`• Покупатели CRM: новые: ${newBuyers}, постоянные: ${repeatBuyers}.`);
  lines.push(`• Сквозная конверсия в оплату: ${overallConv}%.`);

  if (params.trafficSources.length > 0) {
    lines.push("");
    lines.push("• Источники трафика:");
    for (const src of params.trafficSources.slice(0, 4)) {
      lines.push(`  - ${src.name}: ${src.visitors} виз., корзин: ${src.carts} (${src.cartRate}%), заказов: ${src.checkouts} (${src.checkoutRate}%)`);
    }
  }

  if (params.searchDemands.length > 0) {
    const topQ = params.searchDemands.slice(0, 5).map((s: any) => `«${s.query}» (${s.searches})`).join(", ");
    lines.push("");
    lines.push(`• Поисковый спрос на витрине: ${topQ}`);
  }

  if (params.deviceList.length > 0) {
    const totalD = params.deviceList.reduce((acc: number, d: any) => acc + Number(d.visitors || 0), 0) || 1;
    const mob = params.deviceList.find((d: any) => {
      const n = (d.name || "").toLowerCase();
      return n.includes("моб") || n.includes("тел") || n.includes("phone") || n.includes("mobile");
    })?.visitors || 0;
    const mobPct = Math.round((Number(mob) / totalD) * 100);
    lines.push(`• Устройства: Мобильные ${mobPct}%, Десктоп ${100 - mobPct}%.`);
  }

  return lines.join("\n");
}

export async function GET(request: Request) {
  try {
    await requireAdmin(request);

    const configError = getAnalyticsDatabaseConfigError();
    if (configError) {
      return NextResponse.json({ error: configError }, { status: 500, headers: corsHeaders() });
    }

    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "today";
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const channel = getAnalyticsChannel(searchParams.get("channel"));
    const format = searchParams.get("format")?.toLowerCase();
    const { timeFilter, periodStart, fromDate, toDate } = getPeriodSql(period, from, to);
    const channelFilter = getChannelSql(channel);
    const onlineChannelFilter = getChannelSql(channel);

    const returningSessionsSql =
      periodStart === null
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
        COUNT(*) FILTER (WHERE pe.event IN ('order_success', 'order_submit', 'purchase', 'checkout_payment_started')) as order_submit,
        COUNT(*) FILTER (WHERE pe.event = 'ask_manager') as ask_manager,
        COUNT(*) FILTER (WHERE pe.event = 'site_click') as site_clicks,
        COUNT(*) FILTER (WHERE pe.event = 'site_click' AND COALESCE(NULLIF(pe.meta->>'channel', ''), NULLIF(pe.meta->>'source', ''), 'site') = 'telegram') as tg_site_clicks,
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
        COUNT(*) FILTER (${periodStart === null ? "WHERE TRUE" : `WHERE created_at >= ${periodStart}`}) as new_profiles,
        COUNT(*) FILTER (${periodStart === null ? "WHERE updated_at > created_at" : `WHERE created_at < ${periodStart} AND updated_at >= ${periodStart}`}) as returning_profiles,
        COUNT(*) FILTER (${periodStart === null ? "WHERE TRUE" : `WHERE updated_at >= ${periodStart}`}) as active_profiles,
        COUNT(*) FILTER (WHERE jsonb_typeof(cart) = 'array' AND jsonb_array_length(cart) > 0) as cart_profiles,
        COALESCE(SUM(CASE WHEN jsonb_typeof(cart) = 'array' THEN jsonb_array_length(cart) ELSE 0 END), 0) as cart_items,
        COUNT(*) FILTER (WHERE jsonb_typeof(favorites) = 'array' AND jsonb_array_length(favorites) > 0) as favorite_profiles,
        COALESCE(SUM(CASE WHEN jsonb_typeof(favorites) = 'array' THEN jsonb_array_length(favorites) ELSE 0 END), 0) as favorite_items
      FROM profiles
    `;

    const isSingleDay = period === "today" || period === "yesterday";
    const dateExpr = isSingleDay ? "TO_CHAR(created_at, 'HH24:00')" : "TO_CHAR(created_at, 'YYYY-MM-DD')";

    const seriesSql = `
      SELECT 
        ${dateExpr} as date,
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
        COUNT(*) FILTER (WHERE event = 'ask_manager') as manager,
        COUNT(*) FILTER (WHERE event IN ('order_submit', 'order_success', 'purchase', 'checkout_payment_started')) as orders
      FROM analytics_events
      WHERE ${timeFilter}
        AND ${channelFilter}
      GROUP BY 1
      ORDER BY 1 ASC
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

    const deviceSql = `
      SELECT 
        CASE 
          WHEN meta->>'device' = 'mobile' OR user_agent ILIKE '%mobile%' OR user_agent ILIKE '%android%' OR user_agent ILIKE '%iphone%' THEN 'Мобильные'
          WHEN meta->>'device' = 'tablet' OR user_agent ILIKE '%ipad%' OR user_agent ILIKE '%tablet%' THEN 'Планшеты'
          ELSE 'Десктоп'
        END as name,
        COUNT(DISTINCT session_id) as visitors
      FROM analytics_events
      WHERE ${timeFilter}
        AND ${channelFilter}
      GROUP BY 1
      ORDER BY visitors DESC
    `;

    const topProductsSql = `
      SELECT 
        COALESCE(NULLIF("productId", ''), 'unknown') as id,
        COALESCE(NULLIF(name, ''), "productId", 'Без названия') as name,
        MAX(COALESCE(NULLIF(meta->>'brand', ''), '')) as brand,
        MAX(COALESCE(NULLIF(meta->>'category', ''), '')) as category,
        MAX(price) as price,
        COUNT(*) as views,
        COUNT(DISTINCT session_id) as unique_views
      FROM analytics_events
      WHERE ${timeFilter}
        AND ${channelFilter}
        AND event = 'product_view'
        AND "productId" IS NOT NULL
        AND "productId" != ''
      GROUP BY "productId", name
      ORDER BY views DESC
      LIMIT 8
    `;

    const topCartSql = `
      SELECT 
        COALESCE(NULLIF("productId", ''), 'unknown') as id,
        COALESCE(NULLIF(name, ''), "productId", 'Без названия') as name,
        MAX(COALESCE(NULLIF(meta->>'brand', ''), '')) as brand,
        MAX(COALESCE(NULLIF(meta->>'category', ''), '')) as category,
        MAX(price) as price,
        COUNT(*) as carts
      FROM analytics_events
      WHERE ${timeFilter}
        AND ${channelFilter}
        AND event = 'add_to_cart'
        AND "productId" IS NOT NULL
        AND "productId" != ''
      GROUP BY "productId", name
      ORDER BY carts DESC
      LIMIT 8
    `;

    const sourcesSql = `
      SELECT 
        CASE 
          WHEN COALESCE(NULLIF(meta->>'channel', ''), NULLIF(meta->>'source', '')) = 'telegram' 
               OR meta->>'referrer' ILIKE '%t.me%' 
               OR meta->>'referrer' ILIKE '%telegram%' THEN 'Telegram Mini App'
          WHEN meta->>'referrer' ILIKE '%yandex%' OR meta->>'referrer' ILIKE '%ya.ru%' THEN 'Яндекс (Органика)'
          WHEN meta->>'referrer' ILIKE '%google%' THEN 'Google (Поиск)'
          WHEN meta->>'referrer' IS NOT NULL AND meta->>'referrer' != '' AND meta->>'referrer' NOT ILIKE '%yeezyunique%' THEN 'Внешние переходы'
          ELSE 'Прямой трафик'
        END as name,
        COUNT(DISTINCT session_id) as visitors,
        COUNT(*) FILTER (WHERE event = 'product_view') as views,
        COUNT(*) FILTER (WHERE event = 'add_to_cart') as carts,
        COUNT(*) FILTER (WHERE event = 'checkout_payment_started' OR event = 'ask_manager' OR event = 'order_submit') as checkouts,
        COUNT(*) FILTER (WHERE event = 'purchase') as purchases
      FROM analytics_events
      WHERE ${timeFilter}
      GROUP BY 1
      ORDER BY visitors DESC
    `;

    const searchQueriesSql = `
      SELECT 
        LOWER(TRIM(COALESCE(NULLIF(meta->>'query', ''), NULLIF(meta->>'search', '')))) as query,
        COUNT(*) as searches,
        COUNT(DISTINCT session_id) as unique_users
      FROM analytics_events
      WHERE ${timeFilter}
        AND ${channelFilter}
        AND event = 'search'
        AND (
          (meta->>'query' IS NOT NULL AND TRIM(meta->>'query') != '')
          OR (meta->>'search' IS NOT NULL AND TRIM(meta->>'search') != '')
        )
      GROUP BY 1
      ORDER BY searches DESC
      LIMIT 10
    `;

    const [
      overviewRes,
      profilesRes,
      seriesRes,
      countryRes,
      osRes,
      deviceRes,
      topProductsRes,
      topCartRes,
      sourcesRes,
      searchQueriesRes,
    ] = await Promise.all([
      safeAnalyticsQuery("Overview", overviewSql, [emptyOverviewRow], true),
      safeAnalyticsQuery("Profiles", profilesSql, [emptyProfileRow]),
      safeAnalyticsQuery("Series", seriesSql, []),
      safeAnalyticsQuery("Country", countrySql, []),
      safeAnalyticsQuery("OS", osSql, []),
      safeAnalyticsQuery("Devices", deviceSql, []),
      safeAnalyticsQuery("TopProducts", topProductsSql, []),
      safeAnalyticsQuery("TopCart", topCartSql, []),
      safeAnalyticsQuery("Sources", sourcesSql, []),
      safeAnalyticsQuery("SearchQueries", searchQueriesSql, []),
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
      site_clicks: parseInt(row.site_clicks || 0),
      tg_site_clicks: parseInt(row.tg_site_clicks || 0),
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

    // Aggregate CRM orders for financial & status metrics
    const financial = {
      revenue: 0,
      paid_orders: 0,
      pending_orders: 0,
      cancelled_orders: 0,
      refund_orders: 0,
      new_buyers: 0,
      repeat_buyers: 0,
      aov: 0,
      status_counts: {
        paid: 0,
        payment_pending: 0,
        shipped: 0,
        delivered: 0,
        refund_pending: 0,
        cancelled: 0,
      } as Record<string, number>,
    };

    try {
      if (process.env.RAILS_API_URL || process.env.NEXT_PUBLIC_API_URL || process.env.VITE_API_URL) {
        const crmResult = await listRailsCrmOrders({ perPage: 100 });
        const orders = crmResult?.items || [];

        // Count historical orders per customer across fetched set to identify repeat buyers
        const customerOrderCounts: Record<string, number> = {};
        for (const order of orders) {
          const custKey = order.customer?.id
            ? String(order.customer.id)
            : order.customer?.email || order.customer?.phone || (order as any).phone || (order as any).customer_id || (order.id ? `order-cust-${order.id}` : null);
          if (custKey) {
            customerOrderCounts[custKey] = (customerOrderCounts[custKey] || 0) + 1;
          }
        }

        let totalRevenueCents = 0;
        let paidCount = 0;
        let pendingCount = 0;
        let cancelledCount = 0;
        let refundCount = 0;
        let newBuyers = 0;
        let repeatBuyers = 0;
        const countedBuyersInPeriod = new Set<string>();

        for (const order of orders) {
          const orderDate = order.created_at ? new Date(order.created_at) : null;
          if (fromDate && orderDate && orderDate < fromDate) continue;
          if (toDate && orderDate && orderDate > toDate) continue;

          const orderSource = (order as any).source || order.customer?.registration_source;
          if (channel === "telegram" && orderSource && orderSource !== "telegram" && orderSource !== "telegram_mini_app") {
            continue;
          }
          if (channel.startsWith("site") && (orderSource === "telegram" || orderSource === "telegram_mini_app")) {
            continue;
          }

          const st = order.status || "";
          financial.status_counts[st] = (financial.status_counts[st] || 0) + 1;

          if (st === "paid" || st === "shipped" || st === "delivered") {
            paidCount++;
            totalRevenueCents += Number(order.total_cents || 0);

            const custKey = order.customer?.id
              ? String(order.customer.id)
              : order.customer?.email || order.customer?.phone || (order as any).phone || (order as any).customer_id || (order.id ? `order-cust-${order.id}` : null);
            if (custKey && !countedBuyersInPeriod.has(custKey)) {
              countedBuyersInPeriod.add(custKey);
              if ((customerOrderCounts[custKey] || 1) > 1) {
                repeatBuyers++;
              } else {
                newBuyers++;
              }
            }
          } else if (st === "payment_pending") {
            pendingCount++;
          } else if (st === "cancelled") {
            cancelledCount++;
          } else if (st === "refund_pending") {
            refundCount++;
          }
        }

        const revenue = Math.round(totalRevenueCents / 100);
        financial.revenue = revenue;
        financial.paid_orders = paidCount;
        financial.pending_orders = pendingCount;
        financial.cancelled_orders = cancelledCount;
        financial.refund_orders = refundCount;
        financial.new_buyers = newBuyers;
        financial.repeat_buyers = repeatBuyers;
        financial.aov = paidCount > 0 ? Math.round(revenue / paidCount) : 0;
      }
    } catch (crmError: any) {
      console.warn("Rails CRM orders fetch warning for analytics:", crmError?.message);
    }

    const step1 = overview.unique_visitors;
    const step2 = overview.unique_product_viewers || overview.unique_product_views;
    const step3 = overview.add_to_cart + overview.add_to_favorites;
    const step4 = overview.order_submit + overview.ask_manager;
    const step5 = financial.paid_orders || (overview.order_submit > 0 ? overview.order_submit : 0);

    const calcRate = (val: number, base: number) =>
      base > 0 ? Math.min(100, Math.round((val / base) * 1000) / 10) : 0;

    const conv2 = calcRate(step2, step1);
    const conv3 = calcRate(step3, step2);
    const conv4 = calcRate(step4, step3);
    const conv5 = calcRate(step5, step4);

    const funnel = [
      {
        step: "Визиты",
        count: step1,
        rate: 100,
        stepConversion: 100,
        dropOff: 0,
      },
      {
        step: "Просмотры товаров",
        count: step2,
        rate: calcRate(step2, step1),
        stepConversion: conv2,
        dropOff: step1 > 0 ? Math.max(0, Math.round((100 - conv2) * 10) / 10) : 0,
      },
      {
        step: "В корзину / Избранное",
        count: step3,
        rate: calcRate(step3, step1),
        stepConversion: conv3,
        dropOff: step2 > 0 ? Math.max(0, Math.round((100 - conv3) * 10) / 10) : 0,
      },
      {
        step: "Оформление / Заявка",
        count: step4,
        rate: calcRate(step4, step1),
        stepConversion: conv4,
        dropOff: step3 > 0 ? Math.max(0, Math.round((100 - conv4) * 10) / 10) : 0,
      },
      {
        step: "Оплачено",
        count: step5,
        rate: calcRate(step5, step1),
        stepConversion: conv5,
        dropOff: step4 > 0 ? Math.max(0, Math.round((100 - conv5) * 10) / 10) : 0,
      },
    ];

    const trafficSources = sourcesRes.rows.map((row: any) => {
      const visitors = parseInt(row.visitors || 0);
      const views = parseInt(row.views || 0);
      const carts = parseInt(row.carts || 0);
      const checkouts = parseInt(row.checkouts || 0);
      const purchases = parseInt(row.purchases || 0);
      return {
        name: row.name || "Неизвестно",
        visitors,
        views,
        carts,
        checkouts,
        purchases,
        cartRate: visitors > 0 ? Math.round((carts / visitors) * 1000) / 10 : 0,
        checkoutRate: visitors > 0 ? Math.round((checkouts / visitors) * 1000) / 10 : 0,
      };
    });

    const searchDemands = searchQueriesRes.rows.map((row: any) => ({
      query: row.query || "",
      searches: parseInt(row.searches || 0),
      unique_users: parseInt(row.unique_users || 0),
    }));

    let ymApiStats = null;
    const ymToken = process.env.YANDEX_METRIKA_TOKEN || process.env.YM_API_TOKEN;
    const ymCounterId = process.env.NEXT_PUBLIC_YM_COUNTER_ID || process.env.YM_COUNTER_ID || "100417016";
    if (ymToken) {
      try {
        const ymUrl = new URL("https://api-metrika.yandex.net/stat/v1/data");
        ymUrl.searchParams.set("ids", ymCounterId);
        ymUrl.searchParams.set(
          "metrics",
          "ym:s:users,ym:s:pageviews,ym:s:bounceRate,ym:s:avgVisitDurationSeconds",
        );
        const dateFrom = period === "today" ? "today" : period === "yesterday" ? "yesterday" : "7daysAgo";
        const dateTo = period === "yesterday" ? "yesterday" : "today";
        ymUrl.searchParams.set("date1", dateFrom);
        ymUrl.searchParams.set("date2", dateTo);
        const ymRes = await fetch(ymUrl.toString(), {
          headers: { Authorization: `OAuth ${ymToken}` },
          signal: AbortSignal.timeout(4000),
        });
        if (ymRes.ok) {
          const ymJson = await ymRes.json();
          const totals = ymJson.totals || [];
          ymApiStats = {
            users: Math.round(totals[0] || 0),
            pageviews: Math.round(totals[1] || 0),
            bounceRate: Math.round((totals[2] || 0) * 10) / 10,
            avgDurationSeconds: Math.round(totals[3] || 0),
          };
        }
      } catch (ymErr: any) {
        console.warn("Yandex Metrika API note:", ymErr?.message);
      }
    }

    const summary = buildAnalyticsSummary({
      period,
      channel,
      overview,
      financial,
      funnel,
      trafficSources,
      searchDemands,
      deviceList: deviceRes.rows,
      countryList: countryRes.rows,
    });

    if (format === "text" || format === "markdown" || format === "summary_text") {
      return new Response(summary, {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          ...corsHeaders(),
        },
      });
    }

    if (format === "summary") {
      return NextResponse.json(
        {
          summary,
          period,
          channel,
          metrics: {
            period,
            channel,
            online_now: overview.online_now,
            unique_visitors: overview.unique_visitors,
            new_visitors: overview.new_visitors,
            returning_visitors: overview.returning_visitors,
            page_views: overview.page_views,
            revenue: financial.revenue,
            paid_orders: financial.paid_orders,
            aov: financial.aov,
            new_buyers: financial.new_buyers,
            repeat_buyers: financial.repeat_buyers,
            conversion_rate: funnel.length > 0 ? funnel[funnel.length - 1].rate : 0,
            top_sources: trafficSources.slice(0, 4).map((s: any) => ({
              name: s.name,
              visitors: s.visitors,
              carts: s.carts,
              checkouts: s.checkouts,
            })),
            top_search_queries: searchDemands.slice(0, 5).map((s: any) => s.query),
          },
          updatedAt: new Date().toISOString(),
        },
        { headers: corsHeaders() },
      );
    }

    return NextResponse.json(
      {
        summary,
        overview,
        financial,
        funnel,
        seriesData: seriesRes.rows,
        countryList: countryRes.rows,
        osList: osRes.rows,
        deviceList: deviceRes.rows,
        topProducts: topProductsRes.rows,
        topCart: topCartRes.rows,
        trafficSources,
        searchDemands,
        externalIntegrations: {
          yandexMetrika: {
            configured: true,
            counterId: ymCounterId,
            apiActive: Boolean(ymApiStats),
            stats: ymApiStats,
          },
          yandexWebmaster: {
            configured: true,
            siteUrl: "https://yeezyunique.ru",
          },
          googleSearchConsole: {
            configured: true,
            property: "sc-domain:yeezyunique.ru",
          },
          googleMerchantCenter: {
            configured: true,
            accountId: "5830671674",
          },
          googleAnalytics: {
            configured: Boolean(
              process.env.NEXT_PUBLIC_GA_ID ||
                process.env.NEXT_PUBLIC_GTM_ID ||
                process.env.GA_MEASUREMENT_ID,
            ),
            tagId:
              process.env.NEXT_PUBLIC_GA_ID ||
              process.env.NEXT_PUBLIC_GTM_ID ||
              process.env.GA_MEASUREMENT_ID ||
              null,
          },
        },
        updatedAt: new Date().toISOString(),
      },
      { headers: corsHeaders() },
    );
  } catch (error: any) {
    if (isAdminAuthError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders() });
    }

    console.error("Analytics error:", error);
    const message = isDatabaseConnectionError(error)
      ? "Не удалось подключиться к базе аналитики. Проверь DATABASE_URL/ANALYTICS_DATABASE_URL и доступность Postgres из окружения админки."
      : error.message;

    return NextResponse.json({ error: message }, { status: 500, headers: corsHeaders() });
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
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
  };
}

export async function DELETE(request: Request) {
  try {
    await requireAdmin(request);

    const configError = getAnalyticsDatabaseConfigError();
    if (configError) {
      return NextResponse.json({ error: configError }, { status: 500, headers: corsHeaders() });
    }

    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") || "period";
    const period = searchParams.get("period") || "today";
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const channel = getAnalyticsChannel(searchParams.get("channel"));
    const channelFilter = getChannelSql(channel);

    if (type === "all") {
      await analyticsQuery(
        channel === "all"
          ? "DELETE FROM analytics_events"
          : `DELETE FROM analytics_events WHERE ${channelFilter}`,
      );
    } else {
      const { timeFilter } = getPeriodSql(period, from, to);
      await analyticsQuery(
        `DELETE FROM analytics_events WHERE ${timeFilter} AND ${channelFilter}`,
      );
    }

    return NextResponse.json(
      {
        success: true,
        message: `Статистика очищена (${type === "all" ? "все время" : period})`,
      },
      { headers: corsHeaders() },
    );
  } catch (error: any) {
    if (isAdminAuthError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders() });
    }

    console.error("Analytics DELETE error:", error);
    return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders() });
  }
}
