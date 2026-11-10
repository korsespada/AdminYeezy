import { revalidatePath } from 'next/cache'

/**
 * revalidatePath для кода, который может выполняться вне запроса: колбэк
 * завершения парсера и авто-постобработка запускаются после ответа сервера,
 * и Next бросает «used revalidatePath during render». Данные к этому моменту
 * уже сохранены, а страницы админки динамические, поэтому сбой ревалидации
 * не должен превращать успешную операцию в ошибку.
 */
export function revalidatePathsSafely(...paths: string[]) {
  for (const path of paths) {
    try {
      revalidatePath(path)
    } catch (error: any) {
      console.warn(`[revalidate] skipped ${path}: ${String(error?.message || error).split('\n')[0]}`)
    }
  }
}
