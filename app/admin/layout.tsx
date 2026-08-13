import React from 'react'
import AdminHeader from '@/components/ui/AdminHeader'

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="admin-shell flex min-w-0 max-w-full flex-col overflow-y-auto bg-slate-900 text-slate-200">
      <AdminHeader />
      <div className="admin-scroll min-h-0 min-w-0 flex-1">
        {children}
      </div>
    </div>
  )
}
