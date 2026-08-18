import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import CatalogAttributeFields from '@/components/catalog-attributes/CatalogAttributeFields'

describe('CatalogAttributeFields', () => {
  it('shows only attributes for the selected category', () => {
    render(
      <CatalogAttributeFields
        value={{}}
        onChange={() => undefined}
        categoryName="Обувь"
      />,
    )

    expect(screen.getByText('Материал верха')).toBeInTheDocument()
    expect(screen.getByText('Размеры')).toBeInTheDocument()
    expect(screen.getByText('Замеры')).toBeInTheDocument()
    expect(screen.queryByText('Механизм часов')).not.toBeInTheDocument()
    expect(screen.getByText(/Размеры рекомендуются, но не блокируют публикацию/)).toBeInTheDocument()
  })

  it('saves sizes as separate values and permits an empty field', () => {
    const onChange = vi.fn()
    render(
      <CatalogAttributeFields
        value={{}}
        onChange={onChange}
        categoryName="Одежда"
      />,
    )

    const sizes = screen.getByPlaceholderText('Например: S, M, L или 38, 39, 40')
    fireEvent.change(sizes, { target: { value: 's, m, xl' } })
    fireEvent.blur(sizes)
    expect(onChange).toHaveBeenCalledWith({ sizes: ['s', 'm', 'xl'] })

    fireEvent.change(sizes, { target: { value: '' } })
    fireEvent.blur(sizes)
    expect(onChange).toHaveBeenLastCalledWith({})
  })

  it('shows normalized values returned by Rails as editable text', () => {
    render(
      <CatalogAttributeFields
        value={{
          colors: { display_value: 'Чёрный', filter_values: ['black'] },
          materials: { names: ['Хлопок'], families: ['cotton'] },
        }}
        onChange={() => undefined}
        categoryName="Одежда"
      />,
    )

    expect(screen.getByDisplayValue('Чёрный')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Хлопок')).toBeInTheDocument()
  })

  it('edits structured clothing measurements without flattening the table', () => {
    const onChange = vi.fn()
    render(
      <CatalogAttributeFields
        value={{
          measurements: {
            unit: 'см',
            columns: [{ key: 'length', label: 'Длина' }],
            rows: [{ size: 'M', values: { length: '65,5' } }],
            note: '',
          },
        }}
        onChange={onChange}
        categoryName="Одежда"
      />,
    )

    fireEvent.change(screen.getByLabelText('Длина, размер M'), { target: { value: '66' } })

    expect(onChange).toHaveBeenCalledWith({
      measurements: {
        unit: 'см',
        columns: [{ key: 'length', label: 'Длина' }],
        rows: [{ size: 'M', values: { length: '66' } }],
        note: '',
      },
    })
  })

  it('renders an encoded measurement table as an editable table', () => {
    const onChange = vi.fn()
    render(
      <CatalogAttributeFields
        value={{
          measurements: JSON.stringify({
            unit: 'см',
            columns: [{ key: 'waist', label: 'Обхват талии' }],
            rows: [{ size: '36', values: { waist: '60' } }],
            note: '',
          }),
        }}
        onChange={onChange}
        categoryName="Одежда"
      />,
    )

    expect(screen.getByLabelText('Обхват талии, размер 36')).toBeInTheDocument()
    expect(screen.queryByText('Преобразовать в таблицу')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Обхват талии, размер 36'), { target: { value: '61' } })

    expect(onChange).toHaveBeenCalledWith({
      measurements: {
        unit: 'см',
        columns: [{ key: 'waist', label: 'Обхват талии' }],
        rows: [{ size: '36', values: { waist: '61' } }],
        note: '',
      },
    })
  })

  it('edits structured shoe measurements in the same table format', () => {
    const onChange = vi.fn()
    render(
      <CatalogAttributeFields
        value={{
          measurements: {
            unit: 'см',
            columns: [{ key: 'insole_length', label: 'Длина стельки' }],
            rows: [{ size: '40', values: { insole_length: '26' } }],
            note: '',
          },
        }}
        onChange={onChange}
        categoryName="Обувь"
      />,
    )

    fireEvent.change(screen.getByLabelText('Длина стельки, размер 40'), { target: { value: '26.5' } })

    expect(onChange).toHaveBeenCalledWith({
      measurements: {
        unit: 'см',
        columns: [{ key: 'insole_length', label: 'Длина стельки' }],
        rows: [{ size: '40', values: { insole_length: '26.5' } }],
        note: '',
      },
    })
  })
})
