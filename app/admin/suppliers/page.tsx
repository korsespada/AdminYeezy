import { redirect } from 'next/navigation'

// Поставщики живут в единой ленте «Выгрузки»; ?supplier=ID открывает там его настройки.
export default async function SuppliersPage({ searchParams }: { searchParams: Promise<{ supplier?: string }> }) {
  const { supplier } = await searchParams
  const id = Number(supplier)
  redirect(Number.isInteger(id) && id > 0 ? `/admin/batches?supplier=${id}` : '/admin/batches')
}
