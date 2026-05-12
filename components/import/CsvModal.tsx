'use client'

import React, { useEffect } from 'react'
import { createPortal } from 'react-dom'
import CsvImportApp from './CsvImportApp'

export default function CsvModal({ 
  isOpen, 
  onClose, 
  localPath, 
  supplierId, 
  batchId,
  rawPath,
  aiPath,
  supplierName,
  supplierAvatar,
  forceFileMode = false
}: { 
  isOpen: boolean, 
  onClose: () => void, 
  localPath?: string, 
  supplierId?: number | null, 
  batchId?: string | null,
  rawPath?: string,
  aiPath?: string,
  supplierName?: string | null,
  supplierAvatar?: string | null,
  forceFileMode?: boolean
}) {
  useEffect(() => {
    if (isOpen) document.body.style.overflow = 'hidden'
    else document.body.style.overflow = 'unset'
    return () => { document.body.style.overflow = 'unset' }
  }, [isOpen])

  if (!isOpen) return null

  const content = (
    <div className="fixed inset-0 z-[100] flex flex-col bg-slate-900/95 backdrop-blur-sm overflow-hidden animate-in fade-in zoom-in-95 duration-200">
      <div className="flex-1 overflow-y-auto w-full h-full">
        <CsvImportApp 
          initialLocalPath={forceFileMode ? (localPath || aiPath || rawPath) : (batchId ? "" : (localPath || aiPath || rawPath))}
          initialRawPath={rawPath}
          initialAiPath={aiPath}
          initialSupplierId={supplierId}
          initialBatchId={forceFileMode ? null : batchId}
          initialFallbackBatchId={forceFileMode ? batchId : null}
          initialSupplierName={supplierName}
          initialSupplierAvatar={supplierAvatar}
          onClose={onClose}
        />
      </div>
    </div>
  )

  if (typeof window === 'undefined') return null

  return createPortal(content, document.body)
}
