import { notFound } from 'next/navigation'
import { getExportHistoryAction } from '@/actions/suppliers'
import CsvImportApp from '@/components/import/CsvImportApp'

export const dynamic = 'force-dynamic'

export default async function BatchProductsPage({
  params,
  searchParams,
}: {
  params: Promise<{ batchId: string }>
  searchParams: Promise<{ snapshot?: string | string[] }>
}) {
  const [{ batchId }, query] = await Promise.all([params, searchParams])
  const result = await getExportHistoryAction()
  if (!result.success) throw new Error(result.error || 'Не удалось открыть выгрузку')

  const batch = result.data.find((item: any) => !item.isSynthetic && item.id === batchId)
  if (!batch) notFound()

  const requestedSnapshot = Array.isArray(query.snapshot) ? query.snapshot[0] : query.snapshot
  const file = requestedSnapshot
    ? batch.files.find((item: any) => item.snapshot_id === requestedSnapshot)
    : batch.files.find((item: any) => item.is_current) || batch.files.at(-1)
  if (requestedSnapshot && !file) notFound()

  return (
    <CsvImportApp
      initialBatchId={batch.id}
      initialSnapshotId={requestedSnapshot || null}
      initialSupplierId={batch.supplier_id}
      initialSupplierName={batch.supplier_name}
      initialSupplierAvatar={batch.supplier_avatar}
      initialSourceLabel={file?.snapshot_label || file?.label || file?.status || null}
      backHref="/admin/batches"
    />
  )
}
