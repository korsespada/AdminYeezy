'use server'

import { revalidatePath } from 'next/cache'
import {
  createRailsChromoffReview,
  deleteRailsChromoffReview,
  listRailsChromoffReviews,
  updateRailsChromoffReview,
  type RailsChromoffReview,
  type RailsChromoffReviewInput,
} from '@/lib/rails-admin'
import { missingSiteChromoffReviews } from '@/lib/chromoff-review-seed'

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

export async function saveChromoffReviewAction(input: {
  id?: string | null
  review: RailsChromoffReviewInput
}): Promise<{ success: boolean; review?: RailsChromoffReview; message?: string }> {
  try {
    const review = input.id
      ? await updateRailsChromoffReview(input.id, input.review)
      : await createRailsChromoffReview(input.review)
    revalidatePath('/admin/chromoff/reviews')
    return { success: true, review }
  } catch (error) {
    return { success: false, message: errorMessage(error, 'Не удалось сохранить отзыв.') }
  }
}

/**
 * Переносит в Rails отзывы из статичного резерва chromoff.store, которых там ещё
 * нет. Повторный запуск ничего не дублирует: сверка по legacy_key.
 */
export async function importSiteChromoffReviewsAction(): Promise<{
  success: boolean
  reviews?: RailsChromoffReview[]
  created?: number
  message?: string
}> {
  let created = 0
  try {
    const missing = missingSiteChromoffReviews(await listRailsChromoffReviews())
    for (const review of missing) {
      await createRailsChromoffReview(review)
      created += 1
    }
    revalidatePath('/admin/chromoff/reviews')
    return { success: true, created, reviews: await listRailsChromoffReviews() }
  } catch (error) {
    const prefix = created > 0 ? `Перенесено ${created}, дальше ошибка: ` : ''
    return { success: false, created, message: prefix + errorMessage(error, 'Не удалось перенести отзывы с сайта.') }
  }
}

export async function deleteChromoffReviewAction(id: string): Promise<{ success: boolean; message?: string }> {
  if (!id) return { success: false, message: 'Не указан отзыв.' }

  try {
    await deleteRailsChromoffReview(id)
    revalidatePath('/admin/chromoff/reviews')
    return { success: true }
  } catch (error) {
    return { success: false, message: errorMessage(error, 'Не удалось удалить отзыв.') }
  }
}
