import { normalizeSizeRecommendation } from '@/lib/measurement-templates'

export default function ProductSizeRecommendationPreview({ value }: { value: unknown }) {
  const recommendation = normalizeSizeRecommendation(value)
  if (!recommendation) return null

  return (
    <section
      aria-label="Предпросмотр рекомендаций размера"
      className="rounded-lg border border-indigo-500/25 bg-indigo-500/5 p-3"
    >
      <div>
        <h3 className="text-xs font-bold text-indigo-100">Рекомендации размера на сайте</h3>
        <p className="mt-0.5 text-[11px] text-slate-400">Таблица по росту и весу показывается покупателю отдельно от замеров изделия.</p>
      </div>
      <div className="mt-3 overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/60">
        <table className="min-w-full border-collapse text-xs">
          <thead className="bg-slate-900 text-slate-300">
            <tr>
              {recommendation.columns.map((column) => (
                <th key={column.key} className="whitespace-nowrap border-r border-slate-800 px-3 py-2 text-left font-semibold last:border-r-0">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {recommendation.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {recommendation.columns.map((column) => (
                  <td key={column.key} className="whitespace-nowrap border-r border-slate-800 px-3 py-2 text-slate-200 last:border-r-0">
                    {row.values[column.key] || '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {recommendation.note && <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-400">{recommendation.note}</p>}
    </section>
  )
}
