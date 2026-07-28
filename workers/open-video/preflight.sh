#!/bin/sh
set -eu

: "${OPEN_VIDEO_WORKER_URL:?OPEN_VIDEO_WORKER_URL 未配置}"
: "${OPEN_VIDEO_WORKER_TOKEN:?OPEN_VIDEO_WORKER_TOKEN 未配置}"

curl --fail --silent --show-error \
  -H "Authorization: Bearer ${OPEN_VIDEO_WORKER_TOKEN}" \
  "${OPEN_VIDEO_WORKER_URL%/}/health"
printf '\n'
