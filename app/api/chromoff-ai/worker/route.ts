import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getScrapingClient, scrapingQuery } from '@/lib/db'
import { railsFetch } from '@/lib/rails-admin'

export const dynamic = 'force-dynamic'

function authorized(request: NextRequest) {
  const expected = process.env.BATCH_AI_WORKER_TOKEN || process.env.AI_CATALOG_WORKER_TOKEN
  const actual = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || ''
  if (!expected || !actual || expected.length !== actual.length) return false
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual))
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const body = await request.json()
    if (body.action === 'claim') return claim()
    if (body.action === 'complete') return complete(body)
    if (body.action === 'fail') return fail(body)
    return NextResponse.json({ error: 'unknown_action' }, { status: 422 })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

async function claim() {
  const client = await getScrapingClient()
  const leaseToken = crypto.randomUUID()
  try {
    await client.query('BEGIN')
    const result = await client.query(`
      SELECT i.*, r.settings
      FROM chromoff_ai_items i
      JOIN chromoff_ai_runs r ON r.id = i.run_id
      WHERE i.status = 'pending'
      LIMIT 1 FOR UPDATE SKIP LOCKED
    `)
    const item = result.rows[0]
    if (!item) {
      await client.query('ROLLBACK')
      return NextResponse.json({ ok: true, item: null })
    }

    await client.query(`
      UPDATE chromoff_ai_items
      SET status = 'running', lease_token = $1, lease_expires_at = NOW() + INTERVAL '10 minutes', updated_at = NOW()
      WHERE id = $2
    `, [leaseToken, item.id])
    await client.query('COMMIT')

    // Fetch listing from Rails
    let listingData = null
    try {
      const res = await railsFetch<{ listing: any }>(`/admin/chromoff/listings/${encodeURIComponent(item.listing_id)}`)
      listingData = res.listing
    } catch (e) {
      // If fetching fails, we'll return empty snapshot and let the worker fail it
    }

    return NextResponse.json({
      ok: true,
      item: {
        id: item.id,
        lease_token: leaseToken,
        settings_snapshot: item.settings,
        input_snapshot: listingData
      }
    })
  } catch (error: any) {
    await client.query('ROLLBACK')
    return NextResponse.json({ error: error.message }, { status: 500 })
  } finally {
    client.release()
  }
}

async function complete(body: any) {
  const itemResult = await scrapingQuery(`
    SELECT i.*, r.id as run_id FROM chromoff_ai_items i
    JOIN chromoff_ai_runs r ON r.id = i.run_id
    WHERE i.id = $1 AND i.lease_token = $2 AND i.status = 'running'
  `, [body.id, body.token])
  const item = itemResult.rows[0]
  if (!item) return NextResponse.json({ error: 'invalid_lease' }, { status: 422 })

  const result = body.result || {}
  
  if (result.error) {
    return fail(body) // redirect to fail
  }

  // Save to Rails
  try {
    const listingId = item.listing_id
    
    // 1. Update ChromoffListing seo_description
    if (result.seo_description) {
      await railsFetch(`/admin/chromoff/listings/${encodeURIComponent(listingId)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          listing: { seo_description: result.seo_description }
        })
      })
    }
    
    // 2. We need to update the base Product (name, description, attributes, alts)
    const res = await railsFetch<{ listing: any }>(`/admin/chromoff/listings/${encodeURIComponent(listingId)}`)
    const productId = res.listing?.product_id
    
    if (productId) {
      const productRes = await railsFetch<{ product: any }>(`/admin/products/${encodeURIComponent(productId)}`)
      const product = productRes.product
      
      if (product) {
        const productUpdate: any = {}
        if (result.name) productUpdate.name = result.name
        if (result.description) productUpdate.description = result.description
        if (result.attributes) productUpdate.catalog_attributes = result.attributes
        
        if (Array.isArray(result.alts) && Array.isArray(product.media)) {
          const updatedMedia = product.media.map((m: any, index: number) => {
            if (result.alts[index]) {
              return { ...m, alt_text: result.alts[index] }
            }
            return m
          })
          productUpdate.media = updatedMedia
        }
        
        if (Object.keys(productUpdate).length > 0) {
          await railsFetch(`/admin/products/${encodeURIComponent(productId)}`, {
            method: 'PATCH',
            body: JSON.stringify({ product: productUpdate })
          })
        }
      }
    }

    const client = await getScrapingClient()
    try {
      await client.query('BEGIN')
      await client.query(`
        UPDATE chromoff_ai_items
        SET status = 'completed', result = $1::jsonb, updated_at = NOW()
        WHERE id = $2
      `, [JSON.stringify(result), item.id])
      
      await updateRunCounts(client, item.run_id)
      await client.query('COMMIT')
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }
    
    return NextResponse.json({ ok: true })
  } catch (error: any) {
    return fail({ id: body.id, token: body.token, error: error.message })
  }
}

async function fail(body: any) {
  const client = await getScrapingClient()
  try {
    await client.query('BEGIN')
    const result = await client.query(`
      UPDATE chromoff_ai_items
      SET status = 'failed', error_message = $1, updated_at = NOW()
      WHERE id = $2 AND lease_token = $3 AND status = 'running'
      RETURNING run_id
    `, [String(body.error || 'Unknown error').slice(0, 1000), body.id, body.token])
    
    if (result.rows[0]) {
      await updateRunCounts(client, result.rows[0].run_id)
    }
    await client.query('COMMIT')
    return NextResponse.json({ ok: true })
  } catch (error: any) {
    await client.query('ROLLBACK')
    return NextResponse.json({ error: error.message }, { status: 500 })
  } finally {
    client.release()
  }
}

async function updateRunCounts(client: any, runId: string) {
  await client.query(`
    UPDATE chromoff_ai_runs r SET
      completed_count = (SELECT COUNT(*) FROM chromoff_ai_items WHERE run_id = r.id AND status = 'completed'),
      failed_count = (SELECT COUNT(*) FROM chromoff_ai_items WHERE run_id = r.id AND status = 'failed')
    WHERE r.id = $1
  `, [runId])
  
  await client.query(`
    UPDATE chromoff_ai_runs
    SET status = CASE WHEN completed_count + failed_count = total_count THEN 'completed' ELSE status END,
        completed_at = CASE WHEN completed_count + failed_count = total_count THEN NOW() ELSE completed_at END
    WHERE id = $1
  `, [runId])
}
