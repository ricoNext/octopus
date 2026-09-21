#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd "$script_dir/.." && pwd)"
key_file="$project_root/.tauri-signing-private-key"
password_file="$project_root/.tauri-signing-private-key-password"

if [[ ! -s "$key_file" ]]; then
  echo "缺少 .tauri-signing-private-key" >&2
  exit 1
fi

export TAURI_SIGNING_PRIVATE_KEY="$(cat "$key_file")"
if [[ -f "$password_file" ]]; then
  export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(cat "$password_file")"
fi

exec bun tauri "$@"
