import React from 'react'
import AdminHeader from '@/components/ui/AdminHeader'

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="admin-shell flex flex-col overflow-hidden bg-slate-900 text-slate-200">
      <AdminHeader />
      <div className="admin-scroll min-h-0 flex-1 overflow-y-auto">
        {children}
      </div>
    </div>
  )
}
