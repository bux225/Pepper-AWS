#!/bin/bash
# Pepper server launcher — called by the dock app
# Starts Next.js, waits for ready, opens browser, traps exit to clean up.

APP_DIR="$(cd "$(dirname "$0")/../app" && pwd)"
PID_FILE="/tmp/pepper-server.pid"
LOG_FILE="/tmp/pepper-server.log"

# Ensure node/npm are on PATH (handles nvm and Homebrew installs)
export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.nvm/versions/node/$(ls $HOME/.nvm/versions/node 2>/dev/null | sort -V | tail -1)/bin:$PATH"

cleanup() {
  if [ -f "$PID_FILE" ]; then
    # Kill the entire process group started by npm
    PID=$(cat "$PID_FILE")
    PGID=$(ps -o pgid= -p "$PID" 2>/dev/null | tr -d ' ')
    if [ -n "$PGID" ]; then
      kill -- -"$PGID" 2>/dev/null
    else
      kill "$PID" 2>/dev/null
    fi
    rm -f "$PID_FILE"
  fi
  # Fallback: kill anything still on port 3000
  lsof -ti:3000 | xargs kill -9 2>/dev/null
}

trap cleanup EXIT INT TERM

# Kill any existing server on port 3000
lsof -ti:3000 | xargs kill -9 2>/dev/null
sleep 1

# Start Next.js dev server
cd "$APP_DIR"
npm run dev >> "$LOG_FILE" 2>&1 &
SERVER_PID=$!
echo "$SERVER_PID" > "$PID_FILE"

# Wait for the server to be ready (up to 60s)
echo "Starting Pepper server (PID: $SERVER_PID)..."
for i in $(seq 1 30); do
  sleep 2
  if curl -sf http://localhost:3000/api/health > /dev/null 2>&1; then
    echo "Pepper is ready."
    break
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "Server process died. Check $LOG_FILE"
    exit 1
  fi
done

# Open the browser
open "http://localhost:3000"

# Keep this script alive (so the dock app stays running and trap fires on quit)
wait "$SERVER_PID"
