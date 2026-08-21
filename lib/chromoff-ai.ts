import { BatchAiProvider } from './batch-ai'

export type ChromoffAiSettings = {
  provider: BatchAiProvider
  providerId?: string
  activeProviderId?: string | null
  providerName?: string
  providerBaseUrl?: string
  providerApiKey?: string
  openrouterModel: string
  byesuModel: string
  temperature: number
  maxTokens: number
  concurrency: number
  systemPrompt: string
}

export const DEFAULT_CHROMOFF_AI_SETTINGS: ChromoffAiSettings = {
  provider: 'openrouter',
  openrouterModel: 'google/gemini-2.5-flash',
  byesuModel: 'gemini-3.1-flash-lite',
  temperature: 0.1,
  maxTokens: 2000,
  concurrency: 5,
  systemPrompt: `Ты эксперт-копирайтер модной одежды. 
Тебе будут переданы фотографии товара.
Твоя задача — сгенерировать 4 поля в формате JSON:
1. name - название товара
2. description - подробное описание
3. seo_description - краткое SEO описание товара для Chromoff
4. attributes - объект с характеристиками (ключ: значение)
5. alts - массив строк (alt-текстов) для каждой фотографии по порядку.`,
}

export function hydrateChromoffAiSettings(data: unknown): ChromoffAiSettings {
  const source = typeof data === 'object' && data !== null ? data : {}
  return {
    ...DEFAULT_CHROMOFF_AI_SETTINGS,
    ...source,
  }
}

