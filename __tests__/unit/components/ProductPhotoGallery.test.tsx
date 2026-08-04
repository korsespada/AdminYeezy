import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ProductPhotoGallery from '@/components/products/ProductPhotoGallery'

vi.mock('next/image', () => ({
  default: ({ fill: _fill, unoptimized: _unoptimized, priority: _priority, ...props }: React.ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean; unoptimized?: boolean; priority?: boolean }) => <img {...props} alt={props.alt || ''} />,
}))

describe('ProductPhotoGallery', () => {
  it('uses the shared five-column grid and closes the full photo with Escape', () => {
    const { container } = render(
      <ProductPhotoGallery photos={['https://example.com/one.jpg', 'https://example.com/two.jpg']} />,
    )

    expect(container.querySelector('.grid-cols-5')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Открыть фото 1 полностью' }))
    expect(screen.getByRole('dialog', { name: 'Фото 1 из 2' })).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows the generated alt text as a photo hint', () => {
    render(
      <ProductPhotoGallery
        photos={['https://example.com/one.jpg']}
        altTexts={['Черные кроссовки Gucci, вид сбоку']}
      />,
    )

    expect(screen.getByAltText('Черные кроссовки Gucci, вид сбоку')).toBeInTheDocument()
    expect(screen.getByAltText('Черные кроссовки Gucci, вид сбоку').parentElement).toHaveAttribute('title', 'Черные кроссовки Gucci, вид сбоку')
  })

  it('reports photo moves so the caller can reorder alt texts with the photos', () => {
    const onMove = vi.fn()
    render(
      <ProductPhotoGallery
        photos={['https://example.com/one.jpg', 'https://example.com/two.jpg']}
        altTexts={['Первое фото', 'Второе фото']}
        onMove={onMove}
      />,
    )

    fireEvent.dragStart(screen.getByAltText('Первое фото').parentElement!)
    fireEvent.dragOver(screen.getByAltText('Второе фото').parentElement!)

    expect(onMove).toHaveBeenCalledWith(0, 1)
  })
})
