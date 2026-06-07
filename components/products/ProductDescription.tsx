'use client'

import React from 'react'
import { cn } from '@/lib/utils'

export function normalizeDescription(value: string | null | undefined) {
  return String(value || '').replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n')
}

interface ProductDescriptionProps {
  text: string | null | undefined
  className?: string
}

export default function ProductDescription({ text, className }: ProductDescriptionProps) {
  const normalized = normalizeDescription(text)
  if (!normalized) return null

  const parts = normalized.split(/(\*\*[^*]+\*\*)/g)

  return (
    <span className={cn('whitespace-pre-line', className)}>
      {parts.map((part, index) => {
        if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
          return <strong key={index}>{part.slice(2, -2)}</strong>
        }
        return <React.Fragment key={index}>{part}</React.Fragment>
      })}
    </span>
  )
}
