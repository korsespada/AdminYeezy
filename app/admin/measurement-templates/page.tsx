import MeasurementTemplateLibrary from '@/components/import/MeasurementTemplateLibrary'
import ImportTabs from '@/components/ui/ImportTabs'

export const dynamic = 'force-dynamic'

export default function MeasurementTemplatesPage() {
  return (
    <div className="p-8">
      <div className="mx-auto max-w-7xl space-y-8">
        <div><h1 className="text-3xl font-bold tracking-tight text-white">Шаблоны замеров</h1><p className="mt-2 text-slate-400">Один раз сохраните таблицу со скриншота и назначайте её нужным товарам вручную.</p></div>
        <ImportTabs />
        <MeasurementTemplateLibrary />
      </div>
    </div>
  )
}
