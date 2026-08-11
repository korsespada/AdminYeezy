import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getScrapingClient, scrapingQuery } from '@/lib/db'
import { matchingPriceRule, normalizeBatchAiOutput, normalizeBatchAiProcessingOptions } from '@/lib/batch-ai'
import { normalizeMediaSeoOutput } from '@/lib/product-media-seo'
import { buildProductSeoSlug } from '@/lib/product-media-seo'
import { recordBatchSnapshot } from '@/lib/batch-snapshots'
import { releaseBatchOperation } from '@/lib/batch-operation-lock'
import {
  applyShadeVariantsToSuggestion,
  normalizeShadeScanOutput,
  normalizeVisualFamilyScanOutput,
  saveBatchAiSuggestions,
  savePreparedColorFamilySuggestion,
} from '@/lib/batch-ai-suggestions'

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
    if (body.action === 'heartbeat') return heartbeat(body)
    if (body.action === 'claim') return claim()
    if (body.action === 'complete') return complete(body)
    if (body.action === 'fail') return fail(body)
    return NextResponse.json({ error: 'unknown_action' }, { status: 422 })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

async function heartbeat(body: any) {
  const workerId = String(body.worker_id || 'batch-ai-local').slice(0, 160)
  await scrapingQuery(`
    INSERT INTO batch_ai_worker_state(worker_id,provider,model,heartbeat_at,metadata)
    VALUES($1,'cockpit',$2,NOW(),$3::jsonb)
    ON CONFLICT(worker_id) DO UPDATE SET provider='cockpit',model=EXCLUDED.model,
      heartbeat_at=NOW(),metadata=EXCLUDED.metadata
  `, [workerId, String(body.model || ''), JSON.stringify(body.metadata || {})])
  const setting = await scrapingQuery("SELECT value FROM app_settings WHERE key='batch_ai_concurrency'")
  const concurrency = Math.max(1, Math.min(10, Math.round(Number(setting.rows[0]?.value || 5))))
  return NextResponse.json({ ok: true, concurrency })
}

