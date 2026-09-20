'use server'

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { scrapingQuery } from '@/lib/db'
import { buildBatchAiContactSheets, runBatchAiOpenRouter, type AiCompletionSettings } from '@/lib/batch-ai'
import { getBatchAiSettingsAction } from '@/actions/batch-ai'
import {
  RING_MATCH_CONFIDENT,
  RING_MATCH_SYSTEM_PROMPT,
  buildRingMatchPrompt,
  buildRingMergePatch,
  parseRingMatchVerdict,
  rankRingCandidates,
  type RingAnchor,
  type RingCandidate,
} from '@/lib/david-ring-match'
import { invalidateRingMatchCatalog, loadRingMatchCatalog, ringMatchPhotoHosts } from '@/lib/david-ring-match-data'
import {
  createRailsSeoRedirect,
  deleteRailsChromoffListing,
  deleteRailsProduct,
  railsFetch,
} from '@/lib/rails-admin'

/**
 * Развязка дублей колец: старое кольцо Chromoff — канон, карточка David на ту же
 * модель — дубль.
 *
 * Что делает применение пары:
 *   1. переносит в старую карточку название, описание, характеристики и фото David;
 *   2. ставит 301 со slug'а дубля на старый URL — чтобы проиндексированный адрес
 *      не начал отдавать 404;
 *   3. удаляет Chromoff-листинг и товар дубля;
 *   4. помечает черновик David объединённым, чтобы его не создали заново.
 *
 * Ничего не удаляется автоматически: решение принимает оператор на экране ревью.
 */

const PAGE_PATH = '/admin/chromoff/david-rings'
const ANCHOR_TILES = 9
const CANDIDATE_TILES = 3
const SHORTLIST_LIMIT = 6
const MAX_BATCH = 10

export type RingMatchStatus =
  | 'suggested'
  | 'no_match'
  | 'no_candidates'
  | 'invalid_index'
  | 'error'
  | 'applied'
  | 'rejected'

export interface RingShortlistEntry {
  handle: string
  title: string
  score: number
  shared: string[]
  created: boolean
  photoSource: string
}

export interface RingMatchRow {
  matchId: string | null
  status: RingMatchStatus | 'new'
  confidence: number | null
  evidence: string
  error: string
  shortlist: RingShortlistEntry[]
  updatedAt: string | null
  davidHandle: string
  davidTitle: string
  davidProductId: string | null
  davidListingId: string | null
  davidSlug: string | null
  davidPhotos: string[]
  davidCreated: boolean
  applied: Record<string, unknown> | null
  anchor: {
    listingId: string
    productId: string
    slug: string
    name: string
    priceCents: number
    photos: string[]
    modelName: string
  }
}

export interface RingMatchOverview {
  stats: {
    anchors: number
    candidates: number
    processed: number
    suggested: number
    confident: number
    noMatch: number
    noCandidates: number
    invalidIndex: number
    errors: number
    applied: number
    rejected: number
  }
  rows: RingMatchRow[]
}

function photoPreview(urls: string[], limit = 3) {
  return urls.slice(0, limit)
}

