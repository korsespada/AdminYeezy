#!/usr/bin/env bash
# Пересобирает базовый runtime-образ AdminYeezy, если плановая чистка Docker
# (ночная задача Coolify, sentinel или ручной prune) его удалила.
# Слои кэшируются в builder'е coolify-safe, поэтому пересборка занимает минуты.
set -euo pipefail

TAG="adminyeezy-runtime:python311-ffmpeg"
cd "$(dirname "$0")"

if docker image inspect "$TAG" >/dev/null 2>&1; then
  echo "$(date -Is) OK: $TAG на месте"
  exit 0
fi

echo "$(date -Is) $TAG отсутствует, пересобираю..."
docker buildx inspect coolify-safe >/dev/null
docker buildx build \
  --builder coolify-safe \
  --load \
  --file Dockerfile.runtime \
  --tag "$TAG" \
  --progress plain \
  .
echo "$(date -Is) $TAG восстановлен"
