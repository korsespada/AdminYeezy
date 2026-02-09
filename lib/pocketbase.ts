import PocketBase from 'pocketbase'
import { cookies } from 'next/headers'

/**
 * Creates a PocketBase client instance
 * - On server: automatically loads auth token from cookies
 * - On client: returns unauthenticated client
 */
export function createClient(): PocketBase {
  const pbUrl = process.env.NEXT_PUBLIC_POCKETBASE_URL

  if (!pbUrl) {
    throw new Error(
      'NEXT_PUBLIC_POCKETBASE_URL environment variable is not set. ' +
      'Please add it to your .env.local file.'
    )
  }

  const pb = new PocketBase(pbUrl)

  // Check if we're on the server
  if (typeof window === 'undefined') {
    try {
      // Load auth token from cookies on server
      const cookieStore = cookies()
      const authCookie = cookieStore.get('pb_auth')

      if (authCookie?.value) {
        try {
          const authData = JSON.parse(authCookie.value)
          pb.authStore.save(authData.token, authData.model)
        } catch (parseError) {
          // Ignore parse errors
        }
      }
    } catch (error) {
      // cookies() can only be called in Server Components/Actions
      // If it fails, we're likely in a context where it's not available
      console.warn('Unable to load auth token from cookies:', error)
    }
  }

  return pb
}
