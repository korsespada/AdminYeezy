'use client'

import { useEffect, type RefObject } from 'react'

export function useModalDismiss(
  open: boolean,
  onClose: () => void,
  contentRef?: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!open) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return

      const target = event.target
      const nestedDialog = target instanceof Element
        ? target.closest('[role="dialog"][aria-modal="true"]')
        : null
      if (nestedDialog && contentRef?.current && nestedDialog !== contentRef.current) return

      event.preventDefault()
      onClose()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [contentRef, onClose, open])
}
