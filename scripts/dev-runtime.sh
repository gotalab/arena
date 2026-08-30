#!/bin/sh
set -eu

scratch=$(mktemp -d "${TMPDIR:-/tmp}/arena-runtime.XXXXXX")
cleanup() {
  rm -rf -- "$scratch"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

ARENA_RUNTIME_SCRATCH="$scratch" node scripts/dev-runtime.mjs "$@"
