#!/usr/bin/env bash
# Пересобирает базовый runtime-образ AdminYeezy, если плановая чистка Docker
# (ночная задача Coolify, sentinel или ручной prune) его удалила.
# Слои кэшируются в builder'е coolify-safe, поэтому пересборка занимает минуты.
set -euo pipefail

TAG="adminyeezy-runtime:python311-ffmpeg"
KEEPALIVE_CONTAINER="adminyeezy-runtime-keepalive"
cd "$(dirname "$0")"

if ! docker image inspect "$TAG" >/dev/null 2>&1; then
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
else
  echo "$(date -Is) OK: $TAG на месте"
fi

image_id="$(docker image inspect "$TAG" --format '{{.Id}}')"
if docker container inspect "$KEEPALIVE_CONTAINER" >/dev/null 2>&1; then
  container_image_id="$(docker container inspect "$KEEPALIVE_CONTAINER" --format '{{.Image}}')"
  if [ "$container_image_id" != "$image_id" ]; then
    docker rm --force "$KEEPALIVE_CONTAINER" >/dev/null
  elif [ "$(docker container inspect "$KEEPALIVE_CONTAINER" --format '{{.State.Running}}')" != "true" ]; then
    docker start "$KEEPALIVE_CONTAINER" >/dev/null
  fi
fi

if ! docker container inspect "$KEEPALIVE_CONTAINER" >/dev/null 2>&1; then
  docker run --detach \
    --name "$KEEPALIVE_CONTAINER" \
    --restart unless-stopped \
    --network none \
    --read-only \
    --cap-drop ALL \
    --pull never \
    "$TAG" \
    sleep infinity >/dev/null
fi

echo "$(date -Is) OK: $KEEPALIVE_CONTAINER удерживает $TAG от Docker cleanup"