function mapMatchRow(anchor: RingAnchor, match: any | null, candidatesByHandle: Map<string, RingCandidate>): RingMatchRow {
  const candidate = match?.david_handle ? candidatesByHandle.get(String(match.david_handle)) : undefined
  const shortlist: RingShortlistEntry[] = (Array.isArray(match?.shortlist) ? match.shortlist : []).map((entry: any) => ({
    handle: String(entry?.handle || ''),
    title: String(entry?.title || ''),
    score: Number(entry?.score || 0),
    shared: Array.isArray(entry?.shared) ? entry.shared.map(String) : [],
    created: entry?.created === true,
    photoSource: String(entry?.photoSource || ''),
  }))
  return {
    matchId: match?.id ? String(match.id) : null,
    status: (match?.status as RingMatchStatus) || 'new',
    confidence: match?.confidence === null || match?.confidence === undefined ? null : Number(match.confidence),
    evidence: String(match?.evidence || ''),
    error: String(match?.error || ''),
    shortlist,
    updatedAt: match?.updated_at ? new Date(match.updated_at).toISOString() : null,
    davidHandle: String(match?.david_handle || ''),
    davidTitle: String(match?.david_title || candidate?.title || ''),
    davidProductId: match?.david_product_id ? String(match.david_product_id) : (candidate?.productId || null),
    davidListingId: match?.david_listing_id ? String(match.david_listing_id) : (candidate?.listingId || null),
    davidSlug: match?.david_slug ? String(match.david_slug) : (candidate?.slug || null),
    davidPhotos: photoPreview(candidate?.photos || []),
    davidCreated: Boolean(candidate?.created),
    applied: match?.applied && typeof match.applied === 'object' ? match.applied : null,
    anchor: {
      listingId: anchor.listingId,
      productId: anchor.productId,
      slug: anchor.slug,
      name: anchor.name,
      priceCents: anchor.priceCents,
      photos: photoPreview(anchor.photos),
      modelName: anchor.modelName,
    },
  }
}

export async function getRingMatchOverviewAction(): Promise<
  { success: true; data: RingMatchOverview } | { success: false; error: string }
> {
  try {
    const catalog = await loadRingMatchCatalog()
    const matches = await scrapingQuery('SELECT * FROM david_ring_matches')
    const byAnchor = new Map(matches.rows.map((row: any) => [String(row.anchor_listing_id), row]))
    const candidatesByHandle = new Map(catalog.candidates.map((candidate) => [candidate.handle, candidate]))

    const rows = catalog.anchors.map((anchor) => mapMatchRow(anchor, byAnchor.get(anchor.listingId) || null, candidatesByHandle))
    const count = (status: string) => rows.filter((row) => row.status === status).length
    const confident = rows.filter((row) => row.status === 'suggested' && (row.confidence || 0) >= RING_MATCH_CONFIDENT).length

    return {
      success: true,
      data: {
        stats: {
          anchors: catalog.anchors.length,
          candidates: catalog.candidates.length,
          processed: rows.filter((row) => row.status !== 'new').length,
          suggested: count('suggested'),
          confident,
          noMatch: count('no_match'),
          noCandidates: count('no_candidates'),
          invalidIndex: count('invalid_index'),
          errors: count('error'),
          applied: count('applied'),
          rejected: count('rejected'),
        },
        rows,
      },
    }
  } catch (error: any) {
    return { success: false, error: String(error?.message || error || 'Не удалось прочитать сопоставления') }
  }
}

interface MatchJobResult {
  anchor: string
  status: RingMatchStatus
  davidTitle?: string
  confidence?: number
  evidence?: string
  error?: string
}

export async function runRingMatchBatchAction(input: { limit?: number; anchorListingIds?: string[] } = {}): Promise<
  | { success: true; data: { processed: number; remaining: number; provider: string; model: string; results: MatchJobResult[] } }
  | { success: false; error: string }
> {
  const limit = Math.min(MAX_BATCH, Math.max(1, Number(input.limit || 3)))

  try {
    const settingsResult = await getBatchAiSettingsAction()
    if (!settingsResult.success || !settingsResult.data) {
      return { success: false, error: 'Не удалось прочитать настройки ИИ в «Выгрузках»' }
    }
    const settings = settingsResult.data as any
    const provider = String(settings.provider || '')
    if (provider === 'cockpit') {
      return {
        success: false,
        error: 'Выбран провайдер Cockpit: он работает только через локальный воркер. Выберите BYESU в «Выгрузках» → «Настройки ИИ».',
      }
    }
    const model = provider === 'byesu' ? String(settings.byesuModel || '') : String(settings.openrouterModel || '')
    const completionSettings = settings as AiCompletionSettings

    const catalog = await loadRingMatchCatalog()
    const existing = await scrapingQuery('SELECT anchor_listing_id, status FROM david_ring_matches')
    const byAnchor = new Map(existing.rows.map((row: any) => [String(row.anchor_listing_id), String(row.status)]))
    const requested = input.anchorListingIds?.length ? new Set(input.anchorListingIds.map(String)) : null

    // Повторно считаем только то, что не дало результата: «нет совпадения» и
    // отклонённое оператором — это уже решения, их не перетираем.
    const queue = catalog.anchors.filter((anchor) => {
      if (requested && !requested.has(anchor.listingId)) return false
      const status = byAnchor.get(anchor.listingId)
      return !status || status === 'error' || status === 'invalid_index'
    })

    const batch = queue.slice(0, limit)
    const results: MatchJobResult[] = []

    for (const anchor of batch) {
      results.push(await matchSingleAnchor({ anchor, candidates: catalog.candidates, settings: completionSettings, provider, model }))
    }

    revalidatePath(PAGE_PATH)
    return {
      success: true,
      data: {
        processed: results.length,
        remaining: Math.max(0, queue.length - results.length),
        provider,
        model,
        results,
      },
    }
  } catch (error: any) {
    return { success: false, error: String(error?.message || error || 'Не удалось выполнить подбор') }
  }
}

