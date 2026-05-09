#!/usr/bin/env sh
# build.sh — Build (and optionally push) the undermix/sonarr-quality-inspector image.
# Usage:
#   ./build.sh              → build latest
#   ./build.sh 1.2.3        → build with version tag + latest
#   ./build.sh 1.2.3 --push → build and push to Docker Hub

set -e

IMAGE="undermix/sonarr-quality-inspector"
VERSION="${1:-}"
PUSH="${2:-}"

if [ -n "$VERSION" ]; then
  TAGS="-t ${IMAGE}:${VERSION} -t ${IMAGE}:latest"
else
  TAGS="-t ${IMAGE}:latest"
fi

echo "→ Building ${IMAGE}..."
# shellcheck disable=SC2086
docker build \
  --pull \
  --platform linux/amd64,linux/arm64 \
  $TAGS \
  .

if [ "$PUSH" = "--push" ]; then
  echo "→ Pushing to Docker Hub..."
  if [ -n "$VERSION" ]; then
    docker push "${IMAGE}:${VERSION}"
  fi
  docker push "${IMAGE}:latest"
  echo "✓ Push complete."
fi

echo "✓ Build complete: ${IMAGE}:${VERSION:-latest}"
