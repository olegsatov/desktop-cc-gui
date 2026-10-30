#!/usr/bin/env bash
# Сборка своей копии CC GUI с правкой «⌘+Enter — сразу, ⌃+Enter — вклинить».
#
# Отличия от штатной сборки приложения:
#   * подпись — своя (ad-hoc): сертификат автора приложения и его ключ
#     обновления нам недоступны, поэтому их скрипт build-signed-macos.sh
#     здесь не годится;
#   * артефакты обновления не собираются (createUpdaterArtifacts: false) —
#     иначе сборка требует приватный ключ обновления автора.
#
# Результат: src-tauri/target/release/bundle/macos/CC GUI.app
set -euo pipefail
cd "$(dirname "$0")"

exec npx tauri build --bundles app \
  --config '{"bundle":{"createUpdaterArtifacts":false,"macOS":{"signingIdentity":"-"}}}'
