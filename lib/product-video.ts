const PRODUCT_VIDEO_ATTRIBUTE_KEYS = [
  'manual_video_url',
  'manual_video_poster_url',
  'hosted_video_url',
  'hosted_video_poster_url',
  'szwego_video_url',
  'szwego_video_poster_url',
  'video_url',
  'video_poster_url',
  'video_transfer_error',
] as const

/**
 * Убирает все локальные источники видео, чтобы публикация отправила null и
 * Rails очистил video_url вместо повторного использования старого файла.
 */
export function withoutProductVideoAttributes(attributes: Record<string, any>) {
  const next = { ...attributes }
  for (const key of PRODUCT_VIDEO_ATTRIBUTE_KEYS) delete next[key]
  return next
}