async function claim() {
  const client = await getScrapingClient()
  const leaseToken = crypto.randomUUID()
  try {
    await client.query('BEGIN')
    const result = await client.query(`
      SELECT i.*, r.settings_snapshot
      FROM batch_ai_items i
      JOIN batch_ai_runs r ON r.id=i.run_id
      WHERE r.provider='cockpit'
        AND r.status IN ('queued','running')
        AND (i.status='queued' OR (i.status='running' AND i.leased_at < NOW() - INTERVAL '5 minutes'))
      ORDER BY i.created_at
      FOR UPDATE OF i SKIP LOCKED LIMIT 1
    `)
    const item = result.rows[0]
    if (!item) {
      await client.query('COMMIT')
      return NextResponse.json({ item: null })
    }
    await client.query(`
      UPDATE batch_ai_items SET status='running',attempts=attempts+1,lease_token=$2,leased_at=NOW(),updated_at=NOW()
      WHERE id=$1
    `, [item.id, leaseToken])
    await client.query("UPDATE batch_ai_runs SET status='running',updated_at=NOW() WHERE id=$1", [item.run_id])
    await client.query('COMMIT')
    return NextResponse.json({ item: { ...item, lease_token: leaseToken } })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function complete(body: any) {
  const itemResult = await scrapingQuery(`
    SELECT i.*, r.batch_id FROM batch_ai_items i JOIN batch_ai_runs r ON r.id=i.run_id
    WHERE i.id=$1 AND i.lease_token=$2 AND i.status='running'
  `, [body.item_id, body.lease_token])
  const item = itemResult.rows[0]
  if (!item) return NextResponse.json({ error: 'lease_not_found' }, { status: 409 })
  const input = item.input_snapshot
  const context = await scrapingQuery(`
    SELECT b.supplier_id,s.default_price FROM scraping_batches b
    JOIN suppliers s ON s.id=b.supplier_id WHERE b.id=$1
  `, [item.batch_id])
  const storedRules = await scrapingQuery(
    'SELECT * FROM supplier_price_rules WHERE supplier_id=$1 AND enabled=true ORDER BY priority DESC,id',
    [context.rows[0]?.supplier_id],
  )
  // Правила из БД являются источником истины: очередь могла быть создана до
  // добавления/изменения правила, поэтому input_snapshot может быть устаревшим.
  const priceRules = storedRules.rows
  const normalized: any = input.mediaSeoOnly ? normalizeMediaSeoOutput(body.output, input) : input.shadeFamilyScan ? {
    product: input.product,
    suggestions: [],
    subcategorySuggestion: null,
    colorFamily: null,
    shadeVariants: normalizeShadeScanOutput(body.output, input.candidateProducts || []),
    familyIdentityKey: String(input.familyIdentityKey || ''),
    mediaDecision: { discard: [], sizeCharts: [] },
  } : input.visualFamilyScan ? {
    product: input.product,
    suggestions: [],
    subcategorySuggestion: null,
    colorFamily: null,
    colorFamilies: normalizeVisualFamilyScanOutput(body.output, input.candidateProducts || []),
    mediaDecision: { discard: [], sizeCharts: [] },
  } : input.variantScanOnly ? {
    product: input.product,
    suggestions: [],
    subcategorySuggestion: null,
    colorFamily: body.output?.color_family || null,
    mediaDecision: { discard: [], sizeCharts: [] },
  } : normalizeBatchAiOutput(body.output, {
    product: input.product,
    brandIds: new Set((input.brands || []).map((row: any) => String(row.id))),
    categoryIds: new Set((input.categories || []).map((row: any) => String(row.id))),
    subcategoryIds: new Set((input.subcategories || []).map((row: any) => String(row.id))),
    subcategoryParents: new Map((input.subcategories || []).map((row: any) => [String(row.id), String(row.parent_id || '')])),
    categoryNames: new Map((input.categories || []).map((row: any) => [String(row.id), String(row.name || '')])),
    subcategoryNames: new Map((input.subcategories || []).map((row: any) => [String(row.id), String(row.name || '')])),
    attributeCodes: new Set((input.attributeCodes || []).map(String)),
    knownAttributeCodes: new Set((input.knownAttributeCodes || []).map(String)),
    attributeDictionaryValues: input.attributeDictionaryValues || [],
    priceRuleKeys: new Set(priceRules.map((row: any) => String(row.rule_key))),
    processingOptions: normalizeBatchAiProcessingOptions(input.processingOptions),
  })
  const product = normalized.product
  if (!input.mediaSeoOnly && !input.variantScanOnly && !String(input.product?.slug || '').trim()) {
    const brandName = (input.brands || []).find((row: any) => String(row.id) === String(product?.brand))?.name || product?.brand || ''
    product.slug = buildProductSeoSlug(product, String(brandName))
  }
  const measurementRecoveryOnly = input.measurementRecoveryOnly === true
  const recoveredMeasurements = product?.attributes?.measurements
  if (measurementRecoveryOnly && (!recoveredMeasurements || typeof recoveredMeasurements !== 'object')) {
    throw new Error('ИИ не распознал таблицу замеров')
  }
  if (!input.mediaSeoOnly && !input.variantScanOnly && input.preserveExistingPrice) {
    product.price = Number(input.product?.price || 0)
    product.price_source = input.product?.price_source || 'legacy'
  } else {
    const rule = input.mediaSeoOnly || input.variantScanOnly || product.price_source === 'manual' ? null : matchingPriceRule(product, priceRules)
    if (!input.mediaSeoOnly && !input.variantScanOnly && rule) {
      product.price = Number(rule.price)
      product.price_source = 'rule'
    } else if (!input.mediaSeoOnly && !input.variantScanOnly && !Number(product.price) && Number(context.rows[0]?.default_price)) {
      product.price = Number(context.rows[0].default_price)
      product.price_source = 'default'
    }
  }
  const client = await getScrapingClient()
  try {
    await client.query('BEGIN')
    const run = await client.query('SELECT status FROM batch_ai_runs WHERE id=$1 FOR UPDATE', [item.run_id])
    if (!run.rows[0] || run.rows[0].status === 'cancelled') {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'run_cancelled' }, { status: 409 })
    }
    if (normalized.skipProduct) {
      await client.query('DELETE FROM products WHERE id=$1 AND batch_id=$2', [item.product_id, item.batch_id])
      await client.query(`
        UPDATE batch_ai_items SET status='completed',output=$3::jsonb,lease_token=NULL,
          completed_at=NOW(),updated_at=NOW(),product_id=NULL WHERE id=$1 AND lease_token=$2
      `, [item.id, body.lease_token, JSON.stringify(normalized)])
      await client.query('UPDATE scraping_batches SET items_count=(SELECT COUNT(*)::int FROM products WHERE batch_id=$1),updated_at=NOW() WHERE id=$1', [item.batch_id])
    } else if (input.mediaSeoOnly) {
      await client.query(`
        UPDATE products SET slug=$2,photo_alts=$3::jsonb,updated_at=NOW()
        WHERE id=$1
      `, [item.product_id, normalized.slug, JSON.stringify(normalized.photo_alts || [])])
    } else if (measurementRecoveryOnly) {
      const targetIds = [...new Set((input.measurementTargetProductIds || [])
        .map(Number)
        .filter(Number.isInteger))]
      if (targetIds.length === 0) throw new Error('Не найдены товары для привязки таблицы замеров')
      await client.query(`
        UPDATE products SET
          attributes=jsonb_set(COALESCE(attributes,'{}'::jsonb),'{measurements}',$2::jsonb,true),
          updated_at=NOW()
        WHERE batch_id=$1 AND id=ANY($3::int[])
      `, [item.batch_id, JSON.stringify(recoveredMeasurements), targetIds])
    } else if (!input.variantScanOnly) {
      await client.query(`
        UPDATE products SET name=$2,description=$3,h1=$4,seo_title=$5,seo_description=$6,slug=$7,
          brand=$8,category=$9,subcategory=$10,gender=$11,photos=$12::jsonb,photo_alts=$13::jsonb,attributes=$14::jsonb,
          price=$15,price_source=$16,ai_processed=true,ai_error=NULL,ai_confidence=$17,updated_at=NOW()
        WHERE id=$1
      `, [item.product_id, product.name, product.description, product.h1, product.seo_title,
        product.seo_description, product.slug, product.brand, product.category, product.subcategory || null,
        product.gender || null, JSON.stringify(product.photos || []), JSON.stringify(product.photo_alts || []), JSON.stringify(product.attributes || {}),
        Number(product.price || 0), product.price_source || 'legacy', product.ai_confidence])
    }
    await client.query(`
      UPDATE batch_ai_items SET status='completed',output=$3::jsonb,lease_token=NULL,
        completed_at=NOW(),updated_at=NOW() WHERE id=$1 AND lease_token=$2
    `, [item.id, body.lease_token, JSON.stringify(normalized)])
    if (normalized.skipProduct || input.mediaSeoOnly || measurementRecoveryOnly) {
      // В режиме восстановления меняется только таблица замеров товара.
    } else if (Array.isArray(normalized.shadeVariants)) {
      await applyShadeVariantsToSuggestion(client, item.run_id, normalized)
    } else if (Array.isArray(normalized.colorFamilies)) {
      for (const family of normalized.colorFamilies) {
        const ids = family.products.map((candidate: any) => Number(candidate.id)).sort((a: number, b: number) => a - b)
        await savePreparedColorFamilySuggestion(client, item.run_id, {
          identityKey: `visual|${crypto.createHash('sha256').update(ids.join(':')).digest('hex')}`,
          products: family.products,
          source: 'visual_comparison',
          confidence: family.confidence,
          matchingEvidence: family.matchingEvidence,
          suggestedColors: family.suggestedColors,
          familyDefinition: input.familyDefinition,
        })
      }
    } else {
      await saveBatchAiSuggestions(client, item.run_id, item.product_id, normalized)
    }
    await updateRunCounts(client, item.run_id)
    await touchRunLock(client, item.run_id)
    await client.query('COMMIT')
    await finalizeCockpitRun(item.run_id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function fail(body: any) {
  const client = await getScrapingClient()
  try {
    await client.query('BEGIN')
    const result = await client.query(`
      UPDATE batch_ai_items SET status='failed',error_message=$3,lease_token=NULL,completed_at=NOW(),updated_at=NOW()
      WHERE id=$1 AND lease_token=$2 RETURNING run_id,product_id,input_snapshot
    `, [body.item_id, body.lease_token, String(body.error || 'Cockpit error').slice(0, 4000)])
    if (result.rows[0] && !result.rows[0].input_snapshot?.variantScanOnly && !result.rows[0].input_snapshot?.measurementRecoveryOnly && !result.rows[0].input_snapshot?.mediaSeoOnly) {
      await client.query('UPDATE products SET ai_error=$2,updated_at=NOW() WHERE id=$1', [result.rows[0].product_id, String(body.error || '').slice(0, 4000)])
    }
    if (result.rows[0]) {
      await updateRunCounts(client, result.rows[0].run_id)
      await touchRunLock(client, result.rows[0].run_id)
    }
    await client.query('COMMIT')
    if (result.rows[0]) await finalizeCockpitRun(result.rows[0].run_id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function finalizeCockpitRun(runId: string) {
  const result = await scrapingQuery('SELECT * FROM batch_ai_runs WHERE id=$1', [runId])
  const run = result.rows[0]
  if (!run) return
  if (run.status !== 'completed') {
    if (['failed','cancelled'].includes(run.status)) await releaseBatchOperation(String(run.batch_id), runId)
    return
  }
  try {
    if (run.mode === 'recover_measurements') {
      const label = `Замеры восстановлены · ${run.id.slice(0, 8)}`
      const existing = await scrapingQuery('SELECT 1 FROM batch_snapshots WHERE batch_id=$1 AND label=$2 LIMIT 1', [run.batch_id, label])
      if (!existing.rows[0]) await recordBatchSnapshot(run.batch_id, 'PUSHED', label, run.settings_snapshot)
      return
    }
    if (run.mode === 'media_seo') return
    let promoteBatch = false
    if (run.mode !== 'variants') {
      const remaining = await scrapingQuery(`
        SELECT 1 FROM products
        WHERE batch_id=$1 AND COALESCE(ai_processed, false)=false
        LIMIT 1
      `, [run.batch_id])
      promoteBatch = remaining.rows.length === 0
    }
    if (promoteBatch) {
      await scrapingQuery("UPDATE scraping_batches SET stage='AI_PROCESSED',updated_at=NOW() WHERE id=$1", [run.batch_id])
    }
    if (run.mode === 'variants') return
    const label = run.mode === 'sample' ? `AI-тест · ${run.id.slice(0, 8)}` : `${promoteBatch ? 'Обработано ИИ' : 'Частично обработано ИИ'} · ${run.id.slice(0, 8)}`
    const existing = await scrapingQuery('SELECT 1 FROM batch_snapshots WHERE batch_id=$1 AND label=$2 LIMIT 1', [run.batch_id, label])
    if (!existing.rows[0]) await recordBatchSnapshot(run.batch_id, promoteBatch ? 'AI_PROCESSED' : 'SCRIPT_PROCESSED', label, run.settings_snapshot)
  } finally {
    await releaseBatchOperation(String(run.batch_id), runId)
  }
}

async function touchRunLock(client: any, runId: string) {
  await client.query(`
    UPDATE batch_operation_locks l SET updated_at=NOW()
    FROM batch_ai_runs r
    WHERE r.id=$1 AND l.batch_id=r.batch_id AND l.owner_id=r.id
  `, [runId])
}

async function updateRunCounts(client: any, runId: string) {
  await client.query(`
    UPDATE batch_ai_runs r SET
      completed_count=c.completed,failed_count=c.failed,
      status=CASE WHEN c.pending=0 THEN CASE WHEN c.completed>0 THEN 'completed' ELSE 'failed' END ELSE 'running' END,
      completed_at=CASE WHEN c.pending=0 THEN NOW() ELSE NULL END,updated_at=NOW()
    FROM (
      SELECT COUNT(*) FILTER(WHERE status='completed')::int completed,
             COUNT(*) FILTER(WHERE status='failed')::int failed,
             COUNT(*) FILTER(WHERE status IN ('queued','running'))::int pending
      FROM batch_ai_items WHERE run_id=$1
    ) c WHERE r.id=$1 AND r.status <> 'cancelled'
  `, [runId])
}
