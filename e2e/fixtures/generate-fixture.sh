#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

command -v ffmpeg >/dev/null 2>&1 || { echo "Error: ffmpeg no encontrado"; exit 1; }

echo "Generando fixtures de vídeo..."

# Fixture 1: MOV pequeño (2s, 320x240)
ffmpeg -y -f lavfi -i testsrc=duration=2:size=320x240:rate=24 \
  -f lavfi -i sine=frequency=440:duration=2 \
  -c:v prores -c:a pcm_s16le \
  "$SCRIPT_DIR/test-small.mov" 2>/dev/null

# Fixture 2: MOV 720p (3s)
ffmpeg -y -f lavfi -i testsrc=duration=3:size=1280x720:rate=30 \
  -f lavfi -i sine=frequency=440:duration=3 \
  -c:v prores -c:a pcm_s16le \
  "$SCRIPT_DIR/test-720p.mov" 2>/dev/null

# Fixture 3: MOV 1080p (3s)
ffmpeg -y -f lavfi -i testsrc=duration=3:size=1920x1080:rate=30 \
  -f lavfi -i sine=frequency=440:duration=3 \
  -c:v prores -c:a pcm_s16le \
  "$SCRIPT_DIR/test-1080p.mov" 2>/dev/null

# Fixture 4: Archivo NO-MOV (para test de rechazo)
ffmpeg -y -f lavfi -i testsrc=duration=1:size=320x240:rate=24 \
  -c:v libx264 \
  "$SCRIPT_DIR/test-not-mov.mp4" 2>/dev/null

echo "Fixtures generados en $SCRIPT_DIR:"
ls -lh "$SCRIPT_DIR"/test-*
