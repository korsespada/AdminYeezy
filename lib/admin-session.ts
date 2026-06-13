export const ADMIN_SESSION_COOKIE = 'admin_auth'
export const ADMIN_TOKEN_COOKIE = 'admin_token'
export const LEGACY_PB_AUTH_COOKIE = 'pb_auth'

export interface AdminSession {
  id: string | number
  email: string
  name?: string | null
  role?: string | null
  source: 'rails' | 'local' | 'legacy'
}