async function matchSingleAnchor(input: {
  anchor: RingAnchor
  candidates: RingCandidate[]
  settings: AiCompletionSettings
  provider: string
  model: string
}): Promise<MatchJobResult> {
  const { anchor } = input
  try {
    const ranked = rankRingCandidates(anchor, input.candidates, { limit: SHORTLIST_LIMIT })
    if (!ranked.length) {
      await saveMatch({
        anchor,
        status: 'no_candidates',
        shortlist: [],
        provider: input.provider,
        model: input.model,
      })
      return { anchor: anchor.name, status: 'no_candidates', evidence: 'Нет кандидатов по названию и модели' }
    }

    const anchorPhotos = anchor.photos.slice(0, ANCHOR_TILES)
    const contactSheets = await buildBatchAiContactSheets(anchorPhotos)
    const candidatePhotos = ranked.flatMap((row) => row.candidate.photos.slice(0, CANDIDATE_TILES))
    const referenceSheets = await buildBatchAiContactSheets(candidatePhotos, {
      additionalHosts: ringMatchPhotoHosts(ranked.map((row) => row.candidate)),
    })

    const raw = await runBatchAiOpenRouter({
      settings: input.settings,
      systemPrompt: RING_MATCH_SYSTEM_PROMPT,
      userPrompt: buildRingMatchPrompt({
        anchor,
        ranked,
        anchorTileCount: anchorPhotos.length,
        tilesPerCandidate: CANDIDATE_TILES,
      }),
      contactSheets,
      referenceSheets,
      referenceSheetsLabel: 'Эталоны моделей David Studio',
    })

    const verdict = parseRingMatchVerdict(raw, ranked.map((row) => row.candidate))
    const shortlist = ranked.map((row) => ({
      handle: row.candidate.handle,
      title: row.candidate.title,
      score: row.score,
      shared: row.shared,
      created: row.candidate.created,
      photoSource: row.candidate.photoSource,
    }))

    if (verdict.invalidIndex) {
      await saveMatch({
        anchor,
        status: 'invalid_index',
        shortlist,
        provider: input.provider,
        model: input.model,
        evidence: verdict.evidence,
        error: 'ИИ вернула индекс вне списка кандидатов',
      })
      return { anchor: anchor.name, status: 'invalid_index', error: 'ИИ вернула индекс вне списка кандидатов' }
    }

    const matched = verdict.handle ? ranked.find((row) => row.candidate.handle === verdict.handle) : undefined
    await saveMatch({
      anchor,
      status: matched ? 'suggested' : 'no_match',
      shortlist,
      provider: input.provider,
      model: input.model,
      confidence: verdict.confidence,
      evidence: verdict.evidence,
      candidate: matched?.candidate || null,
      candidateScore: matched?.score ?? null,
    })

    return {
      anchor: anchor.name,
      status: matched ? 'suggested' : 'no_match',
      davidTitle: matched?.candidate.title,
      confidence: verdict.confidence,
      evidence: verdict.evidence,
    }
  } catch (error: any) {
    const message = String(error?.message || error || 'Модель недоступна')
    await saveMatch({
      anchor,
      status: 'error',
      shortlist: [],
      provider: input.provider,
      model: input.model,
      error: message,
    }).catch(() => {})
    return { anchor: anchor.name, status: 'error', error: message }
  }
}

