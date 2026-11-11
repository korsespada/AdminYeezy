import { describe, expect, it } from 'vitest'
import {
  abortAiRun,
  aiCancellableDelay,
  AiRequestCancelledError,
  currentAiAbortSignal,
  isAiCancelledError,
  registerAiRunController,
  throwIfAiCancelled,
  withAiAbortSignal,
} from '@/lib/ai-cancellation'
import { isRetryableBatchAiError } from '@/lib/batch-ai'
import { isProxyFailoverError } from '@/lib/batch-ai-proxies'

describe('ai cancellation', () => {
  it('aborts every registered item of a run', () => {
    const first = new AbortController()
    const second = new AbortController()
    const other = new AbortController()
    registerAiRunController('run-1', first)
    registerAiRunController('run-1', second)
    registerAiRunController('run-2', other)
    expect(abortAiRun('run-1')).toBe(2)
    expect(first.signal.aborted).toBe(true)
    expect(second.signal.aborted).toBe(true)
    expect(other.signal.aborted).toBe(false)
    expect(abortAiRun('run-1')).toBe(0)
    abortAiRun('run-2')
  })

  it('unregisters finished items', () => {
    const controller = new AbortController()
    const unregister = registerAiRunController('run-3', controller)
    unregister()
    expect(abortAiRun('run-3')).toBe(0)
    expect(controller.signal.aborted).toBe(false)
  })

  it('exposes the signal through async context', async () => {
    const controller = new AbortController()
    await withAiAbortSignal(controller.signal, async () => {
      await Promise.resolve()
      expect(currentAiAbortSignal()).toBe(controller.signal)
      expect(() => throwIfAiCancelled()).not.toThrow()
      controller.abort()
      expect(() => throwIfAiCancelled()).toThrow(AiRequestCancelledError)
    })
    expect(currentAiAbortSignal()).toBeUndefined()
  })

  it('interrupts the retry delay on abort', async () => {
    const controller = new AbortController()
    const delay = withAiAbortSignal(controller.signal, () => aiCancellableDelay(60_000))
    controller.abort()
    await expect(delay).rejects.toBeInstanceOf(AiRequestCancelledError)
  })

  it('is neither retried nor sent through another proxy', () => {
    const error = new AiRequestCancelledError()
    expect(isAiCancelledError(error)).toBe(true)
    expect(isRetryableBatchAiError(error)).toBe(false)
    expect(isProxyFailoverError(error)).toBe(false)
  })
})
