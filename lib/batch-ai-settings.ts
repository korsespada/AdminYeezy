import { scrapingQuery } from '@/lib/db'
import { decryptProviderApiKey } from '@/lib/ai-providers'
import type { BatchAiProvider, BatchAiSettings } from '@/lib/batch-ai'

/**
 * Дополняет настройки ИИ ключом и адресом выбранного провайдера.
 *
 * Вынесено из серверных экшенов «Выгрузок»: расшифровка ключа не должна быть
 * доступна как server action, но нужна и обработке карточек поставщика.
 */
export async function hydrateBatchAiSettings(settings: BatchAiSettings): Promise<BatchAiSettings> {
  const providerId = String(settings.providerId || settings.activeProviderId || '').trim()
  if (!providerId) return settings
  const result = await scrapingQuery('SELECT id,kind,name,base_url,api_key_ciphertext,model FROM ai_providers WHERE id=$1', [providerId])
  const row = result.rows[0]
  if (!row) throw new Error('Выбранный AI-провайдер удалён или недоступен')
  return {
    ...settings,
    provider: row.kind as BatchAiProvider,
    providerName: String(row.name || ''),
    providerBaseUrl: String(row.base_url || ''),
    providerApiKey: decryptProviderApiKey(row.api_key_ciphertext),
    openrouterModel: row.kind === 'openrouter' ? String(row.model || '') : settings.openrouterModel,
    byesuModel: row.kind === 'byesu' ? String(row.model || '') : settings.byesuModel,
  }
}