async function saveMatch(input: {
  anchor: RingAnchor
  status: RingMatchStatus
  shortlist: unknown[]
  provider: string
  model: string
  confidence?: number
  evidence?: string
  candidate?: RingCandidate | null
  candidateScore?: number | null
  error?: string
}) {
  const { anchor, candidate } = input
  await scrapingQuery(
    `INSERT INTO david_ring_matches (
        id, anchor_listing_id, anchor_product_id, anchor_slug, anchor_name,
        david_handle, david_product_id, david_listing_id, david_slug, david_title,
        confidence, candidate_score, evidence, status, shortlist, provider, model, error, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17,$18,NOW())
     ON CONFLICT (anchor_listing_id) DO UPDATE SET
        anchor_product_id=EXCLUDED.anchor_product_id,
        anchor_slug=EXCLUDED.anchor_slug,
        anchor_name=EXCLUDED.anchor_name,
        david_handle=EXCLUDED.david_handle,
        david_product_id=EXCLUDED.david_product_id,
        david_listing_id=EXCLUDED.david_listing_id,
        david_slug=EXCLUDED.david_slug,
        david_title=EXCLUDED.david_title,
        confidence=EXCLUDED.confidence,
        candidate_score=EXCLUDED.candidate_score,
        evidence=EXCLUDED.evidence,
        status=EXCLUDED.status,
        shortlist=EXCLUDED.shortlist,
        provider=EXCLUDED.provider,
        model=EXCLUDED.model,
        error=EXCLUDED.error,
        updated_at=NOW()`,
    [
      randomUUID(),
      anchor.listingId,
      anchor.productId,
      anchor.slug,
      anchor.name,
      candidate?.handle || null,
      candidate?.productId || null,
      candidate?.listingId || null,
      candidate?.slug || null,
      candidate?.title || null,
      input.confidence ?? null,
      input.candidateScore ?? null,
      input.evidence || null,
      input.status,
      JSON.stringify(input.shortlist || []),
      input.provider,
      input.model,
      input.error || null,
    ],
  )
}

export async function rejectRingMatchAction(matchId: string): Promise<{ success: boolean; message: string }> {
  const id = String(matchId || '').trim()
  if (!id) return { success: false, message: 'Не указано сопоставление' }
  try {
    await scrapingQuery(`UPDATE david_ring_matches SET status='rejected', updated_at=NOW() WHERE id=$1`, [id])
    revalidatePath(PAGE_PATH)
    return { success: true, message: 'Пара отклонена: карточки остаются как есть' }
  } catch (error: any) {
    return { success: false, message: String(error?.message || error || 'Не удалось отклонить пару') }
  }
}

export async function resetRingMatchAction(matchId: string): Promise<{ success: boolean; message: string }> {
  const id = String(matchId || '').trim()
  if (!id) return { success: false, message: 'Не указано сопоставление' }
  try {
    await scrapingQuery(`DELETE FROM david_ring_matches WHERE id=$1`, [id])
    revalidatePath(PAGE_PATH)
    return { success: true, message: 'Вердикт удалён: пара будет посчитана заново' }
  } catch (error: any) {
    return { success: false, message: String(error?.message || error || 'Не удалось сбросить вердикт') }
  }
}

export interface ApplyRingMatchResult {
  matchId: string
  anchorSlug: string
  davidSlug: string | null
  copied: { name: boolean; description: boolean; h1: boolean; seoDescription: boolean; attributes: string[]; photos: number }
  indexingStatus: string | null
  redirectCreated: boolean
  redirectError: string | null
  listingDeleted: boolean
  productDeleted: boolean
  productDeleteError: string | null
  message: string
}

/**
 * Применение пары: контент David переезжает в старую карточку, дубль убирается с
 * витрины вместе с 301.
 *
 * Цена старой карточки не трогается: у David она нулевая («цена по запросу»), а
 * смысл всей операции — сохранить живую карточку с ценой и историей.
 */
