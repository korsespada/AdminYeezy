'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/pocketbase'
import type { ActionResponse } from '@/lib/types'

/**
 * Login action - authenticates admin user with PocketBase
 * @param formData - Form data containing email and password
 * @returns ActionResponse with success status and optional error message
 */
export async function loginAction(formData: FormData): Promise<ActionResponse> {
  const email = formData.get('email') as string
  const password = formData.get('password') as string

  // Validate inputs
  if (!email || !password) {
    return {
      success: false,
      error: 'Email and password are required',
    }
  }

  // Trim and validate non-empty
  const trimmedEmail = email.trim()
  const trimmedPassword = password.trim()

  if (!trimmedEmail || !trimmedPassword) {
    return {
      success: false,
      error: 'Email and password cannot be empty',
    }
  }

  try {
    const pb = createClient()
    
    console.log('PocketBase URL:', pb.baseUrl)
    console.log('PocketBase version: 0.35')
    console.log('Attempting login with email:', trimmedEmail)

    let authData
    
    // Try multiple authentication methods for PocketBase 0.35
    try {
      console.log('Method 1: Trying _superusers collection...')
      authData = await pb.collection('_superusers').authWithPassword(trimmedEmail, trimmedPassword)
      console.log('✓ _superusers auth successful')
    } catch (superuserError: any) {
      console.log('✗ _superusers auth failed:', superuserError?.message)
      
      // Try old admins API
      try {
        console.log('Method 2: Trying pb.admins API...')
        authData = await pb.admins.authWithPassword(trimmedEmail, trimmedPassword)
        console.log('✓ admins API auth successful')
      } catch (adminsError: any) {
        console.log('✗ admins API failed:', adminsError?.message)
        
        // Try regular users collection as last resort
        try {
          console.log('Method 3: Trying users collection...')
          authData = await pb.collection('users').authWithPassword(trimmedEmail, trimmedPassword)
          console.log('✓ users collection auth successful')
        } catch (usersError: any) {
          console.log('✗ users collection failed:', usersError?.message)
          throw superuserError // Throw the first error
        }
      }
    }
    
    console.log('Auth successful, token received:', !!authData.token)

    if (!authData || !authData.token) {
      return {
        success: false,
        error: 'Authentication failed',
      }
    }

    // Store entire auth store as JSON in HTTP-only cookie
    const cookieStore = cookies()
    const authStoreData = JSON.stringify({
      token: authData.token,
      model: (authData as any).record || (authData as any).admin || authData,
    })
    
    console.log('Saving auth data to cookie')
    cookieStore.set('pb_auth', authStoreData, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: '/',
    })

    // Redirect to admin dashboard
    redirect('/admin')
  } catch (error: any) {
    console.error('Login error details:', {
      message: error?.message,
      status: error?.status,
      data: error?.data,
      response: error?.response,
      url: error?.url,
    })

    // Handle specific PocketBase errors
    if (error?.status === 404) {
      return {
        success: false,
        error: 'Authentication endpoint not found. Please check PocketBase configuration.',
      }
    }

    if (error?.status === 400) {
      return {
        success: false,
        error: 'Invalid email or password',
      }
    }

    if (error?.status === 0 || error?.message?.includes('fetch')) {
      return {
        success: false,
        error: 'Unable to connect to server. Please try again.',
      }
    }

    return {
      success: false,
      error: `An error occurred during login: ${error?.message || 'Unknown error'}`,
    }
  }
}

/**
 * Logout action - clears auth cookie and redirects to login
 */
export async function logoutAction(): Promise<void> {
  const cookieStore = cookies()
  cookieStore.delete('pb_auth')
  redirect('/login')
}
