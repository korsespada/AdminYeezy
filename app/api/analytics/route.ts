import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import PocketBase from 'pocketbase'

const PB_URL = process.env.NEXT_PUBLIC_POCKETBASE_URL || 'http://144.31.116.66:8090'

export async function GET(request: Request) {
    // Read auth from httpOnly cookie
    const cookieStore = cookies()
    const authCookie = cookieStore.get('pb_auth')

    if (!authCookie?.value) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const pb = new PocketBase(PB_URL)

    try {
        const authData = JSON.parse(authCookie.value)
        pb.authStore.save(authData.token, authData.model)
    } catch {
        return NextResponse.json({ error: 'Invalid auth' }, { status: 401 })
    }

    // Parse query params
    const { searchParams } = new URL(request.url)
    const period = searchParams.get('period') || 'today'

    // Build PocketBase filter
    let filter = ''
    const now = new Date()

    if (period === 'today') {
        const since = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        filter = `created >= "${since.toISOString().replace('T', ' ').replace('Z', '')}"`
    } else if (period === 'week') {
        const since = new Date(now)
        since.setDate(since.getDate() - 7)
        filter = `created >= "${since.toISOString().replace('T', ' ').replace('Z', '')}"`
    } else if (period === 'month') {
        const since = new Date(now)
        since.setMonth(since.getMonth() - 1)
        filter = `created >= "${since.toISOString().replace('T', ' ').replace('Z', '')}"`
    }

    const options: any = {
        sort: '-created',
        requestKey: null,
    }
    if (filter) {
        options.filter = filter
    }

    try {
        // Fetch all events
        const allEvents: any[] = []
        let page = 1
        let totalPages = 1

        while (page <= totalPages && page <= 20) {
            const result = await pb.collection('analytics_events').getList(page, 500, options)
            allEvents.push(...result.items)
            totalPages = result.totalPages
            page++
        }

        // Aggregate
        const uniqueSessions = new Set<string>()
        const recentSessions = new Set<string>()
        const fiveMinAgo = Date.now() - 5 * 60 * 1000

        const sessionOsMap: Record<string, string> = {}
        const sessionCountryMap: Record<string, string> = {}

        let new_profiles = 0;
        try {
            const profilesRes = await pb.collection('profiles').getList(1, 1, options);
            new_profiles = profilesRes.totalItems;
        } catch (e) {
            console.error("Failed to fetch profiles for analytics", e);
        }

        const overview = {
            unique_visitors: 0,
            online_now: 0,
            total_events: allEvents.length,
            page_views: 0,
            product_views: 0,
            add_to_cart: 0,
            add_to_favorites: 0,
            order_submit: 0,
            ask_manager: 0,
            new_profiles: new_profiles,
        }

        const productMap: Record<string, any> = {}

        // 2) Timeseries
        const seriesDataMap: Record<string, { date: string, views: number, carts: number, manager: number, timestamp: number }> = {}

        for (const ev of allEvents) {
            if (ev.session_id) {
                uniqueSessions.add(ev.session_id)
                if (new Date(ev.created).getTime() > fiveMinAgo) {
                    recentSessions.add(ev.session_id)
                }

                if (!sessionOsMap[ev.session_id]) {
                    let os = ev.meta?.os;
                    if (!os) {
                        const ua = ev.user_agent || "";
                        if (/android/i.test(ua)) os = "Android";
                        else if (/iphone|ipad|ipod/i.test(ua)) os = "iOS";
                        else if (/windows/i.test(ua)) os = "Windows";
                        else if (/mac/i.test(ua)) os = "Mac OS";
                        else if (/linux/i.test(ua)) os = "Linux";
                        else os = "Unknown";
                    }
                    sessionOsMap[ev.session_id] = os;
                }

                if (!sessionCountryMap[ev.session_id]) {
                    const country = ev.meta?.country || "Unknown";
                    sessionCountryMap[ev.session_id] = country;
                }
            }

            // Build series date key based on period
            let dateKey = ''
            const d = new Date(ev.created)
            if (period === 'today') {
                // Hour
                dateKey = `${d.getHours()}:00`
            } else if (period === 'week' || period === 'month') {
                // Day
                dateKey = `${d.getDate()}.${d.getMonth() + 1}`
            } else {
                // Month/Year
                dateKey = `${d.getMonth() + 1}.${d.getFullYear()}`
            }

            if (!seriesDataMap[dateKey]) {
                seriesDataMap[dateKey] = { date: dateKey, views: 0, carts: 0, manager: 0, timestamp: d.getTime() }
            }

            switch (ev.event) {
                case 'page_view': overview.page_views++; break
                case 'product_view':
                    overview.product_views++;
                    seriesDataMap[dateKey].views++;
                    break
                case 'add_to_cart':
                    overview.add_to_cart++;
                    seriesDataMap[dateKey].carts++;
                    break
                case 'add_to_favorites': overview.add_to_favorites++; break
                case 'order_submit': overview.order_submit++; break
                case 'ask_manager':
                    overview.ask_manager++;
                    seriesDataMap[dateKey].manager++;
                    break
            }

            if (ev.productId) {
                if (!productMap[ev.productId]) {
                    productMap[ev.productId] = {
                        product_id: ev.productId,
                        product_name: ev.name || ev.productId,
                        views: 0,
                        add_to_cart: 0,
                        add_to_favorites: 0,
                        order_submit: 0,
                        ask_manager: 0,
                    }
                }
                const p = productMap[ev.productId]
                if (ev.name) p.product_name = ev.name

                switch (ev.event) {
                    case 'product_view': p.views++; break
                    case 'add_to_cart': p.add_to_cart++; break
                    case 'add_to_favorites': p.add_to_favorites++; break
                    case 'order_submit': p.order_submit++; break
                    case 'ask_manager': p.ask_manager++; break
                }
            }
        }

        overview.unique_visitors = uniqueSessions.size
        overview.online_now = recentSessions.size

        const uniqueProductIds = Object.keys(productMap)
        if (uniqueProductIds.length > 0) {
            const chunkSize = 30
            for (let i = 0; i < uniqueProductIds.length; i += chunkSize) {
                const chunk = uniqueProductIds.slice(i, i + chunkSize)
                try {
                    const products = await pb.collection('products').getFullList({
                        filter: chunk.map(id => `id="${id}"`).join(' || '),
                        requestKey: null,
                    })
                    for (const p of products) {
                        if (productMap[p.id]) {
                            productMap[p.id].fullProduct = p
                        }
                    }
                } catch (e) {
                    console.error('Failed to fetch products chunk for analytics:', e)
                }
            }
        }

        const products = Object.values(productMap).sort((a: any, b: any) => b.views - a.views)

        // Ensure series data is chronologically sorted based on period
        const seriesData = Object.values(seriesDataMap).sort((a, b) => a.timestamp - b.timestamp)

        const osStats: Record<string, number> = {}
        for (const os of Object.values(sessionOsMap)) {
            osStats[os] = (osStats[os] || 0) + 1;
        }

        const countryStats: Record<string, number> = {}
        for (const country of Object.values(sessionCountryMap)) {
            countryStats[country] = (countryStats[country] || 0) + 1;
        }

        const osList = Object.entries(osStats)
            .map(([name, visitors]) => ({ name, visitors }))
            .sort((a, b) => b.visitors - a.visitors);

        const countryList = Object.entries(countryStats)
            .map(([name, visitors]) => ({ name, visitors }))
            .sort((a, b) => b.visitors - a.visitors);

        return NextResponse.json({ overview, products, seriesData, osList, countryList })
    } catch (err: any) {
        console.error('Analytics API error:', err)
        return NextResponse.json({ error: err?.message || 'Failed to fetch analytics' }, { status: 500 })
    }
}

