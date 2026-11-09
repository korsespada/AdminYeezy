'use strict';

// Логика уборки неиспользуемых медиа в S3 (scripts/s3-media-gc.mjs).
// Убираются только префиксы с ключами по хешу, у которых нет собственной уборки:
// `videos/` (видео и постеры) и `products/media/` (ручные загрузки и очищенные фото).
// Фото партий (`batches/`) чистит публикация партии, их здесь не трогаем.
const MANAGED_PREFIXES = ['videos/', 'products/media/'];
const STORAGE_KEY_PATTERN = /(?:videos|products\/media)\/[A-Za-z0-9._-]+/g;
const DAY_MS = 24 * 60 * 60 * 1000;

function extractStorageKeys(value) {
  return String(value || '').match(STORAGE_KEY_PATTERN) || [];
}

// Видео и постер живут парой: если нужен один из файлов, второй тоже оставляем.
function pairedVideoKeys(key) {
  const poster = /^videos\/(.+)-poster\.webp$/.exec(key);
  if (poster) return [`videos/${poster[1]}.mp4`];
  const video = /^videos\/(.+)\.mp4$/.exec(key);
  if (video) return [`videos/${video[1]}-poster.webp`];
  return [];
}

function isManagedKey(key) {
  return MANAGED_PREFIXES.some((prefix) => String(key || '').startsWith(prefix));
}

/**
 * @param {{ objects: Array<{ key: string, size?: number, lastModified?: Date | string }>,
 *           referencedKeys: Iterable<string>, now?: Date, minAgeDays?: number }} input
 */
function planMediaGc({ objects, referencedKeys, now = new Date(), minAgeDays = 30 }) {
  const keep = new Set();
  for (const key of referencedKeys) {
    keep.add(key);
    for (const pair of pairedVideoKeys(key)) keep.add(pair);
  }

  const cutoff = now.getTime() - minAgeDays * DAY_MS;
  const candidates = [];
  let referenced = 0;
  let young = 0;
  let skipped = 0;
  for (const object of objects) {
    const key = String(object.key || '');
    if (!isManagedKey(key)) {
      skipped += 1;
    } else if (keep.has(key)) {
      referenced += 1;
    } else if (!object.lastModified || new Date(object.lastModified).getTime() > cutoff) {
      // Без даты или слишком свежий: файл мог быть загружен, а ссылка ещё не сохранена.
      young += 1;
    } else {
      candidates.push({ key, size: Number(object.size || 0) });
    }
  }

  return {
    candidates,
    candidateBytes: candidates.reduce((sum, item) => sum + item.size, 0),
    referenced,
    young,
    skipped,
  };
}

module.exports = {
  MANAGED_PREFIXES,
  extractStorageKeys,
  pairedVideoKeys,
  planMediaGc,
};
