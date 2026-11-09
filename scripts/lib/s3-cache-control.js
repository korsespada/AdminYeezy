'use strict';

// Cache-Control для объектов медиа-бакета.
// Ключи с хешем содержимого или источника (`products/media/`, `videos/`, `photo-clean/`,
// `site/`, зеркала поставщиков) никогда не перезаписываются другим содержимым, поэтому
// кешируются навсегда. Фото партий (`batches/`) могут быть перекодированы по тому же
// ключу при SEO-прогоне, поэтому для них срок конечный и без `immutable`.
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const BATCH_MEDIA_CACHE_CONTROL = 'public, max-age=2592000';

function cacheControlForKey(key) {
  return String(key || '').startsWith('batches/') ? BATCH_MEDIA_CACHE_CONTROL : IMMUTABLE_CACHE_CONTROL;
}

module.exports = {
  IMMUTABLE_CACHE_CONTROL,
  BATCH_MEDIA_CACHE_CONTROL,
  cacheControlForKey,
};
