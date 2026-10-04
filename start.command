#!/bin/bash
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo '找不到 Node.js。請安裝 Node.js 22 或更新版本，再重新開啟 Terminal。'
else
  node server/index.mjs
fi
read -r -p '按 Enter 關閉此視窗…' fg_finish
