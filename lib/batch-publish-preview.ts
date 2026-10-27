export type BatchPublishPreviewCounts = {
  total: number
  newCount: number
  updateCount: number
  skippedCount: number
  deleteCount: number
  // Опубликованные товары партии, которых больше нет в текущей версии. В режиме
  // «Обновить изменённые» они остаются в каталоге, поэтому предпросмотр обязан
  // назвать их число: иначе удаление в выгрузке выглядит как удаление с сайта.
  missingCount?: number
  videoCount: number
  replaceMissing: boolean
}

export function batchPublishPreviewMessage(input: BatchPublishPreviewCounts): string {
  const missingCount = Math.max(0, Number(input.missingCount || 0))
  const leftover = !input.replaceMissing && missingCount > 0
    ? `В каталоге останутся товары, которых нет в партии: ${missingCount}\n`
      + 'Удалить их можно только режимом «Заменить каталог текущей версией».\n'
    : ''
  return 'Предпросмотр публикации\n\n'
    + `Всего в партии: ${input.total}\n`
    + `Новых: ${input.newCount}\n`
    + `Будет обновлено: ${input.updateCount}\n`
    + `Будет пропущено: ${input.skippedCount}\n`
    + `Будет удалено из каталога: ${input.deleteCount}\n`
    + leftover
    + `Видео к переносу в S3: ${input.videoCount}\n\n`
    + 'Продолжить публикацию?'
}
