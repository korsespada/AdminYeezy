import { fireEvent, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { describe, expect, it, vi } from 'vitest'
import ProductPhotoGallery, { isPhotoLightboxOpen } from '@/components/products/ProductPhotoGallery'

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

    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps Escape inside the gallery: the product container stays open', () => {
    const onContainerEscape = vi.fn()

    // Так же ведут себя шторка товара (ProductForm) и дровер Chromoff.
    function ProductContainer() {
      useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
          if (event.key !== 'Escape') return
          if (isPhotoLightboxOpen()) return
          onContainerEscape()
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
      }, [])

      return <ProductPhotoGallery photos={['https://example.com/one.jpg', 'https://example.com/two.jpg']} />
    }

    render(<ProductContainer />)
    expect(isPhotoLightboxOpen()).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Открыть фото 1 полностью' }))
    expect(isPhotoLightboxOpen()).toBe(true)

    fireEvent.keyDown(document.body, { key: 'Escape' })

    expect(onContainerEscape).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(isPhotoLightboxOpen()).toBe(false)

    // Товар без галереи закрывается по Escape как раньше.
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onContainerEscape).toHaveBeenCalledTimes(1)
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

    const source = screen.getByAltText('Первое фото').parentElement!
    const target = screen.getByAltText('Второе фото').parentElement!
    fireEvent.dragStart(source)
    fireEvent.dragEnter(target)
    fireEvent.dragOver(target)
    fireEvent.drop(target)

    expect(onMove).toHaveBeenCalledWith(0, 1)
  })

  it('does not reorder while the photo is only dragged over another one', () => {
    const onMove = vi.fn()
    const onChange = vi.fn()
    render(
      <ProductPhotoGallery
        photos={['https://example.com/one.jpg', 'https://example.com/two.jpg']}
        altTexts={['Первое фото', 'Второе фото']}
        onMove={onMove}
        onChange={onChange}
      />,
    )

    const source = screen.getByAltText('Первое фото').parentElement!
    const target = screen.getByAltText('Второе фото').parentElement!
    fireEvent.dragStart(source)
    fireEvent.dragEnter(target)
    fireEvent.dragOver(target)

    expect(onMove).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()

    fireEvent.drop(target)
    expect(onMove).toHaveBeenCalledWith(0, 1)
  })

  it('keeps duplicate photo urls stable while reordering', () => {
    const onChange = vi.fn()
    render(
      <ProductPhotoGallery
        photos={['https://example.com/same.jpg', 'https://example.com/other.jpg', 'https://example.com/same.jpg']}
        onChange={onChange}
      />,
    )

    const tiles = screen.getAllByTitle(/Фото товара/)
    fireEvent.dragStart(tiles[0])
    fireEvent.drop(tiles[2])

    expect(onChange).toHaveBeenCalledWith([
      'https://example.com/other.jpg',
      'https://example.com/same.jpg',
      'https://example.com/same.jpg',
    ])
  })
})
