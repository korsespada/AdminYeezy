'use server'

import crypto from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/admin-session'
import { getScrapingClient, scrapingQuery } from '@/lib/db'
import { activeBatchOperation } from '@/lib/batch-operation-lock'
import { getActiveSupplierPostProcess } from '@/lib/supplier-post-process'

type ScriptVersion = {
  id: string
  version: number
  name: string
  source: string
  is_active: boolean
  created_at: string
}

function normalizeName(value: unknown) {
  const name = String(value || '').trim().slice(0, 120)
  return name || 'Постобработка'
}

function normalizeSource(value: unknown) {
  const source = String(value || '').trim()
  if (!source) throw new Error('Вставьте код функции process_products(products)')
  if (source.length > 100_000) throw new Error('Код не должен превышать 100 000 символов')
  return source
}

function runner() {
  // The runner is the existing JSON stdin/stdout contract. Stored scripts never
  // become files in the application image, so a new version needs no deployment.
  return require('../scripts/lib/supplier-json-process') as {
    runSupplierJsonProcess: (script: { name: string; source: string }, products: unknown[], options?: { validateOnly?: boolean }) => Promise<unknown[]>
  }
}

export async function getSupplierPostProcessVersionsAction(supplierId: number) {
  try {
    await requireAdmin()
    const result = await scrapingQuery(`
      SELECT id,version,name,source,is_active,created_at
      FROM supplier_post_process_scripts
      WHERE supplier_id=$1
      ORDER BY version DESC
    `, [supplierId])
    return { success: true, data: result.rows as ScriptVersion[] }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function getSupplierPostProcessBatchesAction(supplierId: number) {
  try {
    await requireAdmin()
    const result = await scrapingQuery(`
      SELECT id,name,items_count,created_at
      FROM scraping_batches
      WHERE supplier_id=$1
      ORDER BY created_at DESC
      LIMIT 12
    `, [supplierId])
    return { success: true, data: result.rows }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function saveSupplierPostProcessVersionAction(supplierId: number, name: string, source: string) {
  try {
    await requireAdmin()
    const normalizedName = normalizeName(name)
    const normalizedSource = normalizeSource(source)
    await runner().runSupplierJsonProcess(
      { name: `${normalizedName}.py`, source: normalizedSource },
      [],
      { validateOnly: true },
    )

    const client = await getScrapingClient()
    try {
      await client.query('BEGIN')
      const supplier = await client.query('SELECT id FROM suppliers WHERE id=$1 FOR UPDATE', [supplierId])
      if (!supplier.rows[0]) throw new Error('Поставщик не найден')
      const versionResult = await client.query(
        'SELECT COALESCE(MAX(version),0)+1 AS version FROM supplier_post_process_scripts WHERE supplier_id=$1',
        [supplierId],
      )
      const version = Number(versionResult.rows[0].version)
      const inserted = await client.query(`
        INSERT INTO supplier_post_process_scripts(id,supplier_id,version,name,source)
        VALUES($1,$2,$3,$4,$5)
        RETURNING id,version,name,source,is_active,created_at
      `, [crypto.randomUUID(), supplierId, version, normalizedName, normalizedSource])
      await client.query('COMMIT')
      revalidatePath('/admin/suppliers')
      return { success: true, data: inserted.rows[0] as ScriptVersion }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function activateSupplierPostProcessVersionAction(supplierId: number, versionId: string) {
  try {
    await requireAdmin()
    const client = await getScrapingClient()
    try {
      await client.query('BEGIN')
      const version = await client.query(
        'SELECT id FROM supplier_post_process_scripts WHERE id=$1 AND supplier_id=$2 FOR UPDATE',
        [versionId, supplierId],
      )
      if (!version.rows[0]) throw new Error('Версия скрипта не найдена')
      await client.query('UPDATE supplier_post_process_scripts SET is_active=FALSE WHERE supplier_id=$1', [supplierId])
      await client.query('UPDATE supplier_post_process_scripts SET is_active=TRUE WHERE id=$1', [versionId])
      await client.query('COMMIT')
      revalidatePath('/admin/suppliers')
      return { success: true }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function previewSupplierPostProcessVersionAction(supplierId: number, versionId: string, batchId: string) {
  try {
    await requireAdmin()
    if (await activeBatchOperation(batchId)) throw new Error('Дождитесь завершения текущей операции с выгрузкой')
    const [versionResult, batchResult] = await Promise.all([
      scrapingQuery(`
        SELECT id,version,name,source,is_active,created_at FROM supplier_post_process_scripts
        WHERE id=$1 AND supplier_id=$2
      `, [versionId, supplierId]),
      scrapingQuery('SELECT id FROM scraping_batches WHERE id=$1 AND supplier_id=$2', [batchId, supplierId]),
    ])
    const version = versionResult.rows[0] as ScriptVersion | undefined
    if (!version || !batchResult.rows[0]) throw new Error('Версия или выгрузка не найдена у этого поставщика')
    const source = await scrapingQuery(`
      SELECT products FROM batch_snapshots
      WHERE batch_id=$1 AND stage='SCRAPED'
      ORDER BY created_at ASC LIMIT 1
    `, [batchId])
    const products = source.rows[0]?.products
    if (!Array.isArray(products) || !products.length) throw new Error('У выгрузки нет исходного снимка')
    const output = await runner().runSupplierJsonProcess({ name: `${version.name}.py`, source: version.source }, products)
    const before = new Map(products.map((item: any) => [String(item.external_id), item]))
    const changed = output.filter((item: any) => JSON.stringify(before.get(String(item.external_id))) !== JSON.stringify(item)).length
    return {
      success: true,
      data: {
        inputCount: products.length,
        outputCount: output.length,
        removedCount: Math.max(0, products.length - output.length),
        changedCount: changed,
      },
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}
