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

const CORE_SETTINGS_KEYS = [
  'batch_ai_provider',
  'batch_ai_provider_id',
  'batch_ai_openrouter_model',
  'batch_ai_byesu_model',
  'batch_ai_temperature',
  'batch_ai_max_tokens',
  'batch_ai_concurrency',
]

/**
 * Настройки ИИ без привязки к запросу: нужны фоновому прогону по карточкам,
 * который работает в супервизоре и не имеет сессии оператора.
 */
export async function loadBatchAiSettingsCore(): Promise<BatchAiSettings> {
  const result = await scrapingQuery('SELECT key, value FROM app_settings WHERE key=ANY($1::text[])', [CORE_SETTINGS_KEYS])
  const values = Object.fromEntries(result.rows.map((row) => [row.key, row.value])) as Record<string, string>
  const providers = await scrapingQuery('SELECT id,kind,model FROM ai_providers ORDER BY updated_at DESC, created_at DESC').catch(() => ({ rows: [] as any[] }))
  const activeProviderId = String(values.batch_ai_provider_id || '').trim() || null
  const active = providers.rows.find((row: any) => String(row.id) === activeProviderId)
  const provider = active
    ? active.kind as BatchAiProvider
    : (['openrouter', 'byesu', 'cockpit'].includes(values.batch_ai_provider) ? values.batch_ai_provider as BatchAiProvider : 'openrouter')
  const number = (value: string | undefined, fallback: number) => {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
  }
  return hydrateBatchAiSettings({
    provider,
    activeProviderId,
    providerId: activeProviderId || undefined,
    openrouterModel: active?.kind === 'openrouter' ? String(active.model || '') : values.batch_ai_openrouter_model || 'google/gemini-2.5-flash',
    byesuModel: active?.kind === 'byesu' ? String(active.model || '') : values.batch_ai_byesu_model || 'gemini-3.1-flash-lite',
    temperature: number(values.batch_ai_temperature, 0.1),
    maxTokens: Math.max(1000, number(values.batch_ai_max_tokens, 5000)),
    concurrency: Math.max(1, Math.min(10, Math.round(number(values.batch_ai_concurrency, 5)))),
    systemPrompt: '',
    categoryRules: [],
  })
}
