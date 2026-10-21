'use server'

import { revalidatePath } from 'next/cache'
import {
  createRailsChromoffReview,
  deleteRailsChromoffReview,
  updateRailsChromoffReview,
  type RailsChromoffReview,
  type RailsChromoffReviewInput,
} from '@/lib/rails-admin'

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
