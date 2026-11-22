#!/usr/bin/env bash
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Installez Node.js depuis https://nodejs.org"; exit 1; }
[ -d node_modules ] || npm install
node server.js
