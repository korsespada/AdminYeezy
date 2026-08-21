'use server'

import { requireAdmin } from '@/lib/admin-session'
import { getScrapingClient, scrapingQuery } from '@/lib/db'
import { ChromoffAiSettings, hydrateChromoffAiSettings } from '@/lib/chromoff-ai'

const SETTINGS_KEYS = [
  'chromoff_ai_provider',
  'chromoff_ai_provider_id',
  'chromoff_ai_openrouter_model',
  'chromoff_ai_byesu_model',
  'chromoff_ai_temperature',
  'chromoff_ai_max_tokens',
  'chromoff_ai_concurrency',
  'chromoff_ai_system_prompt'
]

export async function getChromoffAiSettingsAction() {
  await requireAdmin()
  const result = await scrapingQuery('SELECT key, value FROM app_settings WHERE key=ANY($1::text[])', [SETTINGS_KEYS])
  const values = Object.fromEntries(result.rows.map((row) => [row.key, row.value]))
  
  return {
    success: true,
    data: hydrateChromoffAiSettings({
      provider: values.chromoff_ai_provider,
      providerId: values.chromoff_ai_provider_id,
      openrouterModel: values.chromoff_ai_openrouter_model,
      byesuModel: values.chromoff_ai_byesu_model,
      temperature: Number(values.chromoff_ai_temperature),
      maxTokens: Number(values.chromoff_ai_max_tokens),
      concurrency: Number(values.chromoff_ai_concurrency),
      systemPrompt: values.chromoff_ai_system_prompt
    })
  }
}

export async function updateChromoffAiSettingsAction(settings: Partial<ChromoffAiSettings>) {
  await requireAdmin()
  
  const values: Record<string, string> = {}
  if (settings.provider !== undefined) values.chromoff_ai_provider = settings.provider
  if (settings.providerId !== undefined) values.chromoff_ai_provider_id = settings.providerId || ''
  if (settings.openrouterModel !== undefined) values.chromoff_ai_openrouter_model = settings.openrouterModel
  if (settings.byesuModel !== undefined) values.chromoff_ai_byesu_model = settings.byesuModel
  if (settings.temperature !== undefined) values.chromoff_ai_temperature = String(settings.temperature)
  if (settings.maxTokens !== undefined) values.chromoff_ai_max_tokens = String(settings.maxTokens)
  if (settings.concurrency !== undefined) values.chromoff_ai_concurrency = String(settings.concurrency)
  if (settings.systemPrompt !== undefined) values.chromoff_ai_system_prompt = settings.systemPrompt

  const client = await getScrapingClient()
  try {
    await client.query('BEGIN')
    for (const [key, value] of Object.entries(values)) {
      await client.query(
        'INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()',
        [key, value]
      )
    }
    await client.query('COMMIT')
    return { success: true }
  } catch (error) {
    await client.query('ROLLBACK')
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  } finally {
    client.release()
  }
}

export async function startChromoffAiRunAction(listingIds: string[]) {
  await requireAdmin()
  if (!listingIds.length) return { success: false, error: 'Нет товаров для обработки' }
  
  const settingsResult = await getChromoffAiSettingsAction()
  const settings = settingsResult.data
  
  const client = await getScrapingClient()
  try {
    await client.query('BEGIN')
    
    // Ensure tables exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS chromoff_ai_runs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        status VARCHAR(50) DEFAULT 'pending',
        total_count INT DEFAULT 0,
        completed_count INT DEFAULT 0,
        failed_count INT DEFAULT 0,
        settings JSONB NOT NULL,
        error_message TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        completed_at TIMESTAMP WITH TIME ZONE
      );
      
      CREATE TABLE IF NOT EXISTS chromoff_ai_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        run_id UUID REFERENCES chromoff_ai_runs(id) ON DELETE CASCADE,
        listing_id VARCHAR(255) NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        error_message TEXT,
        result JSONB,
        lease_token UUID,
        lease_expires_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `)
    
    const runRes = await client.query(`
      INSERT INTO chromoff_ai_runs (total_count, settings)
      VALUES ($1, $2)
      RETURNING id
    `, [listingIds.length, JSON.stringify(settings)])
    
    const runId = runRes.rows[0].id
    
    for (const id of listingIds) {
      await client.query(`
        INSERT INTO chromoff_ai_items (run_id, listing_id)
        VALUES ($1, $2)
      `, [runId, id])
    }
    
    await client.query('COMMIT')
    return { success: true, runId }
  } catch (error) {
    await client.query('ROLLBACK')
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  } finally {
    client.release()
  }
}
