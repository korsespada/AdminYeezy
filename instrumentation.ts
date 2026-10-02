/**
 * Точка входа Next-сервера: здесь регистрируются долгоживущие фоновые сервисы.
 * Супервизоры заливки видео и прогона ИИ по карточкам не привязаны к запросам,
 * поэтому продолжают работу после перезагрузки страницы оператора и поднимаются
 * сами после рестарта контейнера.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  try {
    const { startMatchApplySupervisor } = await import('@/lib/video-match-apply')
    startMatchApplySupervisor()
  } catch (error) {
    console.error('Не удалось запустить супервизор заливки видео', error)
  }
  try {
    const { startCardAiSupervisor } = await import('@/lib/product-card-ai-run')
    startCardAiSupervisor()
  } catch (error) {
    console.error('Не удалось запустить супервизор ИИ по карточкам', error)
  }
}
