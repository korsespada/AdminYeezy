import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import ProductDescription, { normalizeDescription } from '@/components/products/ProductDescription'

describe('ProductDescription', () => {
  it('normalizes escaped newlines', () => {
    expect(normalizeDescription('Line one\\n\\nLine two')).toBe('Line one\n\nLine two')
  })

  it('renders bold markers as strong text', () => {
    render(<ProductDescription text="Обычный **жирный** текст" />)

    expect(screen.getByText('жирный').tagName).toBe('STRONG')
    expect(screen.getByText(/Обычный/)).toBeInTheDocument()
  })
})
