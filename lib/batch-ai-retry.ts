import { isAiCancelledError } from '@/lib/ai-cancellation'
import { isRetryableBatchAiError } from '@/lib/batch-ai'

/**
 * Повтор товара целиком, поверх повторов одного запроса (`withBatchAiRetry`,
 * паузы 1–8 с). Сбой relay или провайдера длится минуты: «upstream temporarily
 * unavailable», `auth_unavailable`, нехватка баланса relay, 403 и битый JSON от
 * BYESU. Раньше товар после такого сбоя сразу получал `failed` с одной
 * попыткой, и выгрузка не доходила до «Обработано ИИ». Теперь упавший товар
 * возвращается в очередь своего запуска и повторяется после паузы, а остальные
 * товары обрабатываются дальше.
 */

/** Сбой провайдера или relay: повторяем дольше. */
export const BATCH_AI_PROVIDER_ITEM_ATTEMPTS = 5
/** Ответ модели не прошёл проверку (JSON, подкатегория, название): ещё одна попытка. */
export const BATCH_AI_CONTENT_ITEM_ATTEMPTS = 2

// Ошибки аккаунта и канала relay, которые не похожи на сетевые, но проходят
// сами: ротация ключей (`auth_unavailable`, `project_id`), пополнение баланса,
// временные 401/403 и HTML вместо JSON от BYESU, оборванный поток.
const PROVIDER_ERROR_PATTERN = /auth_unavailable|no auth available|project_id|quota|insufficient|balance|no available channel|openai_error|terminated|вернул некорректный json|ошибка \d{3}|\b40[13]\b|service unavailable|internal error|server error/i

export function isBatchAiProviderError(error: unknown) {
  if (isRetryableBatchAiError(error)) return true
  return PROVIDER_ERROR_PATTERN.test(String((error as Error)?.message || error || ''))
}

/** Сколько всего попыток товара допускает эта ошибка (0 — не повторять). */
export function batchAiItemMaxAttempts(error: unknown) {
  if (isAiCancelledError(error)) return 0
  return isBatchAiProviderError(error) ? BATCH_AI_PROVIDER_ITEM_ATTEMPTS : BATCH_AI_CONTENT_ITEM_ATTEMPTS
}

export function shouldRetryBatchAiItem(error: unknown, attempts: number) {
  return attempts < batchAiItemMaxAttempts(error)
}

const RETRY_ROUND_DELAYS_MS = [30_000, 2 * 60_000, 5 * 60_000, 10 * 60_000]

/**
 * Пауза перед кругом повторов: товары, вернувшиеся в очередь, ждут, пока
 * провайдер отойдёт. Круг 1 — после основного прохода.
 */
export function batchAiRetryRoundDelayMs(round: number) {
  const index = Math.max(0, Math.min(RETRY_ROUND_DELAYS_MS.length - 1, Math.floor(round) - 1))
  return RETRY_ROUND_DELAYS_MS[index]
}
