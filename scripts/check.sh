#!/usr/bin/env bash
set -euo pipefail

found=false
for file in src/*.js turn-api/*.mjs; do
  [[ -f "$file" ]] || continue
  found=true
  node --check "$file"
done

if [[ "$found" == false ]]; then
  echo "No JavaScript modules found." >&2
  exit 1
fi
