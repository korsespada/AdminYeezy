import { scrapingQuery } from '@/lib/db'
import { defaultCardPromptForPreset, defaultPackagingForPreset } from '@/lib/product-card-prompts'
import { findProductCardPreset } from '@/lib/product-card-presets'

/**
 * Настройки поставщика для обработки карточек: промпт ИИ, блок комплектации
 * и прогресс.
 *
 * Промпт хранится в scraping-БД отдельно от инструкций «Выгрузок», поэтому
 * правка текста для карточек не меняет поведение разбора сырых выгрузок.
 */

interface CardSupplierSettings {
  ai_prompt: string
  packaging_text: string
}

async function readSettings(supplierId: string): Promise<CardSupplierSettings> {
  const result = await scrapingQuery<CardSupplierSettings>(
    `SELECT ai_prompt, packaging_text FROM product_card_supplier_settings WHERE supplier_id = $1`,
    [supplierId],
  )
  return {
    ai_prompt: String(result.rows[0]?.ai_prompt || ''),
    packaging_text: String(result.rows[0]?.packaging_text || ''),
  }
}

export async function getCardSupplierPrompt(supplierId: string) {
  return (await readSettings(supplierId)).ai_prompt
}

export async function getCardSupplierPackaging(supplierId: string) {
  return (await readSettings(supplierId)).packaging_text
}

export async function saveCardSupplierSettings(supplierId: string, input: { prompt?: string; packaging?: string }) {
  const current = await readSettings(supplierId)
  const prompt = input.prompt === undefined ? current.ai_prompt : String(input.prompt || '')
  const packaging = input.packaging === undefined ? current.packaging_text : String(input.packaging || '')
  await scrapingQuery(
    `INSERT INTO product_card_supplier_settings (supplier_id, ai_prompt, packaging_text, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (supplier_id) DO UPDATE SET
       ai_prompt = EXCLUDED.ai_prompt,
       packaging_text = EXCLUDED.packaging_text,
       updated_at = NOW()`,
    [supplierId, prompt, packaging],
  )
}

export async function saveCardSupplierPrompt(supplierId: string, prompt: string) {
  await saveCardSupplierSettings(supplierId, { prompt })
}

/** Промпт и комплектация для запроса: сохранённые, иначе подсказки пресета. */
export async function resolveCardSupplierPrompt(presetKey: string) {
  const preset = findProductCardPreset(presetKey)
  const stored = await readSettings(preset.supplierUuid)
  const promptFallback = defaultCardPromptForPreset(preset.key)
  const packagingFallback = defaultPackagingForPreset(preset.key)
  return {
    stored: stored.ai_prompt,
    fallback: promptFallback,
    effective: stored.ai_prompt.trim() || promptFallback,
    packagingStored: stored.packaging_text,
    packagingFallback,
    packaging: stored.packaging_text.trim() || packagingFallback,
  }
}
