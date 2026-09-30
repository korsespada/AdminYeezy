import { describe, expect, it } from 'vitest'

import {
  SZWEGO_PARSE_MODE_LABELS,
  SZWEGO_PARSE_MODES,
  normalizeSzwegoParseMode,
} from '@/lib/szwego-parse-mode'

describe('szwego parse mode', () => {
  it('keeps the three supported sources', () => {
    expect(SZWEGO_PARSE_MODES).toEqual(['images', 'all', 'video'])
    expect(Object.keys(SZWEGO_PARSE_MODE_LABELS)).toEqual(['images', 'all', 'video'])
  })

  it('normalizes stored values and falls back to images', () => {
    expect(normalizeSzwegoParseMode('all')).toBe('all')
    expect(normalizeSzwegoParseMode('video')).toBe('video')
    expect(normalizeSzwegoParseMode(' VIDEO ')).toBe('video')
    expect(normalizeSzwegoParseMode('images')).toBe('images')
    expect(normalizeSzwegoParseMode(null)).toBe('images')
    expect(normalizeSzwegoParseMode(undefined)).toBe('images')
    expect(normalizeSzwegoParseMode('')).toBe('images')
    expect(normalizeSzwegoParseMode('feed')).toBe('images')
  })
})
