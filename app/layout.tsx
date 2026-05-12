import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Админка YeezyUnique',
  description: 'Админка YeezyUnique',
  robots: {
    index: false,
    follow: false,
    googleBot: {
      index: false,
      follow: false,
    },
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  )
}
