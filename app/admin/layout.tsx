import React from 'react'
import AdminHeader from '@/components/ui/AdminHeader'

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col h-screen overflow-hidden bg-slate-900 text-slate-200">
      <AdminHeader />
      <div className="flex-1 overflow-y-auto">
        {children}
      </div>
    </div>
  )
}
