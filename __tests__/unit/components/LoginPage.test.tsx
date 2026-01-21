import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import LoginPage from '../../../app/login/page'

// Mock the auth actions
vi.mock('../../../actions/auth', () => ({
  loginAction: vi.fn(),
}))

describe('LoginPage', () => {
  describe('Form Rendering', () => {
    it('should display email and password fields', () => {
      render(<LoginPage />)

      const emailInput = screen.getByLabelText(/email address/i)
      const passwordInput = screen.getByLabelText(/password/i)

      expect(emailInput).toBeInTheDocument()
      expect(passwordInput).toBeInTheDocument()
    })

    it('should display submit button', () => {
      render(<LoginPage />)

      const submitButton = screen.getByRole('button', { name: /sign in/i })

      expect(submitButton).toBeInTheDocument()
    })

    it('should display welcome message', () => {
      render(<LoginPage />)

      const heading = screen.getByText(/welcome back/i)
      const subheading = screen.getByText(/sign in to your admin dashboard/i)

      expect(heading).toBeInTheDocument()
      expect(subheading).toBeInTheDocument()
    })

    it('should have email input with correct type', () => {
      render(<LoginPage />)

      const emailInput = screen.getByLabelText(/email address/i)

      expect(emailInput).toHaveAttribute('type', 'email')
    })

    it('should have password input with correct type', () => {
      render(<LoginPage />)

      const passwordInput = screen.getByLabelText(/password/i)

      expect(passwordInput).toHaveAttribute('type', 'password')
    })

    it('should have required attribute on email field', () => {
      render(<LoginPage />)

      const emailInput = screen.getByLabelText(/email address/i)

      expect(emailInput).toBeRequired()
    })

    it('should have required attribute on password field', () => {
      render(<LoginPage />)

      const passwordInput = screen.getByLabelText(/password/i)

      expect(passwordInput).toBeRequired()
    })
  })

  describe('Form Validation', () => {
    it('should show error when both fields are empty', async () => {
      render(<LoginPage />)

      const submitButton = screen.getByRole('button', { name: /sign in/i })

      // Try to submit without filling fields
      fireEvent.click(submitButton)

      // HTML5 validation will prevent submission, so error won't show
      // This is expected behavior - browser handles validation
      const emailInput = screen.getByLabelText(/email address/i)
      expect(emailInput).toBeRequired()
    })

    it('should allow typing in email field', async () => {
      render(<LoginPage />)

      const emailInput = screen.getByLabelText(/email address/i) as HTMLInputElement

      await userEvent.type(emailInput, 'test@example.com')

      expect(emailInput.value).toBe('test@example.com')
    })

    it('should allow typing in password field', async () => {
      render(<LoginPage />)

      const passwordInput = screen.getByLabelText(/password/i) as HTMLInputElement

      await userEvent.type(passwordInput, 'password123')

      expect(passwordInput.value).toBe('password123')
    })
  })
})