export async function applyRingMatchAction(matchId: string): Promise<
  { success: true; data: ApplyRingMatchResult } | { success: false; error: string }
> {
  const id = String(matchId || '').trim()
  if (!id) return { success: false, error: 'Не указано сопоставление' }

  const rows = await scrapingQuery('SELECT * FROM david_ring_matches WHERE id=$1', [id])
  const match: any = rows.rows[0]
  if (!match) return { success: false, error: 'Сопоставление не найдено' }
  if (!match.david_handle) return { success: false, error: 'В паре нет модели David: применять нечего' }
  if (String(match.status) === 'applied') return { success: false, error: 'Пара уже применена' }

  const anchorProductId = String(match.anchor_product_id || '')
  const anchorSlug = String(match.anchor_slug || '')
  if (!anchorProductId || !anchorSlug) return { success: false, error: 'В паре нет старого товара или его slug' }

  try {
    const [anchorResponse, davidResponse] = await Promise.all([
      railsFetch<{ product: any }>(`/admin/products/${encodeURIComponent(anchorProductId)}`),
      match.david_product_id
        ? railsFetch<{ product: any }>(`/admin/products/${encodeURIComponent(String(match.david_product_id))}`)
        : Promise.resolve({ product: null }),
    ])
    const anchorProduct: any = anchorResponse.product
    const davidProduct: any = davidResponse?.product
    if (!anchorProduct?.id) return { success: false, error: 'Старый товар не найден в Rails' }
    if (!davidProduct?.id) {
      return {
        success: false,
        error: 'Карточка David ещё не создана в Chromoff: сначала импортируйте её, иначе переносить нечего',
      }
    }

    const davidMedia = Array.isArray(davidProduct.media) ? davidProduct.media : []
    const { patch: productPatch, copied } = buildRingMergePatch(anchorProduct, davidProduct)

    await railsFetch(`/admin/products/${encodeURIComponent(anchorProductId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ product: productPatch }),
    })

    const davidSlug = match.david_slug ? String(match.david_slug) : null
    let redirectCreated = false
    let redirectError: string | null = null
    if (davidSlug && davidSlug !== anchorSlug) {
      try {
        await createRailsSeoRedirect({
          sourcePath: `/product/${davidSlug}`,
          targetPath: `/product/${anchorSlug}`,
          statusCode: 301,
          reason: 'david_ring_duplicate_merged',
        })
        redirectCreated = true
      } catch (error: any) {
        redirectError = String(error?.message || error || 'Не удалось создать 301')
      }
    }

    let listingDeleted = false
    let productDeleted = false
    let productDeleteError: string | null = null
    if (match.david_listing_id) {
      await deleteRailsChromoffListing(String(match.david_listing_id))
      listingDeleted = true
    }
    if (match.david_product_id) {
      try {
        await deleteRailsProduct(String(match.david_product_id))
        productDeleted = true
      } catch (firstError: any) {
        try {
          await deleteRailsProduct(String(match.david_product_id), { force: true })
          productDeleted = true
        } catch (secondError: any) {
          productDeleteError = String(secondError?.message || firstError?.message || 'Не удалось удалить товар дубля')
        }
      }
    }

    const applied: ApplyRingMatchResult = {
      matchId: id,
      anchorSlug,
      davidSlug,
      copied,
      indexingStatus: productPatch.indexing_status ? 'indexable' : null,
      redirectCreated,
      redirectError,
      listingDeleted,
      productDeleted,
      productDeleteError,
      message: [
        'контент David перенесён в старую карточку',
        davidMedia.length ? `фото +${davidMedia.length}` : 'фото не переносились',
        redirectCreated ? '301 со slug дубля поставлен' : redirectError ? `301 не поставлен: ${redirectError}` : '301 не требовался',
        listingDeleted ? 'листинг дубля удалён' : 'листинг дубля не найден',
        productDeleted ? 'товар дубля удалён' : productDeleteError ? `товар дубля остался: ${productDeleteError}` : 'товар дубля не найден',
      ].join('; '),
    }

    await scrapingQuery(`UPDATE david_ring_matches SET status='applied', applied=$2::jsonb, error=NULL, updated_at=NOW() WHERE id=$1`, [
      id,
      JSON.stringify(applied),
    ])

    // Чертёж David помечаем объединённым: товара больше нет, но и «необработанным»
    // он быть не должен, иначе оператор создаст дубль заново.
    await scrapingQuery(
      `UPDATE david_import_drafts
          SET status='merged',
              merged_into_listing_id=$2,
              merged_into_product_id=$3,
              merged_at=NOW(),
              rails_product_id=NULL,
              chromoff_listing_id=NULL,
              updated_at=NOW()
        WHERE handle=$1`,
      [String(match.david_handle).replace(/^david-studio-/, ''), String(match.anchor_listing_id || ''), anchorProductId],
    ).catch(() => {})

    invalidateRingMatchCatalog()
    revalidatePath(PAGE_PATH)
    revalidatePath('/admin/chromoff/david-studio')

    return { success: true, data: applied }
  } catch (error: any) {
    const message = String(error?.message || error || 'Не удалось применить пару')
    await scrapingQuery(`UPDATE david_ring_matches SET error=$2, updated_at=NOW() WHERE id=$1`, [id, message]).catch(() => {})
    return { success: false, error: message }
  }
}

/** Модель David по handle — для ручной правки пары на экране ревью. */
export async function listDavidRingCandidatesAction(): Promise<
  { success: true; data: Array<{ handle: string; title: string; created: boolean; photos: number }> } | { success: false; error: string }
> {
  try {
    const catalog = await loadRingMatchCatalog()
    return {
      success: true,
      data: catalog.candidates.map((candidate) => ({
        handle: candidate.handle,
        title: candidate.title,
        created: candidate.created,
        photos: candidate.photos.length,
      })),
    }
  } catch (error: any) {
    return { success: false, error: String(error?.message || error || 'Не удалось прочитать выгрузку David') }
  }
}

/** Ручная замена модели в паре: ИИ ошиблась, оператор выбирает кандидата сам. */
export async function setRingMatchCandidateAction(
  matchId: string,
  handle: string,
): Promise<{ success: boolean; message: string }> {
  const id = String(matchId || '').trim()
  const wanted = String(handle || '').trim()
  if (!id || !wanted) return { success: false, message: 'Не указана пара или модель' }
  try {
    const catalog = await loadRingMatchCatalog()
    const candidate = catalog.candidates.find((item) => item.handle === wanted)
    if (!candidate) return { success: false, message: 'Модель не найдена в выгрузке David' }
    await scrapingQuery(
      `UPDATE david_ring_matches
          SET david_handle=$2, david_product_id=$3, david_listing_id=$4, david_slug=$5, david_title=$6,
              status='suggested', confidence=1, evidence='выбрано оператором', error=NULL, updated_at=NOW()
        WHERE id=$1`,
      [
        id,
        candidate.handle,
        candidate.productId,
        candidate.listingId,
        candidate.slug,
        candidate.title,
      ],
    )
    revalidatePath(PAGE_PATH)
    return { success: true, message: `Пара переведена на модель ${candidate.title}` }
  } catch (error: any) {
    return { success: false, message: String(error?.message || error || 'Не удалось заменить модель') }
  }
}

/** Служебная проверка: подтягивается ли выгрузка David и категория колец. */
export async function checkRingMatchSourcesAction(): Promise<{
  success: boolean
  message: string
}> {
  try {
    const catalog = await loadRingMatchCatalog({ force: true })
    const withPhotos = catalog.candidates.filter((candidate) => candidate.photos.length).length
    return {
      success: true,
      message: `Категория «${catalog.categoryName}»: старых колец ${catalog.anchors.length}, моделей David ${catalog.candidates.length} (с фото ${withPhotos})`,
    }
  } catch (error: any) {
    return { success: false, message: String(error?.message || error || 'Источники недоступны') }
  }
}
