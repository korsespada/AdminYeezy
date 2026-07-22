export type ExportsV2CampaignItem = { supplierId: number; endDate?: string }

export function normalizeExportsV2CampaignItems(items: ExportsV2CampaignItem[]) {
  const unique = new Map<number, { supplierId: number; endDate: string }>()
  for (const item of items || []) {
    const supplierId = Number(item?.supplierId)
    if (!Number.isInteger(supplierId) || supplierId <= 0) continue
    const rawDate = String(item?.endDate || '').trim()
    const endDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : ''
    unique.set(supplierId, { supplierId, endDate })
  }
  return [...unique.values()]
}

export function exportsV2CampaignTotals(runs: Array<{
  album_count?: number
  draft_count?: number
  pushed_count?: number
}>) {
  return runs.reduce((total, run) => ({
    albums: total.albums + Number(run.album_count || 0),
    products: total.products + Number(run.draft_count || 0),
    pushed: total.pushed + Number(run.pushed_count || 0),
  }), { albums: 0, products: 0, pushed: 0 })
}
