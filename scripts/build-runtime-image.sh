#!/usr/bin/env bash
set -euo pipefail

TAG="${1:-adminyeezy-runtime:python311-ffmpeg}"
BUILDER="${BUILDER:-coolify-safe}"

docker buildx inspect "$BUILDER" >/dev/null
docker buildx build \
  --builder "$BUILDER" \
  --load \
  --file Dockerfile.runtime \
  --tag "$TAG" \
  --progress plain \
  .
