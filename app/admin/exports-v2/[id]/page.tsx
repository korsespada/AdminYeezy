import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getExportsV2RunAction } from '@/actions/exports-v2'
import V2RunWorkspace from '@/components/exports-v2/V2RunWorkspace'
import ImportTabs from '@/components/ui/ImportTabs'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

export const dynamic = 'force-dynamic'

export default async function ExportsV2RunPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ page?: string; search?: string; assignment?: 'all' | 'assigned' | 'unassigned' }>
}) {
  const { id } = await params
  const query = await searchParams
  const result = await getExportsV2RunAction(id, {
    page: Number(query.page || 1),
    search: query.search || '',
    assignment: query.assignment || 'all',
  })

  return (
    <div className="p-8">
      <div className="mx-auto max-w-[1600px] space-y-6">
        <ImportTabs />
        <Link href="/admin/exports-v2" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-400 hover:text-white">
          <ArrowLeft className="h-4 w-4" /> Ко всем тестам V2
        </Link>
        {!result.success ? (
          <Alert className="border-red-500/30 bg-red-950/30 text-red-100">
            <AlertTitle>Не удалось открыть запуск</AlertTitle>
            <AlertDescription>{result.error}</AlertDescription>
          </Alert>
        ) : (
          <V2RunWorkspace
            initialData={result.data}
            initialSearch={query.search || ''}
            initialAssignment={query.assignment || 'all'}
          />
        )}
      </div>
    </div>
  )
}