export async function DELETE(request: Request) {
    // Read auth from httpOnly cookie
    const cookieStore = cookies()
    const authCookie = cookieStore.get('pb_auth')

    if (!authCookie?.value) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const pb = new PocketBase(PB_URL)

    try {
        const authData = JSON.parse(authCookie.value)
        pb.authStore.save(authData.token, authData.model)
    } catch {
        return NextResponse.json({ error: 'Invalid auth' }, { status: 401 })
    }

    // Parse query params
    const { searchParams } = new URL(request.url)
    const resetType = searchParams.get('type') || 'all' // 'all' or 'period'
    const period = searchParams.get('period') || 'today'

    // Build PocketBase filter
    let filter = ''
    if (resetType === 'period') {
        const now = new Date()
        if (period === 'today') {
            const since = new Date(now.getFullYear(), now.getMonth(), now.getDate())
            filter = `created >= "${since.toISOString().replace('T', ' ').replace('Z', '')}"`
        } else if (period === 'week') {
            const since = new Date(now)
            since.setDate(since.getDate() - 7)
            filter = `created >= "${since.toISOString().replace('T', ' ').replace('Z', '')}"`
        } else if (period === 'month') {
            const since = new Date(now)
            since.setMonth(since.getMonth() - 1)
            filter = `created >= "${since.toISOString().replace('T', ' ').replace('Z', '')}"`
        }
    }

    const options: any = {
        requestKey: null,
    }
    if (filter) {
        options.filter = filter
    }

    try {
        while (true) {
            const result = await pb.collection('analytics_events').getList(1, 500, options)
            if (result.items.length === 0) break;

            const deletePromises = result.items.map((item: any) =>
                pb.collection('analytics_events').delete(item.id, { requestKey: null }).catch(e => console.error(e))
            )
            await Promise.all(deletePromises)
        }

        return NextResponse.json({ success: true })
    } catch (err: any) {
        console.error('Analytics reset error:', err)
        return NextResponse.json({ error: err?.message || 'Failed to reset analytics' }, { status: 500 })
    }
}
