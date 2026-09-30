/**
 * Точка входа Next-сервера: здесь регистрируются долгоживущие фоновые сервисы.
 * Супервизор заливки видео не привязан к запросам, поэтому продолжает работу
 * после перезагрузки страницы оператора и поднимается сам после рестарта контейнера.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  try {
    const { startMatchApplySupervisor } = await import('@/lib/video-match-apply')
    startMatchApplySupervisor()
  } catch (error) {
    console.error('Не удалось запустить супервизор заливки видео', error)
  }
}
