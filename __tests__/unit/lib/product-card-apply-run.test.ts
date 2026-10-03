import { describe, expect, it } from 'vitest'
import { autoApplyDue } from '@/lib/product-card-apply-run'

/**
 * Решение об автоприменении: включается только когда оператор включил тумблер,
 * есть апрувнутые строки и цикл ещё не работает.
 */
describe('autoApplyDue', () => {
  it('запускает применение только при включённом тумблере и апрувнутых строках', () => {
    expect(autoApplyDue({ autoApply: true, approved: 2180, active: false })).toBe(true)
    expect(autoApplyDue({ autoApply: false, approved: 2180, active: false })).toBe(false)
    expect(autoApplyDue({ autoApply: true, approved: 0, active: false })).toBe(false)
    expect(autoApplyDue({ autoApply: true, approved: 10, active: true })).toBe(false)
  })
})
