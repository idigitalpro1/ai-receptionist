#!/bin/bash
set -e
REPO_DIR=/opt/ai-receptionist
GITHUB_REPO=https://github.com/idigitalpro1/ai-receptionist.git

echo "[deploy] Pulling latest from GitHub..."
if [ -d "$REPO_DIR/.git" ]; then
  cd "$REPO_DIR" && git pull origin main
else
  git clone "$GITHUB_REPO" "$REPO_DIR.tmp" && rsync -a "$REPO_DIR.tmp/" "$REPO_DIR/" && rm -rf "$REPO_DIR.tmp"
  cd "$REPO_DIR" && git init && git remote add origin "$GITHUB_REPO" && git fetch && git checkout -f main
fi

echo "[deploy] Rebuilding and restarting container..."
cd "$REPO_DIR"
docker compose down
docker compose build --no-cache
docker compose up -d

echo "[deploy] Health check..."
sleep 3
curl -sf http://127.0.0.1:8787/health && echo " ✓ healthy" || echo " ✗ unhealthy"
