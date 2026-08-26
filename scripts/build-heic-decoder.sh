#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
image_name="dare-heic-decoder:libheif-1.23.1"
artifact_directory="$project_root/netlify/functions/vendor/heic-decoder"

docker build --platform linux/amd64 --pull \
  --tag "$image_name" \
  --file "$project_root/native/heic-decoder/Dockerfile" \
  "$project_root/native/heic-decoder"
docker run --platform linux/amd64 --rm \
  --volume "$artifact_directory:/out" \
  "$image_name"
node "$project_root/scripts/verify-heic-artifacts.mjs"
