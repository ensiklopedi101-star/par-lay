#!/usr/bin/env bash
set -u

api_pid=""
web_pid=""

stop_children() {
  trap - EXIT INT TERM
  if [[ -n "$web_pid" ]]; then
    kill "$web_pid" 2>/dev/null || true
  fi
  if [[ -n "$api_pid" ]]; then
    kill "$api_pid" 2>/dev/null || true
  fi
  wait 2>/dev/null || true
}

trap stop_children EXIT INT TERM

PORT=8080 pnpm --filter @workspace/api-server run dev &
api_pid=$!

PORT=5000 BASE_PATH=/ pnpm --filter @workspace/parlay-app run dev &
web_pid=$!

wait -n "$api_pid" "$web_pid"
exit $?
