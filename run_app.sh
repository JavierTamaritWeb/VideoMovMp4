#!/usr/bin/env bash
set -euo pipefail

# ─── Verificar dependencias ──────────────────────────────────────────────────
command -v node  >/dev/null 2>&1 || { echo "Error: node no encontrado. Instala Node.js 18+"; exit 1; }
command -v npm   >/dev/null 2>&1 || { echo "Error: npm no encontrado"; exit 1; }
command -v ffmpeg >/dev/null 2>&1 || { echo "Error: ffmpeg no encontrado. Instala con: brew install ffmpeg"; exit 1; }

# ─── Directorio del script ───────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ─── Instalar dependencias si no existen ─────────────────────────────────────
[ -d node_modules ] || npm install

# ─── Buscar puerto libre ─────────────────────────────────────────────────────
is_port_in_use() { lsof -i :"$1" >/dev/null 2>&1; }

PORT_TO_USE=5173
while is_port_in_use "$PORT_TO_USE"; do
  PORT_TO_USE=$((PORT_TO_USE + 1))
done

echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║  VideoMovMp4 v1.2.2                   ║"
echo "  ║  http://localhost:$PORT_TO_USE              ║"
echo "  ╚══════════════════════════════════════╝"
echo ""

exec env PORT="$PORT_TO_USE" node server.mjs
