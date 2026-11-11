import { AsyncLocalStorage } from 'node:async_hooks'
import type { ClientRequest } from 'node:http'

/**
 * Отмена AI-запросов запуска выгрузки.
 *
 * Раньше «Остановить» только помечал запуск и товары отменёнными, а товары,
 * уже взятые в работу, проходили весь конвейер (основной запрос, уточнение,
 * перечитку размеров) и продолжали занимать провайдера ещё минуты. Теперь
 * каждый товар работает под своим AbortSignal: остановка запуска обрывает
 * текущий HTTP-запрос, а следующие запросы товара не начинаются.
 *
 * Состояние лежит в globalThis: серверные действия и фоновые обработчики
 * Next.js могут попасть в разные чанки, а реестр должен быть один на процесс.
 */
type CancellationGlobals = {
  storage: AsyncLocalStorage<AbortSignal>
  runControllers: Map<string, Set<AbortController>>
}

const globalKey = Symbol.for('adminyeezy.aiCancellation')
const globals: CancellationGlobals = ((globalThis as any)[globalKey] ||= {
  storage: new AsyncLocalStorage<AbortSignal>(),
  runControllers: new Map<string, Set<AbortController>>(),
})

export class AiRequestCancelledError extends Error {
  code = 'AI_CANCELLED'

  constructor(message = 'Запуск ИИ остановлен') {
    super(message)
    this.name = 'AiRequestCancelledError'
  }
}

export function isAiCancelledError(error: unknown) {
  const record = error as { name?: unknown; code?: unknown } | null
  return record?.name === 'AiRequestCancelledError' || record?.code === 'AI_CANCELLED'
}

export function withAiAbortSignal<T>(signal: AbortSignal, run: () => T): T {
  return globals.storage.run(signal, run)
}

export function currentAiAbortSignal(): AbortSignal | undefined {
  return globals.storage.getStore()
}

export function throwIfAiCancelled(signal = currentAiAbortSignal()) {
  if (signal?.aborted) throw new AiRequestCancelledError()
}

/** Обрывает node-запрос при отмене; возвращает функцию снятия подписки. */
export function bindAiAbortToRequest(request: ClientRequest, signal = currentAiAbortSignal()) {
  if (!signal) return () => undefined
  const onAbort = () => request.destroy(new AiRequestCancelledError())
  if (signal.aborted) {
    onAbort()
    return () => undefined
  }
  signal.addEventListener('abort', onAbort, { once: true })
  return () => signal.removeEventListener('abort', onAbort)
}

/** Пауза между повторами, которую отмена прерывает сразу. */
export function aiCancellableDelay(ms: number, signal = currentAiAbortSignal()) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AiRequestCancelledError())
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(new AiRequestCancelledError())
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export function registerAiRunController(runId: string, controller: AbortController) {
  const set = globals.runControllers.get(runId) || new Set<AbortController>()
  set.add(controller)
  globals.runControllers.set(runId, set)
  return () => {
    set.delete(controller)
    if (!set.size && globals.runControllers.get(runId) === set) globals.runControllers.delete(runId)
  }
}

/** Обрывает все товары запуска, которые обрабатываются в этом процессе. */
export function abortAiRun(runId: string) {
  const set = globals.runControllers.get(runId)
  if (!set) return 0
  const count = set.size
  for (const controller of set) controller.abort()
  globals.runControllers.delete(runId)
  return count
}
