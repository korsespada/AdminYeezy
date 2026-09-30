import { describe, expect, it } from 'vitest'
import { compactApplyError, isUnusableSource } from '@/lib/video-match-apply'

describe('isUnusableSource', () => {
  it('считает битым источник без moov или пустой ответ', () => {
    expect(isUnusableSource(new Error('[mov,mp4 @ 0x1] moov atom not found\nInvalid data found when processing input'))).toBe(true)
    expect(isUnusableSource(new Error('источник вернул пустое видео'))).toBe(true)
    expect(isUnusableSource(new Error('источник видео вернул HTTP 404'))).toBe(true)
  })

  it('не считает битым источник временные сбои', () => {
    expect(isUnusableSource(new Error('The operation was aborted due to timeout'))).toBe(false)
    expect(isUnusableSource(new Error('S3 не вернул ссылку на видео'))).toBe(false)
  })
})

describe('compactApplyError', () => {
  it('оставляет короткий текст как есть', () => {
    expect(compactApplyError(new Error('источник видео вернул HTTP 545'))).toBe('источник видео вернул HTTP 545')
  })

  it('из длинного вывода ffmpeg оставляет начало и причину в конце', () => {
    const banner = Array.from({ length: 40 }, (_, index) => `  configuration-line-${index}`).join('\n')
    const message = `ffmpeg завершился с кодом 1: ffmpeg version 5.1.9\n${banner}\n[libx264] width not divisible by 2 (659x1080)\nConversion failed!`
    const compact = compactApplyError(new Error(message))
    expect(compact.length).toBeLessThanOrEqual(700)
    expect(compact).toContain('ffmpeg завершился с кодом 1')
    expect(compact).toContain('width not divisible by 2')
    expect(compact).toContain('Conversion failed!')
    expect(compact).not.toContain('configuration-line-20')
  })

  it('переживает пустую ошибку', () => {
    expect(compactApplyError(null)).toBe('ошибка применения')
  })
})
