import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'PocketBase Admin Panel',
  description: 'Product management admin panel',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
