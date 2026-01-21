import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createClient } from '../../../lib/pocketbase'

describe('PocketBase Client', () => {
  const originalEnv = process.env.NEXT_PUBLIC_POCKETBASE_URL

  afterEach(() => {
    process.env.NEXT_PUBLIC_POCKETBASE_URL = originalEnv
  })

  describe('Environment Variable Usage', () => {
    it('should use NEXT_PUBLIC_POCKETBASE_URL environment variable', () => {
      const testUrl = 'http://test.example.com:8090'
      process.env.NEXT_PUBLIC_POCKETBASE_URL = testUrl

      const pb = createClient()

      expect(pb).toBeDefined()
      expect(pb.baseUrl).toBe(testUrl)
    })

    it('should throw error when NEXT_PUBLIC_POCKETBASE_URL is missing', () => {
      delete process.env.NEXT_PUBLIC_POCKETBASE_URL

      expect(() => createClient()).toThrow(
        'NEXT_PUBLIC_POCKETBASE_URL environment variable is not set'
      )
    })

    it('should throw error with helpful message when env var is missing', () => {
      delete process.env.NEXT_PUBLIC_POCKETBASE_URL

      expect(() => createClient()).toThrow(
        /Please add it to your \.env\.local file/
      )
    })

    it('should handle empty string as missing env var', () => {
      process.env.NEXT_PUBLIC_POCKETBASE_URL = ''

      expect(() => createClient()).toThrow()
    })
  })

  describe('Client Initialization', () => {
    beforeEach(() => {
      process.env.NEXT_PUBLIC_POCKETBASE_URL = 'http://127.0.0.1:8090'
    })

    it('should create PocketBase instance', () => {
      const pb = createClient()

      expect(pb).toBeDefined()
      expect(pb.authStore).toBeDefined()
    })

    it('should initialize with empty auth by default', () => {
      const pb = createClient()

      expect(pb.authStore.token).toBe('')
      expect(pb.authStore.isValid).toBe(false)
    })
  })
})
