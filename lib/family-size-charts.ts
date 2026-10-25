import { scrapingQuery } from '@/lib/db'
import type { BatchAiSettings } from '@/lib/batch-ai'
import { applyMeasurementTableAttributes } from '@/lib/measurement-templates'
import { recognizeMeasurementImage } from '@/lib/measurement-recognition'
import { colorFamilyAlignment } from '@/lib/color-family-alignment'

// ИИ читает размерную сетку в карточке каждого цвета отдельно. Постобработка
// копирует одну и ту же картинку сетки во все цвета семьи, а ИИ читает её
// по-разному: полуобхват вместо обхвата, другие колонки, пропущенная строка.
// Здесь одна картинка сетки читается один раз и записывается всем цветам,
// у которых она есть.

function chartUrl(value: unknown) {
  return String(value || '').trim().split('#')[0]
}

/** Картинки сетки каждого товара по последнему ответу ИИ на его карточку. */
async function productChartPhotoUrls(productIds: number[]) {
  const result = await scrapingQuery(`
    SELECT DISTINCT ON (i.product_id) i.product_id,
      i.input_snapshot->'photoUrls' AS urls,
      i.output->'mediaDecision'->'sizeCharts' AS charts
    FROM batch_ai_items i JOIN batch_ai_runs r ON r.id=i.run_id
    WHERE i.product_id=ANY($1::int[]) AND i.status='completed'
      AND r.mode NOT IN ('family_names','variants','media_seo')
    ORDER BY i.product_id, i.completed_at DESC
  `, [productIds])
  return new Map<number, string[]>(result.rows.map((row) => {
    const urls = Array.isArray(row.urls) ? row.urls : []
    const charts = Array.isArray(row.charts) ? row.charts : []
    return [Number(row.product_id), [...new Set(charts.map((index: unknown) => chartUrl(urls[Number(index) - 1])).filter(Boolean))] as string[]]
  }))
}

/**
 * Записывает товарам семьи `attributes.size_chart_photo_urls` и делает одну
 * таблицу на одну картинку сетки: если цвета прочитали её по-разному, картинка
 * распознаётся заново (два независимых прочтения), а при неудаче берётся самое
 * частое и полное из прочтений. Таблица и размерный ряд пишутся всем цветам
 * с этой картинкой.
 */
export async function syncFamilySizeCharts(
  batchId: string,
  productIds: number[],
  loadSettings: () => Promise<BatchAiSettings>,
) {
  const { mainMeasurementReading, measurementContentKey } = colorFamilyAlignment()
  const summary = { photos: 0, reread: 0, rereadFailed: 0, updated: 0 }
  const ids = [...new Set(productIds.map(Number).filter(Number.isInteger))]
  if (ids.length === 0) return summary
  const members = (await scrapingQuery(`
    SELECT id,variant_group_key,attributes,ai_processed FROM products
    WHERE batch_id=$1 AND variant_group_key IN (
      SELECT variant_group_key FROM products
      WHERE batch_id=$1 AND id=ANY($2::int[]) AND NULLIF(variant_group_key,'') IS NOT NULL
    )
  `, [batchId, ids])).rows
  const families = new Map<string, any[]>()
  for (const member of members) families.set(member.variant_group_key, [...(families.get(member.variant_group_key) || []), member])
  const complete = [...families.values()].filter((family) => family.length > 1 && family.every((member) => member.ai_processed === true))
  const photos = await productChartPhotoUrls(complete.flat().map((member) => Number(member.id)))
  const next = new Map<number, Record<string, any>>()
  const recognized = new Map<string, unknown>()
  let settings: BatchAiSettings | null = null

  for (const family of complete) {
    for (const member of family) {
      const urls = photos.get(Number(member.id)) || []
      const attributes = { ...(member.attributes || {}) }
      if (JSON.stringify(attributes.size_chart_photo_urls || []) !== JSON.stringify(urls)) {
        attributes.size_chart_photo_urls = urls
        next.set(Number(member.id), attributes)
      }
    }
    const byPhoto = new Map<string, any[]>()
    for (const member of family) {
      for (const url of photos.get(Number(member.id)) || []) byPhoto.set(url, [...(byPhoto.get(url) || []), member])
    }
    for (const [url, holders] of byPhoto) {
      if (holders.length < 2) continue
      summary.photos += 1
      const readings = holders.map((member) => (next.get(Number(member.id)) || member.attributes || {}).measurements)
      if (new Set(readings.map((reading) => measurementContentKey(reading))).size === 1 && measurementContentKey(readings[0])) continue
      if (!recognized.has(url)) {
        try {
          settings ||= await loadSettings()
          recognized.set(url, await recognizeMeasurementImage(url, settings))
          summary.reread += 1
        } catch (error: any) {
          console.warn(`[family-size-charts] ${url}: ${error?.message || error}`)
          recognized.set(url, null)
          summary.rereadFailed += 1
        }
      }
      const table = recognized.get(url) || mainMeasurementReading(readings)
      if (!table) continue
      for (const member of holders) {
        const current = next.get(Number(member.id)) || { ...(member.attributes || {}) }
        next.set(Number(member.id), applyMeasurementTableAttributes(current, table))
      }
    }
  }

  for (const [id, attributes] of next) {
    await scrapingQuery('UPDATE products SET attributes=$2::jsonb,updated_at=NOW() WHERE id=$1 AND batch_id=$3', [id, JSON.stringify(attributes), batchId])
    summary.updated += 1
  }
  if (summary.photos > 0) console.info('[family-size-charts]', JSON.stringify({ batchId, ...summary }))
  return summary
}
